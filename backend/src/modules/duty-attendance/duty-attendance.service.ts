import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import * as ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { DbService } from '../../db/db.service';
import {
  departments,
  dutyAttendanceCodeGroups,
  dutyAttendanceCodes,
  dutyAttendanceColumns,
  dutyAttendanceEntries,
  dutyAttendanceHolidays,
  dutyAttendanceManualValues,
  dutyAttendanceSections,
  dutyAttendanceValidations,
  users,
  type DutyAttendanceColumnType,
} from '../../db/schema';
import type { AccessContext } from '../../common/types/access-context';
import { renderPrintDocument } from '../../infra/rendering/pdf-renderer';
import { bangkokToday } from '../duty/duty-rules';
import { booleanExpression, evaluateExpression, expressionReferences, numericExpression } from './attendance-expression';
import type {
  AttendanceCodeDto,
  AttendanceCodeGroupDto,
  AttendanceColumnDto,
  AttendanceHolidayDto,
  AttendanceMonthQueryDto,
  AttendanceSectionDto,
  AttendanceValidationDto,
  SaveAttendanceEntriesDto,
  SaveAttendanceManualValuesDto,
} from './duty-attendance.dto';

const YMD = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const COLUMN_KEY = /^[A-Z][A-Z0-9_]{0,31}$/;
const NUMBER = /^-?\d+(?:[.,]\d+)?$/;
const SYSTEM_SECTION_CODES = new Set(['ADMIN', 'DAYS', 'SYMBOLS', 'REPORT']);
const monthBounds = (month: string) => ({ from: `${month}-01`, to: `${month === '9999-12' ? '10000-01' : `${Number(month.slice(0, 4)) + (month.endsWith('-12') ? 1 : 0)}-${String((Number(month.slice(5)) % 12) + 1).padStart(2, '0')}`}-01` });
const daysInMonth = (month: string) => new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
const fmtDate = (ymd: string) => { const [y, m, d] = ymd.split('-'); return `${d}/${m}/${y}`; };
const vnWeekday = (ymd: string) => ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][new Date(`${ymd}T00:00:00`).getDay()];
const numberValue = (value: string | number | undefined) => {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};
const codeCount = (value: string | number | undefined) => Math.round(numberValue(value) * 1_000_000) / 1_000_000;

/** Nhận dạng duy nhất dạng [A] + [B] + [C] == [TONG] để áp dụng giới hạn công không âm/an toàn. */
const manualSumLimit = (expression: string, manualKeys: Set<string>, values: Record<string, string | number | undefined>) => {
  let depth = 0; let split = -1;
  for (let index = 0; index < expression.length - 1; index++) { const character = expression[index]; if (character === '(') depth++; if (character === ')') depth--; if (depth === 0 && expression.slice(index, index + 2) === '==') { if (split >= 0) return null; split = index; index++; } }
  if (split < 0) return null;
  const left = expression.slice(0, split).trim(); const right = expression.slice(split + 2).trim();
  const sumReferences = (side: string) => { const references = expressionReferences(side); return references.length && references.every((reference) => manualKeys.has(reference)) && side.replace(/\[[^\]]+\]/g, '').replace(/[+\s]/g, '') === '' ? references : []; };
  for (const [sum, total] of [[left, right], [right, left]] as const) {
    const references = sumReferences(sum); if (!references.length || expressionReferences(total).some((reference) => manualKeys.has(reference))) continue;
    return { references, maximum: numericExpression(total, values) };
  }
  return null;
};

const hexToArgb = (value: string) => `FF${value.replace('#', '').toUpperCase()}`;

type ActiveLayout = {
  sections: Awaited<ReturnType<DutyAttendanceService['layout']>>['sections'];
  columns: Awaited<ReturnType<DutyAttendanceService['layout']>>['columns'];
  validations: Awaited<ReturnType<DutyAttendanceService['layout']>>['validations'];
};
type Board = Awaited<ReturnType<DutyAttendanceService['month']>>;
type DisplayColumn = { key: string; name: string; source: 'ADMIN' | 'DAY' | 'VALUE'; section: Board['sections'][number]; day?: Board['dates'][number]; column?: Board['columns'][number] };

export interface AttendanceExport { buffer: Buffer; fileName: string; mime: string; }

@Injectable()
export class DutyAttendanceService {
  constructor(private readonly db: DbService) {}

  /** Vai trò phạm vi TOÀN VIỆN (gồm Điều phối chấm công KHTH) được chọn khoa rõ ràng. */
  private canSelectAnyDepartment(user: AccessContext) { return user.isSuperAdmin || user.dataScope === 'ALL'; }

  private async deptId(user: AccessContext, requestedDepartmentId?: number) {
    if (!this.canSelectAnyDepartment(user)) {
      if (!user.departmentId) throw new ForbiddenException('Tài khoản chưa được gán khoa/phòng; không thể nhập bảng chấm công');
      if (requestedDepartmentId !== undefined && requestedDepartmentId !== user.departmentId) throw new ForbiddenException('Bạn chỉ được xem và chấm công cho khoa/phòng được gán');
      return user.departmentId;
    }
    if (!requestedDepartmentId) throw new BadRequestException('Vui lòng chọn khoa/phòng cần xem bảng chấm công');
    const [department] = await this.db.db.select({ id: departments.id }).from(departments).where(and(eq(departments.id, requestedDepartmentId), eq(departments.active, true), isNull(departments.deletedAt)));
    if (!department) throw new NotFoundException('Không tìm thấy khoa/phòng đang hoạt động');
    return department.id;
  }

  async availableDepartments(user: AccessContext) {
    if (this.canSelectAnyDepartment(user)) {
      const items = await this.db.db.select({ id: departments.id, name: departments.name, code: departments.code, shortName: departments.shortName }).from(departments).where(and(eq(departments.active, true), isNull(departments.deletedAt))).orderBy(asc(departments.name));
      return { canSelect: true, items };
    }
    const id = await this.deptId(user);
    const [item] = await this.db.db.select({ id: departments.id, name: departments.name, code: departments.code, shortName: departments.shortName }).from(departments).where(eq(departments.id, id));
    return { canSelect: false, items: item ? [item] : [] };
  }

  private assertMonth(month: string) { if (!MONTH.test(month)) throw new BadRequestException('Tháng phải có dạng YYYY-MM'); }

  /** Layout đầy đủ (kể cả ngừng dùng) dành cho màn hình khai báo. */
  async layout() {
    const [sections, columns, validations] = await Promise.all([
      this.db.db.select().from(dutyAttendanceSections).orderBy(asc(dutyAttendanceSections.sortOrder), asc(dutyAttendanceSections.id)),
      this.db.db.select().from(dutyAttendanceColumns).orderBy(asc(dutyAttendanceColumns.sortOrder), asc(dutyAttendanceColumns.id)),
      this.db.db.select().from(dutyAttendanceValidations).orderBy(asc(dutyAttendanceValidations.sortOrder), asc(dutyAttendanceValidations.id)),
    ]);
    return { sections, columns, validations };
  }

  private async activeLayout(): Promise<ActiveLayout> {
    const [sections, columns, validations] = await Promise.all([
      this.db.db.select().from(dutyAttendanceSections).where(eq(dutyAttendanceSections.active, true)).orderBy(asc(dutyAttendanceSections.sortOrder), asc(dutyAttendanceSections.id)),
      this.db.db.select().from(dutyAttendanceColumns).where(eq(dutyAttendanceColumns.active, true)).orderBy(asc(dutyAttendanceColumns.sortOrder), asc(dutyAttendanceColumns.id)),
      this.db.db.select().from(dutyAttendanceValidations).where(eq(dutyAttendanceValidations.active, true)).orderBy(asc(dutyAttendanceValidations.sortOrder), asc(dutyAttendanceValidations.id)),
    ]);
    return { sections, columns, validations };
  }

  private validateReferences(expression: string, codes: Array<{ code: string }>, columns: Array<{ key: string }>) {
    const allowed = new Set([...codes.map((x) => x.code.toUpperCase()), ...columns.map((x) => x.key.toUpperCase())]);
    for (const ref of expressionReferences(expression)) if (!allowed.has(ref)) throw new BadRequestException(`Biểu thức tham chiếu mã “${ref}” chưa được khai báo`);
  }

  private assertFormulaGraph(columns: Array<{ key: string; columnType: string; formula: string; active: boolean }>) {
    const formulas = new Map(columns.filter((column) => column.active && column.columnType === 'FORMULA').map((column) => [column.key.toUpperCase(), column]));
    const checked = new Set<string>(); const visiting = new Set<string>();
    const visit = (key: string) => {
      if (checked.has(key)) return;
      if (visiting.has(key)) throw new BadRequestException(`Công thức bị vòng lặp tại mã “${key}”`);
      visiting.add(key);
      const column = formulas.get(key);
      if (column) for (const ref of expressionReferences(column.formula)) if (formulas.has(ref)) visit(ref);
      visiting.delete(key); checked.add(key);
    };
    for (const key of formulas.keys()) visit(key);
  }

  private async assertColumnConfig(input: AttendanceColumnDto, editingId?: number) {
    const [section] = await this.db.db.select().from(dutyAttendanceSections).where(eq(dutyAttendanceSections.id, input.sectionId));
    if (!section) throw new NotFoundException('Không tìm thấy phần của bảng chấm công');
    if (!['REPORT', 'CUSTOM'].includes(section.kind)) throw new BadRequestException('Chỉ phần Báo cáo hoặc phần tự khai báo mới được thêm cột');
    const key = input.key.trim().toUpperCase();
    if (!COLUMN_KEY.test(key)) throw new BadRequestException('Mã cột chỉ gồm chữ in hoa, số và dấu gạch dưới');
    const [codes, current] = await Promise.all([this.db.db.select({ code: dutyAttendanceCodes.code }).from(dutyAttendanceCodes), this.db.db.select().from(dutyAttendanceColumns)]);
    if (codes.some((code) => code.code.toUpperCase() === key)) throw new ConflictException(`Mã cột “${key}” trùng mã ký hiệu chấm công`);
    const formula = input.columnType === 'FORMULA' ? (input.formula ?? '').trim() : '';
    if (input.columnType === 'FORMULA' && !formula) throw new BadRequestException('Cột công thức phải có biểu thức tính');
    const virtualColumns = [...current.filter((column) => column.id !== editingId), {
      id: editingId ?? -1, key, columnType: input.columnType, formula, active: input.active ?? true,
    }];
    if (formula) {
      this.validateReferences(formula, codes, virtualColumns);
      numericExpression(formula, Object.fromEntries([...codes.map((item) => [item.code, 0]), ...virtualColumns.map((item) => [item.key, 0]) ]));
    }
    this.assertFormulaGraph(virtualColumns.map((column) => ({ key: column.key, columnType: column.columnType, formula: column.formula, active: column.active })));
    return { section, key, formula };
  }

  private async assertValidationConfig(expression: string) {
    const [codes, columns] = await Promise.all([this.db.db.select({ code: dutyAttendanceCodes.code }).from(dutyAttendanceCodes), this.db.db.select({ key: dutyAttendanceColumns.key }).from(dutyAttendanceColumns)]);
    this.validateReferences(expression, codes, columns);
    if (typeof evaluateExpression(expression, Object.fromEntries([...codes.map((item) => [item.code, 0]), ...columns.map((item) => [item.key, 0])])) !== 'boolean') throw new BadRequestException('Ràng buộc phải là phép so sánh, ví dụ: [A] + [B] == [TONG]');
  }

  private async buildBoard(departmentId: number, month: string, overrides = new Map<string, string | null>(), entryOverrides = new Map<string, { code: string | null; note?: string }>()) {
    this.assertMonth(month);
    const { from, to } = monthBounds(month);
    const layout = await this.activeLayout();
    const [department, staff, codes, holidays, records, manualRows] = await Promise.all([
      this.db.db.select().from(departments).where(eq(departments.id, departmentId)),
      this.db.db.select({ id: users.id, fullName: users.fullName, title: users.title, username: users.username }).from(users).where(and(eq(users.departmentId, departmentId), eq(users.active, true), isNull(users.deletedAt))).orderBy(asc(users.fullName)),
      this.db.db.select().from(dutyAttendanceCodes).where(eq(dutyAttendanceCodes.active, true)).orderBy(asc(dutyAttendanceCodes.sortOrder), asc(dutyAttendanceCodes.code)),
      this.db.db.select().from(dutyAttendanceHolidays).where(and(gte(dutyAttendanceHolidays.holidayDate, from), lt(dutyAttendanceHolidays.holidayDate, to))),
      this.db.db.select({ userId: dutyAttendanceEntries.userId, workDate: dutyAttendanceEntries.workDate, code: dutyAttendanceCodes.code, note: dutyAttendanceEntries.note }).from(dutyAttendanceEntries).innerJoin(dutyAttendanceCodes, eq(dutyAttendanceEntries.codeId, dutyAttendanceCodes.id)).where(and(eq(dutyAttendanceEntries.departmentId, departmentId), gte(dutyAttendanceEntries.workDate, from), lt(dutyAttendanceEntries.workDate, to))),
      this.db.db.select({ userId: dutyAttendanceManualValues.userId, columnId: dutyAttendanceManualValues.columnId, value: dutyAttendanceManualValues.value }).from(dutyAttendanceManualValues).where(and(eq(dutyAttendanceManualValues.departmentId, departmentId), eq(dutyAttendanceManualValues.month, month))),
    ]);
    const currentDepartment = department[0];
    if (!currentDepartment) throw new NotFoundException('Không tìm thấy khoa/phòng được gán');
    const today = bangkokToday();
    const holidayDates = new Set(holidays.map((holiday) => holiday.holidayDate));
    const dates = Array.from({ length: daysInMonth(month) }, (_, index) => {
      const date = `${month}-${String(index + 1).padStart(2, '0')}`; const dow = new Date(`${date}T00:00:00`).getDay(); const isWeekend = dow === 0 || dow === 6;
      return { date, day: index + 1, weekday: vnWeekday(date), isWeekend, isPast: date < today, isRest: isWeekend || holidayDates.has(date), holidayName: holidays.find((holiday) => holiday.holidayDate === date)?.name ?? '' };
    });
    const entryByCell = new Map(records.map((record) => [`${record.userId}:${record.workDate}`, { code: record.code, note: record.note }]));
    for (const [cell, entry] of entryOverrides) { if (!entry.code) entryByCell.delete(cell); else entryByCell.set(cell, { code: entry.code, note: entry.note ?? '' }); }
    const entries = Object.fromEntries(entryByCell);
    const manualColumns = layout.columns.filter((column) => column.columnType === 'MANUAL');
    const formulaColumns = layout.columns.filter((column) => column.columnType === 'FORMULA');
    const manualByCell = new Map(manualRows.map((row) => [`${row.userId}:${row.columnId}`, row.value]));
    for (const [cell, value] of overrides) { if (value === null || value === '') manualByCell.delete(cell); else manualByCell.set(cell, value); }
    const activeCodeKeys = new Set(codes.map((code) => code.code.toUpperCase()));
    const rowValues: Record<string, Record<string, string | number>> = {};
    const manualValues: Record<string, string> = {};
    for (const person of staff) {
      const values: Record<string, string | number> = Object.fromEntries(codes.map((code) => [code.code.toUpperCase(), 0]));
      for (const date of dates) {
        const entry = entries[`${person.id}:${date.date}`];
        if (entry && activeCodeKeys.has(entry.code.toUpperCase())) {
          const code = codes.find((item) => item.code.toUpperCase() === entry.code.toUpperCase());
          if (code) values[code.code.toUpperCase()] = codeCount(values[code.code.toUpperCase()]) + codeCount(code.countValue);
        }
      }
      for (const column of manualColumns) {
        const cell = `${person.id}:${column.id}`; const value = manualByCell.get(cell) ?? '';
        values[column.key.toUpperCase()] = value; if (value) manualValues[cell] = value;
      }
      const cache = new Map<string, number>(); const visiting = new Set<string>(); const formulas = new Map(formulaColumns.map((column) => [column.key.toUpperCase(), column]));
      const formula = (key: string): number => {
        if (cache.has(key)) return cache.get(key)!;
        if (visiting.has(key)) throw new BadRequestException(`Công thức bị vòng lặp tại mã “${key}”`);
        const column = formulas.get(key); if (!column) return numberValue(values[key]);
        visiting.add(key); const variables = { ...values };
        for (const ref of expressionReferences(column.formula)) if (formulas.has(ref)) variables[ref] = formula(ref);
        const result = numericExpression(column.formula, variables); visiting.delete(key); cache.set(key, result); values[key] = result; return result;
      };
      for (const column of formulaColumns) formula(column.key.toUpperCase());
      rowValues[String(person.id)] = values;
    }
    return { month, today, department: { id: currentDepartment.id, name: currentDepartment.name, hospital: currentDepartment.hospital }, dates, codes, sections: layout.sections, columns: layout.columns, validations: layout.validations, staff: staff.map((person, index) => ({ stt: index + 1, ...person })), entries, manualValues, rowValues, holidays };
  }

  /** Một thay đổi ký hiệu hoặc số tự nhập không được làm lưu lại dòng công thức/ràng buộc sai. */
  private assertBoardManualRules(board: Board, changedPeople: Set<number>) {
    const manualKeys = new Set(board.columns.filter((column) => column.columnType === 'MANUAL').map((column) => column.key.toUpperCase()));
    for (const rule of board.validations) {
      const references = expressionReferences(rule.expression);
      for (const person of board.staff) {
        const values = board.rowValues[String(person.id)];
        // Với dạng A + B + C == Công thường, chặn ngay từng công vượt tổng hoặc tổng nhập vượt tổng,
        // kể cả khi còn ô trống; nhờ đó không thể tự tính ra số âm.
        if (changedPeople.has(person.id)) {
          const limit = manualSumLimit(rule.expression, manualKeys, values);
          if (limit) {
            const entered = limit.references.map((reference) => numberValue(values?.[reference])); const exceedsEach = entered.some((value) => value > limit.maximum + 0.000001); const exceedsTotal = entered.reduce((total, value) => total + value, 0) > limit.maximum + 0.000001;
            if (limit.maximum < 0 || exceedsEach) throw new BadRequestException(`Ràng buộc “${rule.name}”: một loại công không được lớn hơn công thường`);
            if (exceedsTotal) throw new BadRequestException(`Ràng buộc “${rule.name}”: tổng công không được vượt công thường để tránh số âm`);
          }
        }
        // Cho phép tự lưu từng ô khi dòng còn thiếu dữ liệu; chỉ đánh giá phép bằng đầy đủ khi mọi ô tự nhập mà quy tắc dùng đã có giá trị.
        if (references.some((reference) => manualKeys.has(reference) && !String(values?.[reference] ?? '').trim())) continue;
        if (!booleanExpression(rule.expression, values)) throw new BadRequestException(rule.message || `Ràng buộc “${rule.name}” chưa đúng cho nhân viên ${person.fullName}`);
      }
    }
  }

  /** Khi đổi ký hiệu làm cột Công thường thay đổi, tự cân phần công cuối cùng nếu phép tính có một nghiệm không âm rõ ràng. */
  private manualOverridesForEntryChanges(board: Board, changedPeople: Set<number>) {
    const manualByKey = new Map(board.columns.filter((column) => column.columnType === 'MANUAL').map((column) => [column.key.toUpperCase(), column])); const manualKeys = new Set(manualByKey.keys()); const overrides = new Map<string, string>();
    for (const rule of board.validations) {
      for (const person of board.staff) {
        if (!changedPeople.has(person.id)) continue;
        const values = board.rowValues[String(person.id)]; const limit = manualSumLimit(rule.expression, manualKeys, values); if (!limit) continue;
        const columns = limit.references.map((reference) => manualByKey.get(reference)).filter((column): column is Board['columns'][number] => !!column);
        if (columns.length !== limit.references.length || columns.some((column) => column.dataType !== 'NUMBER')) continue;
        const target = [...columns].sort((a, b) => b.sortOrder - a.sortOrder || b.id - a.id)[0]; if (!target) continue;
        const others = limit.references.filter((reference) => reference !== target.key.toUpperCase());
        if (others.some((reference) => !String(values?.[reference] ?? '').trim())) continue;
        const required = Math.round((limit.maximum - others.reduce((sum, reference) => sum + numberValue(values?.[reference]), 0)) * 1_000_000) / 1_000_000;
        if (required < -0.000001) continue;
        const cell = `${person.id}:${target.id}`; const current = values?.[target.key.toUpperCase()];
        if (!String(current ?? '').trim() || Math.abs(numberValue(current) - required) >= 0.000001) overrides.set(cell, String(Math.max(0, required)));
      }
    }
    return overrides;
  }

  async month(user: AccessContext, q: AttendanceMonthQueryDto) { this.assertMonth(q.month); return this.buildBoard(await this.deptId(user, q.departmentId), q.month); }

  async save(user: AccessContext, dto: SaveAttendanceEntriesDto) {
    const departmentId = await this.deptId(user, dto.departmentId);
    if (!dto.entries.length) return { saved: 0 };
    const dates = [...new Set(dto.entries.map((entry) => entry.workDate))]; const today = bangkokToday();
    for (const date of dates) { if (!YMD.test(date)) throw new BadRequestException('Ngày chấm công không hợp lệ'); if (date < today) throw new ForbiddenException(`Không được sửa chấm công ngày ${fmtDate(date)} vì ngày này đã qua`); }
    const personIds = [...new Set(dto.entries.map((entry) => entry.userId))];
    const [staff, activeCodes] = await Promise.all([
      this.db.db.select({ id: users.id }).from(users).where(and(inArray(users.id, personIds), eq(users.departmentId, departmentId), eq(users.active, true), isNull(users.deletedAt))),
      this.db.db.select({ id: dutyAttendanceCodes.id, code: dutyAttendanceCodes.code }).from(dutyAttendanceCodes).where(eq(dutyAttendanceCodes.active, true)),
    ]);
    if (staff.length !== personIds.length) throw new ForbiddenException('Chỉ được chấm công cho nhân viên đang hoạt động thuộc khoa của bạn');
    const byCode = new Map(activeCodes.map((code) => [code.code.toUpperCase(), code.id]));
    // Xem trước toàn bộ thay đổi ký hiệu theo từng tháng trước khi ghi. Nếu Công thường đổi,
    // phần công cuối cùng được cân lại khi có nghiệm không âm rõ ràng; không thì từ chối nguyên thao tác.
    const overridesByMonth = new Map<string, Map<string, { code: string | null; note?: string }>>(); const changedPeopleByMonth = new Map<string, Set<number>>();
    for (const entry of dto.entries) {
      const month = entry.workDate.slice(0, 7); const code = entry.code?.trim().toUpperCase() || null;
      if (code && !byCode.has(code)) throw new BadRequestException(`Ký hiệu “${code}” không tồn tại hoặc đã ngừng sử dụng`);
      const overrides = overridesByMonth.get(month) ?? new Map<string, { code: string | null; note?: string }>(); overrides.set(`${entry.userId}:${entry.workDate}`, { code, note: entry.note?.trim() ?? '' }); overridesByMonth.set(month, overrides);
      const changedPeople = changedPeopleByMonth.get(month) ?? new Set<number>(); changedPeople.add(entry.userId); changedPeopleByMonth.set(month, changedPeople);
    }
    const automaticManualOverrides = new Map<string, Map<string, string>>();
    for (const [month, overrides] of overridesByMonth) {
      const changedPeople = changedPeopleByMonth.get(month)!; const preview = await this.buildBoard(departmentId, month, new Map(), overrides); const manualOverrides = this.manualOverridesForEntryChanges(preview, changedPeople);
      const finalBoard = manualOverrides.size ? await this.buildBoard(departmentId, month, manualOverrides, overrides) : preview;
      this.assertBoardManualRules(finalBoard, changedPeople); if (manualOverrides.size) automaticManualOverrides.set(month, manualOverrides);
    }
    await this.db.transaction(async (tx) => {
      for (const entry of dto.entries) {
        const code = entry.code?.trim().toUpperCase();
        if (!code) { await tx.delete(dutyAttendanceEntries).where(and(eq(dutyAttendanceEntries.userId, entry.userId), eq(dutyAttendanceEntries.workDate, entry.workDate), eq(dutyAttendanceEntries.departmentId, departmentId))); continue; }
        const codeId = byCode.get(code); if (!codeId) throw new BadRequestException(`Ký hiệu “${code}” không tồn tại hoặc đã ngừng sử dụng`);
        await tx.insert(dutyAttendanceEntries).values({ departmentId, userId: entry.userId, workDate: entry.workDate, codeId, note: entry.note?.trim() ?? '', updatedBy: user.id }).onConflictDoUpdate({ target: [dutyAttendanceEntries.userId, dutyAttendanceEntries.workDate], set: { departmentId, codeId, note: entry.note?.trim() ?? '', updatedBy: user.id, updatedAt: new Date() } });
      }
      for (const [month, overrides] of automaticManualOverrides) for (const [cell, value] of overrides) {
        const [manualUserId, columnId] = cell.split(':').map(Number);
        await tx.insert(dutyAttendanceManualValues).values({ departmentId, userId: manualUserId, month, columnId, value, updatedBy: user.id }).onConflictDoUpdate({ target: [dutyAttendanceManualValues.departmentId, dutyAttendanceManualValues.userId, dutyAttendanceManualValues.month, dutyAttendanceManualValues.columnId], set: { value, updatedBy: user.id, updatedAt: new Date() } });
      }
    });
    return { saved: dto.entries.length, adjustedManualValues: [...automaticManualOverrides.values()].reduce((total, values) => total + values.size, 0) };
  }

  async saveManualValues(user: AccessContext, dto: SaveAttendanceManualValuesDto) {
    const departmentId = await this.deptId(user, dto.departmentId); this.assertMonth(dto.month);
    if (!dto.values.length) return { saved: 0 };
    if (dto.month < bangkokToday().slice(0, 7)) throw new ForbiddenException('Tháng đã qua được khóa; không thể sửa số liệu tự nhập để bảo toàn lịch sử');
    const columnIds = [...new Set(dto.values.map((value) => value.columnId))]; const personIds = [...new Set(dto.values.map((value) => value.userId))];
    const [columns, staff] = await Promise.all([
      this.db.db.select().from(dutyAttendanceColumns).where(and(inArray(dutyAttendanceColumns.id, columnIds), eq(dutyAttendanceColumns.active, true))),
      this.db.db.select({ id: users.id }).from(users).where(and(inArray(users.id, personIds), eq(users.departmentId, departmentId), eq(users.active, true), isNull(users.deletedAt))),
    ]);
    if (staff.length !== personIds.length) throw new ForbiddenException('Chỉ được nhập số liệu cho nhân viên đang hoạt động thuộc khoa của bạn');
    if (columns.length !== columnIds.length || columns.some((column) => column.columnType !== 'MANUAL')) throw new BadRequestException('Chỉ cột tự nhập đang hoạt động mới được ghi số liệu');
    const byColumn = new Map(columns.map((column) => [column.id, column])); const overrides = new Map<string, string | null>();
    for (const item of dto.values) {
      const column = byColumn.get(item.columnId)!; const submitted = item.value ?? ''; const value = column.dataType === 'NUMBER' ? submitted.trim().replace(',', '.') : submitted;
      if (column.dataType === 'NUMBER' && value && !NUMBER.test(value)) throw new BadRequestException(`Cột “${column.name}” chỉ nhận số`);
      if (column.dataType === 'NUMBER' && value && numberValue(value) < 0) throw new BadRequestException(`Cột “${column.name}” không được nhập số âm`);
      overrides.set(`${item.userId}:${item.columnId}`, value || null);
    }
    const board = await this.buildBoard(departmentId, dto.month, overrides);
    this.assertBoardManualRules(board, new Set(personIds));
    await this.db.transaction(async (tx) => {
      for (const item of dto.values) {
        const value = overrides.get(`${item.userId}:${item.columnId}`) ?? null;
        if (!value) { await tx.delete(dutyAttendanceManualValues).where(and(eq(dutyAttendanceManualValues.departmentId, departmentId), eq(dutyAttendanceManualValues.month, dto.month), eq(dutyAttendanceManualValues.userId, item.userId), eq(dutyAttendanceManualValues.columnId, item.columnId))); continue; }
        await tx.insert(dutyAttendanceManualValues).values({ departmentId, userId: item.userId, month: dto.month, columnId: item.columnId, value, updatedBy: user.id }).onConflictDoUpdate({ target: [dutyAttendanceManualValues.departmentId, dutyAttendanceManualValues.userId, dutyAttendanceManualValues.month, dutyAttendanceManualValues.columnId], set: { value, updatedBy: user.id, updatedAt: new Date() } });
      }
    });
    return { saved: dto.values.length };
  }

  async codeGroups() { return this.db.db.select().from(dutyAttendanceCodeGroups).orderBy(asc(dutyAttendanceCodeGroups.sortOrder), asc(dutyAttendanceCodeGroups.code)); }
  private async assertActiveCodeGroup(code: string) {
    const normalized = code.trim().toUpperCase();
    const [group] = await this.db.db.select({ code: dutyAttendanceCodeGroups.code, name: dutyAttendanceCodeGroups.name }).from(dutyAttendanceCodeGroups).where(and(eq(dutyAttendanceCodeGroups.code, normalized), eq(dutyAttendanceCodeGroups.active, true)));
    if (!group) throw new BadRequestException(`Nhóm ký hiệu “${normalized}” không tồn tại hoặc đã ngừng sử dụng`);
    return normalized;
  }
  async createCodeGroup(dto: AttendanceCodeGroupDto) {
    const [item] = await this.db.db.insert(dutyAttendanceCodeGroups).values({ code: dto.code.trim().toUpperCase(), name: dto.name.trim(), sortOrder: dto.sortOrder ?? 100, active: dto.active ?? true }).returning(); return item;
  }
  async updateCodeGroup(id: number, dto: Partial<AttendanceCodeGroupDto>) {
    const [current] = await this.db.db.select().from(dutyAttendanceCodeGroups).where(eq(dutyAttendanceCodeGroups.id, id)); if (!current) throw new NotFoundException('Không tìm thấy nhóm ký hiệu');
    const nextCode = dto.code?.trim().toUpperCase() ?? current.code;
    if (nextCode !== current.code) {
      const [{ total }] = await this.db.db.select({ total: sql<number>`count(*)::int` }).from(dutyAttendanceCodes).where(eq(dutyAttendanceCodes.group, current.code));
      if (Number(total)) throw new ConflictException(`Nhóm “${current.code}” đang được ${total} ký hiệu sử dụng. Không thể đổi mã; hãy giữ mã và chỉ đổi tên tiếng Việt.`);
    }
    const [item] = await this.db.db.update(dutyAttendanceCodeGroups).set({ ...(dto.code !== undefined ? { code: nextCode } : {}), ...(dto.name !== undefined ? { name: dto.name.trim() } : {}), ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}), ...(dto.active !== undefined ? { active: dto.active } : {}), updatedAt: new Date() }).where(eq(dutyAttendanceCodeGroups.id, id)).returning(); return item;
  }
  async deleteCodeGroup(id: number) {
    const [group] = await this.db.db.select().from(dutyAttendanceCodeGroups).where(eq(dutyAttendanceCodeGroups.id, id)); if (!group) throw new NotFoundException('Không tìm thấy nhóm ký hiệu');
    const [{ total }] = await this.db.db.select({ total: sql<number>`count(*)::int` }).from(dutyAttendanceCodes).where(eq(dutyAttendanceCodes.group, group.code));
    if (Number(total)) throw new ConflictException(`Nhóm “${group.name}” đang được sử dụng. Hãy ngừng dùng nhóm thay vì xóa để bảo toàn dữ liệu.`);
    await this.db.db.delete(dutyAttendanceCodeGroups).where(eq(dutyAttendanceCodeGroups.id, id)); return { deleted: true };
  }

  async codes() { return this.db.db.select().from(dutyAttendanceCodes).orderBy(asc(dutyAttendanceCodes.sortOrder), asc(dutyAttendanceCodes.code)); }
  private countValue(value?: string) { const count = numberValue(value); if (count < 0 || !Number.isFinite(count)) throw new BadRequestException('Giá trị đếm phải là số không âm'); return String(count); }
  async createCode(dto: AttendanceCodeDto) {
    const group = await this.assertActiveCodeGroup(dto.group);
    const [item] = await this.db.db.insert(dutyAttendanceCodes).values({ code: dto.code.trim().toUpperCase(), name: dto.name.trim(), group, color: dto.color ?? '#0f766e', countsAsDuty: dto.countsAsDuty ?? false, showSummary: dto.showSummary ?? true, countValue: this.countValue(dto.countValue), sortOrder: dto.sortOrder ?? 0, active: dto.active ?? true, note: dto.note?.trim() ?? '' }).returning(); return item;
  }
  async updateCode(id: number, dto: Partial<AttendanceCodeDto>) {
    const [current] = await this.db.db.select({ group: dutyAttendanceCodes.group }).from(dutyAttendanceCodes).where(eq(dutyAttendanceCodes.id, id));
    if (!current) throw new NotFoundException('Không tìm thấy ký hiệu');
    const requestedGroup = dto.group?.trim().toUpperCase();
    const group = requestedGroup === undefined ? undefined : requestedGroup === current.group ? current.group : await this.assertActiveCodeGroup(requestedGroup);
    const values = { ...(dto.code !== undefined ? { code: dto.code.trim().toUpperCase() } : {}), ...(dto.name !== undefined ? { name: dto.name.trim() } : {}), ...(group !== undefined ? { group } : {}), ...(dto.color !== undefined ? { color: dto.color } : {}), ...(dto.countsAsDuty !== undefined ? { countsAsDuty: dto.countsAsDuty } : {}), ...(dto.showSummary !== undefined ? { showSummary: dto.showSummary } : {}), ...(dto.countValue !== undefined ? { countValue: this.countValue(dto.countValue) } : {}), ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}), ...(dto.active !== undefined ? { active: dto.active } : {}), ...(dto.note !== undefined ? { note: dto.note.trim() } : {}), updatedAt: new Date() };
    const [item] = await this.db.db.update(dutyAttendanceCodes).set(values).where(eq(dutyAttendanceCodes.id, id)).returning(); return item;
  }
  async deleteCode(id: number) {
    const [code] = await this.db.db.select({ id: dutyAttendanceCodes.id, code: dutyAttendanceCodes.code }).from(dutyAttendanceCodes).where(eq(dutyAttendanceCodes.id, id)); if (!code) throw new NotFoundException('Không tìm thấy ký hiệu');
    const [{ total }] = await this.db.db.select({ total: sql<number>`count(*)::int` }).from(dutyAttendanceEntries).where(eq(dutyAttendanceEntries.codeId, id));
    if (Number(total) > 0) throw new ConflictException(`Không thể xóa ký hiệu “${code.code}” vì đã được dùng trong bảng chấm công. Hãy ngừng sử dụng ký hiệu này thay vì xóa.`);
    await this.db.db.delete(dutyAttendanceCodes).where(eq(dutyAttendanceCodes.id, id)); return { deleted: true };
  }

  async createSection(dto: AttendanceSectionDto) {
    const code = dto.code.trim().toUpperCase(); if (SYSTEM_SECTION_CODES.has(code)) throw new ConflictException('Mã phần này được hệ thống dành riêng');
    const [item] = await this.db.db.insert(dutyAttendanceSections).values({ code, name: dto.name.trim(), kind: 'CUSTOM', color: dto.color ?? '#64748b', sortOrder: dto.sortOrder ?? 100, active: dto.active ?? true }).returning(); return item;
  }
  async updateSection(id: number, dto: Partial<AttendanceSectionDto>) {
    const [current] = await this.db.db.select().from(dutyAttendanceSections).where(eq(dutyAttendanceSections.id, id)); if (!current) throw new NotFoundException('Không tìm thấy phần bảng chấm công');
    if (dto.code && dto.code.trim().toUpperCase() !== current.code && SYSTEM_SECTION_CODES.has(current.code)) throw new BadRequestException('Không thể đổi mã phần hệ thống');
    const values = { ...(dto.code !== undefined && current.kind === 'CUSTOM' ? { code: dto.code.trim().toUpperCase() } : {}), ...(dto.name !== undefined ? { name: dto.name.trim() } : {}), ...(dto.color !== undefined ? { color: dto.color } : {}), ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}), ...(dto.active !== undefined && current.kind === 'CUSTOM' ? { active: dto.active } : {}), updatedAt: new Date() };
    const [item] = await this.db.db.update(dutyAttendanceSections).set(values).where(eq(dutyAttendanceSections.id, id)).returning(); return item;
  }
  async deleteSection(id: number) {
    const [section] = await this.db.db.select().from(dutyAttendanceSections).where(eq(dutyAttendanceSections.id, id)); if (!section) throw new NotFoundException('Không tìm thấy phần bảng chấm công');
    if (section.kind !== 'CUSTOM') throw new BadRequestException('Không thể xóa phần hệ thống; hãy thay đổi màu hoặc thứ tự hiển thị');
    const [{ total }] = await this.db.db.select({ total: sql<number>`count(*)::int` }).from(dutyAttendanceColumns).where(eq(dutyAttendanceColumns.sectionId, id));
    if (Number(total)) throw new ConflictException('Phần này còn cột đã khai báo. Hãy ngừng dùng hoặc xóa các cột chưa có dữ liệu trước.');
    await this.db.db.delete(dutyAttendanceSections).where(eq(dutyAttendanceSections.id, id)); return { deleted: true };
  }

  async createColumn(dto: AttendanceColumnDto) {
    const prepared = await this.assertColumnConfig(dto); const [item] = await this.db.db.insert(dutyAttendanceColumns).values({ sectionId: dto.sectionId, key: prepared.key, name: dto.name.trim(), columnType: dto.columnType, dataType: dto.columnType === 'FORMULA' ? 'NUMBER' : dto.dataType ?? 'NUMBER', formula: prepared.formula, placeholder: dto.columnType === 'MANUAL' ? (dto.placeholder?.trim() || 'Tự nhập') : '', sortOrder: dto.sortOrder ?? 100, active: dto.active ?? true }).returning(); return item;
  }
  async updateColumn(id: number, dto: Partial<AttendanceColumnDto>) {
    const [current] = await this.db.db.select().from(dutyAttendanceColumns).where(eq(dutyAttendanceColumns.id, id)); if (!current) throw new NotFoundException('Không tìm thấy cột');
    const full = { sectionId: dto.sectionId ?? current.sectionId, key: dto.key ?? current.key, name: dto.name ?? current.name, columnType: (dto.columnType ?? current.columnType) as DutyAttendanceColumnType, dataType: dto.dataType ?? current.dataType, formula: dto.formula ?? current.formula, placeholder: dto.placeholder ?? current.placeholder, sortOrder: dto.sortOrder ?? current.sortOrder, active: dto.active ?? current.active } as AttendanceColumnDto;
    const prepared = await this.assertColumnConfig(full, id);
    const [item] = await this.db.db.update(dutyAttendanceColumns).set({ sectionId: full.sectionId, key: prepared.key, name: full.name.trim(), columnType: full.columnType, dataType: full.columnType === 'FORMULA' ? 'NUMBER' : full.dataType ?? 'NUMBER', formula: prepared.formula, placeholder: full.columnType === 'MANUAL' ? (full.placeholder?.trim() || 'Tự nhập') : '', sortOrder: full.sortOrder ?? 100, active: full.active ?? true, updatedAt: new Date() }).where(eq(dutyAttendanceColumns.id, id)).returning(); return item;
  }
  async deleteColumn(id: number) {
    const [column] = await this.db.db.select().from(dutyAttendanceColumns).where(eq(dutyAttendanceColumns.id, id)); if (!column) throw new NotFoundException('Không tìm thấy cột');
    const [{ total }] = await this.db.db.select({ total: sql<number>`count(*)::int` }).from(dutyAttendanceManualValues).where(eq(dutyAttendanceManualValues.columnId, id));
    if (Number(total)) throw new ConflictException('Cột đã có số liệu tự nhập; để bảo toàn lịch sử hãy chuyển cột sang ngừng sử dụng thay vì xóa.');
    const [{ used }] = await this.db.db.select({ used: sql<number>`count(*)::int` }).from(dutyAttendanceColumns).where(and(sql`${dutyAttendanceColumns.formula} like ${`%[${column.key}]%`}`, sql`${dutyAttendanceColumns.id} <> ${id}`));
    if (Number(used) > 0) throw new ConflictException('Cột đang được một công thức khác tham chiếu');
    const [{ checked }] = await this.db.db.select({ checked: sql<number>`count(*)::int` }).from(dutyAttendanceValidations).where(sql`${dutyAttendanceValidations.expression} like ${`%[${column.key}]%`}`);
    if (Number(checked) > 0) throw new ConflictException('Cột đang được một ràng buộc dữ liệu tham chiếu');
    await this.db.db.delete(dutyAttendanceColumns).where(eq(dutyAttendanceColumns.id, id)); return { deleted: true };
  }

  async createValidation(dto: AttendanceValidationDto) { const expression = dto.expression.trim(); await this.assertValidationConfig(expression); const [item] = await this.db.db.insert(dutyAttendanceValidations).values({ name: dto.name.trim(), expression, message: dto.message?.trim() ?? '', sortOrder: dto.sortOrder ?? 100, active: dto.active ?? true }).returning(); return item; }
  async updateValidation(id: number, dto: Partial<AttendanceValidationDto>) { const [current] = await this.db.db.select().from(dutyAttendanceValidations).where(eq(dutyAttendanceValidations.id, id)); if (!current) throw new NotFoundException('Không tìm thấy ràng buộc'); const expression = (dto.expression ?? current.expression).trim(); await this.assertValidationConfig(expression); const [item] = await this.db.db.update(dutyAttendanceValidations).set({ name: (dto.name ?? current.name).trim(), expression, message: (dto.message ?? current.message).trim(), sortOrder: dto.sortOrder ?? current.sortOrder, active: dto.active ?? current.active, updatedAt: new Date() }).where(eq(dutyAttendanceValidations.id, id)).returning(); return item; }
  async deleteValidation(id: number) { const [item] = await this.db.db.delete(dutyAttendanceValidations).where(eq(dutyAttendanceValidations.id, id)).returning(); if (!item) throw new NotFoundException('Không tìm thấy ràng buộc'); return { deleted: true }; }

  async holidays(q: AttendanceMonthQueryDto) { this.assertMonth(q.month); const { from, to } = monthBounds(q.month); return this.db.db.select().from(dutyAttendanceHolidays).where(and(gte(dutyAttendanceHolidays.holidayDate, from), lt(dutyAttendanceHolidays.holidayDate, to))).orderBy(asc(dutyAttendanceHolidays.holidayDate)); }
  async saveHoliday(user: AccessContext, dto: AttendanceHolidayDto) { const [item] = await this.db.db.insert(dutyAttendanceHolidays).values({ ...dto, name: dto.name.trim(), note: dto.note?.trim() ?? '', createdBy: user.id }).onConflictDoUpdate({ target: dutyAttendanceHolidays.holidayDate, set: { name: dto.name.trim(), note: dto.note?.trim() ?? '' } }).returning(); return item; }
  async deleteHoliday(id: number) { const [item] = await this.db.db.delete(dutyAttendanceHolidays).where(eq(dutyAttendanceHolidays.id, id)).returning(); if (!item) throw new NotFoundException('Không tìm thấy ngày nghỉ'); return { deleted: true }; }

  private displayColumns(data: Board): DisplayColumn[] {
    const columns: DisplayColumn[] = [];
    for (const section of data.sections) {
      if (section.kind === 'ADMIN') columns.push(...[
        { key: 'STT', name: 'STT', source: 'ADMIN', section }, { key: 'USERNAME', name: 'MANV', source: 'ADMIN', section }, { key: 'FULL_NAME', name: 'Họ và tên', source: 'ADMIN', section }, { key: 'TITLE', name: 'Chức danh', source: 'ADMIN', section },
      ] as DisplayColumn[]);
      if (section.kind === 'DAYS') columns.push(...data.dates.map((day) => ({ key: `DAY:${day.date}`, name: String(day.day), source: 'DAY' as const, section, day })));
      if (section.kind === 'SYMBOLS') columns.push(...data.codes.map((code) => ({ key: code.code.toUpperCase(), name: code.name, source: 'VALUE' as const, section })));
      if (section.kind === 'REPORT' || section.kind === 'CUSTOM') columns.push(...data.columns.filter((column) => column.sectionId === section.id).map((column) => ({ key: column.key.toUpperCase(), name: column.name, source: 'VALUE' as const, section, column })));
    }
    return columns;
  }
  private groups(data: Board) { const columns = this.displayColumns(data); return data.sections.map((section) => ({ section, columns: columns.filter((column) => column.section.id === section.id) })).filter((group) => group.columns.length); }
  private cellValue(person: Board['staff'][number], column: DisplayColumn, data: Board) {
    if (column.source === 'DAY') return data.entries[`${person.id}:${column.day!.date}`]?.code ?? '';
    if (column.source === 'VALUE') return data.rowValues[String(person.id)]?.[column.key] ?? '';
    if (column.key === 'STT') return person.stt; if (column.key === 'FULL_NAME') return person.fullName; if (column.key === 'TITLE') return person.title; return person.username;
  }
  private matrix(data: Board) { const columns = this.displayColumns(data); return data.staff.map((person) => columns.map((column) => this.cellValue(person, column, data))); }
  private async exportData(user: AccessContext, month: string, departmentId?: number) { return this.month(user, { month, departmentId }); }

  async exportExcel(user: AccessContext, month: string, departmentId?: number): Promise<AttendanceExport> {
    const data = await this.exportData(user, month, departmentId); const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Cham cong'); const groups = this.groups(data); const columns = groups.flatMap((group) => group.columns); const total = columns.length;
    sheet.mergeCells(1, 1, 1, total); sheet.getCell('A1').value = data.department.hospital.toUpperCase(); sheet.getCell('A1').font = { name: 'Times New Roman', bold: true, size: 12 }; sheet.getCell('A1').alignment = { horizontal: 'center' };
    sheet.mergeCells(2, 1, 2, total); sheet.getCell('A2').value = 'BẢNG CHẤM CÔNG TRỰC VÀ CHẤM CÔNG KHÁC'; sheet.getCell('A2').font = { name: 'Times New Roman', bold: true, size: 15 }; sheet.getCell('A2').alignment = { horizontal: 'center' };
    sheet.mergeCells(3, 1, 3, total); sheet.getCell('A3').value = `Khoa/Phòng: ${data.department.name} — Tháng ${month.slice(5)}/${month.slice(0, 4)}`; sheet.getCell('A3').alignment = { horizontal: 'center' };
    let start = 1; for (const group of groups) { const end = start + group.columns.length - 1; if (start !== end) sheet.mergeCells(4, start, 4, end); const cell = sheet.getCell(4, start); cell.value = group.section.name; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hexToArgb(group.section.color) } }; cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.alignment = { horizontal: 'center' }; start = end + 1; }
    sheet.addRow(columns.map((column) => column.name)); sheet.addRow(columns.map((column) => column.source === 'DAY' ? column.day!.weekday : ''));
    for (const person of data.staff) {
      const row = sheet.addRow(columns.map((column) => this.cellValue(person, column, data)));
      // ExcelJS receives all persisted manual values as strings. Configured manual NUMBER values
      // must remain actual Excel numbers so report users can sum/filter them correctly; TEXT stays untouched.
      columns.forEach((column, index) => {
        if (column.source !== 'VALUE' || column.column?.columnType !== 'MANUAL' || column.column.dataType !== 'NUMBER') return;
        const raw = String(this.cellValue(person, column, data) ?? '').trim(); if (!raw) return;
        const numeric = Number(raw.replace(',', '.')); if (Number.isFinite(numeric)) row.getCell(index + 1).value = numeric;
      });
    }
    sheet.views = [{ state: 'frozen', xSplit: Math.min(4, total), ySplit: 6 }];
    columns.forEach((column, index) => { sheet.getColumn(index + 1).width = column.key === 'FULL_NAME' ? 28 : column.key === 'TITLE' ? 20 : column.key === 'USERNAME' ? 16 : column.source === 'DAY' ? 5 : 13; });
    [4, 5, 6].forEach((row) => sheet.getRow(row).eachCell((cell) => { cell.font = { ...(cell.font ?? {}), bold: true, name: 'Times New Roman', size: 9 }; cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }; if (row !== 4) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EAF2F8' } }; }));
    for (let row = 7; row <= sheet.rowCount; row++) sheet.getRow(row).eachCell((cell) => { cell.alignment = { horizontal: Number(cell.col) > 4 ? 'center' : 'left', vertical: 'middle' }; cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }; });
    return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), fileName: `BANG_CHAM_CONG_${month}_${data.department.id}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }

  async exportWord(user: AccessContext, month: string, departmentId?: number): Promise<AttendanceExport> {
    const data = await this.exportData(user, month, departmentId); const groups = this.groups(data); const columns = groups.flatMap((group) => group.columns); const mkCell = (value: unknown, bold = false) => new TableCell({ width: { size: Math.max(180, Math.floor(9500 / columns.length)), type: WidthType.DXA }, children: [new Paragraph({ alignment: 'center', children: [new TextRun({ text: String(value ?? ''), bold, size: 14 })] })] });
    const rows = [new TableRow({ children: columns.map((column) => mkCell(column.section.name, true)) }), new TableRow({ children: columns.map((column) => mkCell(column.name, true)) }), new TableRow({ children: columns.map((column) => mkCell(column.source === 'DAY' ? column.day!.weekday : '', true)) }), ...this.matrix(data).map((row) => new TableRow({ children: row.map((value) => mkCell(value)) }))];
    const doc = new Document({ sections: [{ properties: { page: { size: { width: 16840, height: 11900 }, margin: { top: 600, right: 500, bottom: 600, left: 500 } } }, children: [new Paragraph({ alignment: 'center', children: [new TextRun({ text: data.department.hospital.toUpperCase(), bold: true, size: 20 })] }), new Paragraph({ alignment: 'center', children: [new TextRun({ text: 'BẢNG CHẤM CÔNG TRỰC VÀ CHẤM CÔNG KHÁC', bold: true, size: 26 })] }), new Paragraph({ alignment: 'center', children: [new TextRun({ text: `Khoa/Phòng: ${data.department.name} — Tháng ${month.slice(5)}/${month.slice(0, 4)}`, italics: true, size: 18 })] }), new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })] }] });
    return { buffer: await Packer.toBuffer(doc), fileName: `BANG_CHAM_CONG_${month}_${data.department.id}.docx`, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  }

  async exportPdf(user: AccessContext, month: string, departmentId?: number): Promise<AttendanceExport> {
    const data = await this.exportData(user, month, departmentId); const columns = this.displayColumns(data); const rows = data.staff.map((person) => Object.fromEntries(columns.map((column, index) => [`c${index}`, this.cellValue(person, column, data)])));
    const width = columns.length > 42 ? 5.4 : 7.5; const W = 273; const L = 12;
    const doc = { paperSize: 'A4', orientation: 'landscape', margins: { top: 8, right: 8, bottom: 10, left: 8 }, defaultStyle: { fontFamily: 'Times New Roman', fontSize: 6.5 }, pageNumbering: { show: true, position: 'bottom-right', format: 'Trang {page}/{pages}' }, pages: [{ id: 'p', name: 'Bảng chấm công', elements: [
      { id: 'org', type: 'text', x: L, y: 7, w: W, h: 5, text: data.department.hospital.toUpperCase(), style: { bold: true, align: 'center', fontSize: 9 } },
      { id: 'title', type: 'text', x: L, y: 13, w: W, h: 7, text: 'BẢNG CHẤM CÔNG TRỰC VÀ CHẤM CÔNG KHÁC', style: { bold: true, align: 'center', fontSize: 12 } },
      { id: 'sub', type: 'text', x: L, y: 21, w: W, h: 5, text: `Khoa/Phòng: ${data.department.name} — Tháng ${month.slice(5)}/${month.slice(0, 4)}`, style: { italic: true, align: 'center', fontSize: 8 } },
      { id: 'table', type: 'table', x: L, y: 29, w: W, h: 10, style: { fontSize: 5.8 }, table: { dataSource: 'rows', repeatHeader: true, minRowHeight: 5, columns: columns.map((column, index) => ({ id: `c${index}`, title: column.source === 'DAY' ? `${column.name}\n${column.day!.weekday}` : column.name, width: column.key === 'FULL_NAME' ? 24 : column.key === 'TITLE' ? 17 : width, align: ['FULL_NAME', 'TITLE'].includes(column.key) ? 'left' : 'center', binding: { source: 'row', path: `c${index}` } })) } },
      { id: 'legend', type: 'text', x: L, y: 185, w: W, h: 5, text: `Ký hiệu: ${data.codes.map((code) => `${code.code} – ${code.name} (${code.countValue})`).join('; ')}`, style: { fontSize: 7, wrap: true } },
    ] }] } as any;
    const output = await renderPrintDocument(doc, { data: { rows }, fileName: `BANG_CHAM_CONG_${month}` }); return { buffer: output.buffer, fileName: `BANG_CHAM_CONG_${month}_${data.department.id}.pdf`, mime: 'application/pdf' };
  }
}
