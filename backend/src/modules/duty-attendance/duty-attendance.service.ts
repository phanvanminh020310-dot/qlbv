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
  dutyAttendanceNationalHolidayPlans,
  dutyAttendanceSections,
  dutyAttendanceWorkdayOverrides,
  dutyAttendanceValidations,
  users,
  type DutyAttendanceColumnType,
} from '../../db/schema';
import type { AccessContext } from '../../common/types/access-context';
import { renderPrintDocument } from '../../infra/rendering/pdf-renderer';
import { SettingsService } from '../settings/settings.service';
import { bangkokToday } from '../duty/duty-rules';
import { booleanExpression, evaluateExpression, expressionReferences, numericExpression } from './attendance-expression';
import { ATTENDANCE_SYSTEM_METRICS, ATTENDANCE_SYSTEM_METRIC_KEYS, calculateAttendanceMetrics } from './attendance-metrics';
import { defaultNationalHolidayPlan, nationalHolidayProposal, type NationalHolidayPlanConfig } from './national-holiday-plan';
import type {
  AttendanceCodeDto,
  AttendanceCodeGroupDto,
  AttendanceColumnDto,
  AttendanceHolidayDto,
  AttendanceMonthQueryDto,
  AttendanceWorkdayOverrideDto,
  NationalHolidayPlanDto,
  AttendanceSectionDto,
  AttendanceValidationDto,
  SaveAttendanceEntriesDto,
  SaveAttendanceManualValuesDto,
} from './duty-attendance.dto';

const YMD = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const COLUMN_KEY = /^[A-Z][A-Z0-9_]{0,31}$/;
const NUMBER = /^-?\d+(?:[.,]\d+)?$/;
export const ATTENDANCE_LOCK_POLICIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
export type AttendanceLockPolicy = (typeof ATTENDANCE_LOCK_POLICIES)[number];
const SYSTEM_SECTION_CODES = new Set(['ADMIN', 'DAYS', 'SYMBOLS', 'REPORT']);
const monthBounds = (month: string) => ({ from: `${month}-01`, to: `${month === '9999-12' ? '10000-01' : `${Number(month.slice(0, 4)) + (month.endsWith('-12') ? 1 : 0)}-${String((Number(month.slice(5)) % 12) + 1).padStart(2, '0')}`}-01` });
const daysInMonth = (month: string) => new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
const addCalendarDays = (ymd: string, days: number) => { const date = new Date(`${ymd}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const fmtDate = (ymd: string) => { const [y, m, d] = ymd.split('-'); return `${d}/${m}/${y}`; };
const vnWeekday = (ymd: string) => ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][new Date(`${ymd}T00:00:00`).getDay()];
const lockPolicyOf = (value: unknown): AttendanceLockPolicy => {
  const candidate = String(value ?? '').trim().toUpperCase();
  return (ATTENDANCE_LOCK_POLICIES as readonly string[]).includes(candidate) ? candidate as AttendanceLockPolicy : 'DAILY';
};
/** Thứ Hai của tuần chứa ngày, theo tuần ISO để tuần đã qua được khóa nhất quán. */
const mondayOf = (ymd: string) => {
  const date = new Date(`${ymd}T00:00:00Z`);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - weekday + 1);
  return date.toISOString().slice(0, 10);
};
const isDateLocked = (date: string, today: string, policy: AttendanceLockPolicy) => {
  if (date >= today) return false;
  if (policy === 'DAILY') return true;
  if (policy === 'WEEKLY') return mondayOf(date) < mondayOf(today);
  if (policy === 'MONTHLY') return date.slice(0, 7) < today.slice(0, 7);
  return date.slice(0, 4) < today.slice(0, 4);
};
/** Ô tự nhập là số liệu theo tháng, nên chỉ khóa khi cả tháng/kỳ năm đó đã qua. */
const isManualMonthLocked = (month: string, today: string, policy: AttendanceLockPolicy) =>
  policy === 'YEARLY' ? month.slice(0, 4) < today.slice(0, 4) : month < today.slice(0, 7);
const numberValue = (value: string | number | undefined) => {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};
const codeCount = (value: string | number | undefined) => Math.round(numberValue(value) * 1_000_000) / 1_000_000;

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
  constructor(
    private readonly db: DbService,
    private readonly settings?: SettingsService,
  ) {}

  private async attendanceLockPolicy(): Promise<AttendanceLockPolicy> {
    return lockPolicyOf(this.settings ? await this.settings.get<string>('dutyAttendance.lockPolicy', 'DAILY') : 'DAILY');
  }

  /** Chỉ dò một khoảng hợp lý để không ghép nhầm nghỉ bù với ca trực đã quá xa trong lịch sử. */
  private async restPairLookbackDays(): Promise<number> {
    const configured = Number(this.settings ? await this.settings.get<number>('dutyAttendance.restPairLookbackDays', 14) : 14);
    return Number.isFinite(configured) ? Math.min(62, Math.max(1, Math.floor(configured))) : 14;
  }

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
    return { sections, columns, validations, systemMetrics: ATTENDANCE_SYSTEM_METRICS };
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
    const allowed = new Set([...ATTENDANCE_SYSTEM_METRIC_KEYS, ...codes.map((x) => x.code.toUpperCase()), ...columns.map((x) => x.key.toUpperCase())]);
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
    if (ATTENDANCE_SYSTEM_METRIC_KEYS.has(key)) throw new ConflictException(`Mã cột “${key}” được hệ thống dành cho công thức nghiệp vụ`);
    const [codes, current] = await Promise.all([this.db.db.select({ code: dutyAttendanceCodes.code }).from(dutyAttendanceCodes), this.db.db.select().from(dutyAttendanceColumns)]);
    if (codes.some((code) => code.code.toUpperCase() === key)) throw new ConflictException(`Mã cột “${key}” trùng mã ký hiệu chấm công`);
    const formula = input.columnType === 'FORMULA' ? (input.formula ?? '').trim() : '';
    if (input.columnType === 'FORMULA' && !formula) throw new BadRequestException('Cột công thức phải có biểu thức tính');
    const virtualColumns = [...current.filter((column) => column.id !== editingId), {
      id: editingId ?? -1, key, columnType: input.columnType, formula, active: input.active ?? true,
    }];
    if (formula) {
      this.validateReferences(formula, codes, virtualColumns);
      numericExpression(formula, Object.fromEntries([...ATTENDANCE_SYSTEM_METRICS.map((item) => [item.key, 0]), ...codes.map((item) => [item.code, 0]), ...virtualColumns.map((item) => [item.key, 0]) ]));
    }
    this.assertFormulaGraph(virtualColumns.map((column) => ({ key: column.key, columnType: column.columnType, formula: column.formula, active: column.active })));
    return { section, key, formula };
  }

  private async assertValidationConfig(expression: string) {
    const [codes, columns] = await Promise.all([this.db.db.select({ code: dutyAttendanceCodes.code }).from(dutyAttendanceCodes), this.db.db.select({ key: dutyAttendanceColumns.key }).from(dutyAttendanceColumns)]);
    this.validateReferences(expression, codes, columns);
    if (typeof evaluateExpression(expression, Object.fromEntries([...ATTENDANCE_SYSTEM_METRICS.map((item) => [item.key, 0]), ...codes.map((item) => [item.code, 0]), ...columns.map((item) => [item.key, 0])])) !== 'boolean') throw new BadRequestException('Ràng buộc phải là phép so sánh, ví dụ: [A] + [B] == [TONG]');
  }

  private async buildBoard(departmentId: number, month: string, overrides = new Map<string, string | null>(), entryOverrides = new Map<string, { code: string | null; note?: string }>()) {
    this.assertMonth(month);
    const [lockPolicy, restPairLookbackDays] = await Promise.all([this.attendanceLockPolicy(), this.restPairLookbackDays()]);
    const { from, to } = monthBounds(month);
    const lookbackFrom = addCalendarDays(from, -restPairLookbackDays);
    const layout = await this.activeLayout();
    const [department, staff, allCodes, metricHolidayRows, metricWorkdayRows, records, previousRecords, manualRows] = await Promise.all([
      this.db.db.select().from(departments).where(eq(departments.id, departmentId)),
      this.db.db.select({ id: users.id, fullName: users.fullName, title: users.title, username: users.username }).from(users).where(and(eq(users.departmentId, departmentId), eq(users.active, true), isNull(users.deletedAt))).orderBy(asc(users.fullName)),
      // Giữ mã ngừng dùng trong tập tính nghiệp vụ để dữ liệu lịch sử vẫn phân loại đúng,
      // nhưng chỉ trả mã đang dùng về bảng để không thể chọn thêm mã đã dừng.
      this.db.db.select().from(dutyAttendanceCodes).orderBy(asc(dutyAttendanceCodes.sortOrder), asc(dutyAttendanceCodes.code)),
      this.db.db.select().from(dutyAttendanceHolidays).where(and(gte(dutyAttendanceHolidays.holidayDate, lookbackFrom), lt(dutyAttendanceHolidays.holidayDate, to))),
      this.db.db.select().from(dutyAttendanceWorkdayOverrides).where(and(gte(dutyAttendanceWorkdayOverrides.workDate, lookbackFrom), lt(dutyAttendanceWorkdayOverrides.workDate, to))),
      this.db.db.select({ userId: dutyAttendanceEntries.userId, workDate: dutyAttendanceEntries.workDate, code: dutyAttendanceCodes.code, note: dutyAttendanceEntries.note }).from(dutyAttendanceEntries).innerJoin(dutyAttendanceCodes, eq(dutyAttendanceEntries.codeId, dutyAttendanceCodes.id)).where(and(eq(dutyAttendanceEntries.departmentId, departmentId), gte(dutyAttendanceEntries.workDate, from), lt(dutyAttendanceEntries.workDate, to))),
      this.db.db.select({ userId: dutyAttendanceEntries.userId, workDate: dutyAttendanceEntries.workDate, code: dutyAttendanceCodes.code }).from(dutyAttendanceEntries).innerJoin(dutyAttendanceCodes, eq(dutyAttendanceEntries.codeId, dutyAttendanceCodes.id)).where(and(eq(dutyAttendanceEntries.departmentId, departmentId), gte(dutyAttendanceEntries.workDate, lookbackFrom), lt(dutyAttendanceEntries.workDate, from))),
      this.db.db.select({ userId: dutyAttendanceManualValues.userId, columnId: dutyAttendanceManualValues.columnId, value: dutyAttendanceManualValues.value }).from(dutyAttendanceManualValues).where(and(eq(dutyAttendanceManualValues.departmentId, departmentId), eq(dutyAttendanceManualValues.month, month))),
    ]);
    const currentDepartment = department[0];
    if (!currentDepartment) throw new NotFoundException('Không tìm thấy khoa/phòng được gán');
    const today = bangkokToday();
    const holidays = metricHolidayRows.filter((holiday) => holiday.holidayDate >= from);
    const workdayOverrides = metricWorkdayRows.filter((workday) => workday.workDate >= from);
    const holidayDates = new Set(metricHolidayRows.map((holiday) => holiday.holidayDate));
    const workdayDates = new Set(metricWorkdayRows.map((workday) => workday.workDate));
    const dates = Array.from({ length: daysInMonth(month) }, (_, index) => {
      const date = `${month}-${String(index + 1).padStart(2, '0')}`; const dow = new Date(`${date}T00:00:00`).getDay(); const isWeekend = dow === 0 || dow === 6; const holiday = holidays.find((item) => item.holidayDate === date); const workday = workdayOverrides.find((item) => item.workDate === date);
      return { date, day: index + 1, weekday: vnWeekday(date), isWeekend, isPast: date < today, isLocked: isDateLocked(date, today, lockPolicy), isRest: holiday ? true : isWeekend && !workday, holidayName: holiday?.name ?? '', workdayName: !holiday ? workday?.name ?? '' : '', isWorkingOverride: !!workday && !holiday };
    });
    const entryByCell = new Map(records.map((record) => [`${record.userId}:${record.workDate}`, { code: record.code, note: record.note }]));
    for (const [cell, entry] of entryOverrides) { if (!entry.code) entryByCell.delete(cell); else entryByCell.set(cell, { code: entry.code, note: entry.note ?? '' }); }
    const entries = Object.fromEntries(entryByCell);
    const manualColumns = layout.columns.filter((column) => column.columnType === 'MANUAL');
    const formulaColumns = layout.columns.filter((column) => column.columnType === 'FORMULA');
    const manualByCell = new Map(manualRows.map((row) => [`${row.userId}:${row.columnId}`, row.value]));
    for (const [cell, value] of overrides) { if (value === null || value === '') manualByCell.delete(cell); else manualByCell.set(cell, value); }
    const codes = allCodes.filter((code) => code.active);
    const activeCodeKeys = new Set(codes.map((code) => code.code.toUpperCase()));
    const rowValues: Record<string, Record<string, string | number>> = {};
    const manualValues: Record<string, string> = {};
    const calculationWarnings: Record<string, string[]> = {};
    for (const person of staff) {
      const values: Record<string, string | number> = Object.fromEntries(codes.map((code) => [code.code.toUpperCase(), 0]));
      for (const date of dates) {
        const entry = entries[`${person.id}:${date.date}`];
        if (entry && activeCodeKeys.has(entry.code.toUpperCase())) {
          const code = codes.find((item) => item.code.toUpperCase() === entry.code.toUpperCase());
          if (code) values[code.code.toUpperCase()] = codeCount(values[code.code.toUpperCase()]) + codeCount(code.countValue);
        }
      }
      const metrics = calculateAttendanceMetrics({
        monthDates: dates.map((date) => date.date),
        holidayDates,
        workdayDates,
        codes: allCodes,
        entries: [
          ...previousRecords.filter((entry) => entry.userId === person.id).map((entry) => ({ date: entry.workDate, code: entry.code })),
          ...dates.flatMap((date) => {
            const entry = entryByCell.get(`${person.id}:${date.date}`);
            return entry ? [{ date: date.date, code: entry.code }] : [];
          }),
        ],
        restPairLookbackDays,
      });
      Object.assign(values, metrics.values);
      if (metrics.warnings.length) calculationWarnings[String(person.id)] = metrics.warnings;
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
    const manualViolations: Record<string, string[]> = {};
    for (const rule of layout.validations) {
      const referencedManualColumns = expressionReferences(rule.expression)
        .map((reference) => manualColumns.find((column) => column.key.toUpperCase() === reference))
        .filter((column): column is typeof manualColumns[number] => !!column);
      if (!referencedManualColumns.length) continue;
      for (const person of staff) {
        const values = rowValues[String(person.id)];
        // Để người dùng bắt đầu nhập một nhóm cột mà không báo đỏ khi toàn bộ còn trống,
        // nhưng ngay khi có ít nhất một giá trị thì mọi ô liên quan phải báo rõ nếu chưa đạt.
        if (!referencedManualColumns.some((column) => String(values?.[column.key.toUpperCase()] ?? '').trim())) continue;
        if (booleanExpression(rule.expression, values)) continue;
        const message = rule.message || `Ràng buộc “${rule.name}” chưa thỏa mãn`;
        for (const column of referencedManualColumns) {
          const cell = `${person.id}:${column.id}`;
          manualViolations[cell] = [...(manualViolations[cell] ?? []), message];
        }
      }
    }
    return {
      month,
      today,
      lockPolicy,
      manualLocked: isManualMonthLocked(month, today, lockPolicy),
      department: { id: currentDepartment.id, name: currentDepartment.name, hospital: currentDepartment.hospital },
      dates,
      codes,
      sections: layout.sections,
      columns: layout.columns,
      validations: layout.validations,
      systemMetrics: ATTENDANCE_SYSTEM_METRICS,
      restPairLookbackDays,
      staff: staff.map((person, index) => ({ stt: index + 1, ...person })),
      entries,
      manualValues,
      manualViolations,
      calculationWarnings,
      rowValues,
      holidays,
      workdayOverrides,
    };
  }

  async month(user: AccessContext, q: AttendanceMonthQueryDto) { this.assertMonth(q.month); return this.buildBoard(await this.deptId(user, q.departmentId), q.month); }

  async save(user: AccessContext, dto: SaveAttendanceEntriesDto) {
    const departmentId = await this.deptId(user, dto.departmentId);
    if (!dto.entries.length) return { saved: 0 };
    const dates = [...new Set(dto.entries.map((entry) => entry.workDate))];
    const today = bangkokToday();
    const lockPolicy = await this.attendanceLockPolicy();
    for (const date of dates) {
      if (!YMD.test(date)) throw new BadRequestException('Ngày chấm công không hợp lệ');
      if (isDateLocked(date, today, lockPolicy)) throw new ForbiddenException(`Không được sửa chấm công ngày ${fmtDate(date)} theo chế độ khóa bảng hiện tại`);
    }
    const personIds = [...new Set(dto.entries.map((entry) => entry.userId))];
    const [staff, activeCodes] = await Promise.all([
      this.db.db.select({ id: users.id }).from(users).where(and(inArray(users.id, personIds), eq(users.departmentId, departmentId), eq(users.active, true), isNull(users.deletedAt))),
      this.db.db.select({ id: dutyAttendanceCodes.id, code: dutyAttendanceCodes.code }).from(dutyAttendanceCodes).where(eq(dutyAttendanceCodes.active, true)),
    ]);
    if (staff.length !== personIds.length) throw new ForbiddenException('Chỉ được chấm công cho nhân viên đang hoạt động thuộc khoa của bạn');
    const byCode = new Map(activeCodes.map((code) => [code.code.toUpperCase(), code.id]));
    // Ràng buộc giữa các cột là tín hiệu trực quan trên bảng, không được phép
    // làm mất hay từ chối số liệu hợp lệ người dùng vừa nhập.
    for (const entry of dto.entries) {
      const code = entry.code?.trim().toUpperCase() || null;
      if (code && !byCode.has(code)) throw new BadRequestException(`Ký hiệu “${code}” không tồn tại hoặc đã ngừng sử dụng`);
    }
    await this.db.transaction(async (tx) => {
      for (const entry of dto.entries) {
        const code = entry.code?.trim().toUpperCase();
        if (!code) { await tx.delete(dutyAttendanceEntries).where(and(eq(dutyAttendanceEntries.userId, entry.userId), eq(dutyAttendanceEntries.workDate, entry.workDate), eq(dutyAttendanceEntries.departmentId, departmentId))); continue; }
        const codeId = byCode.get(code); if (!codeId) throw new BadRequestException(`Ký hiệu “${code}” không tồn tại hoặc đã ngừng sử dụng`);
        await tx.insert(dutyAttendanceEntries).values({ departmentId, userId: entry.userId, workDate: entry.workDate, codeId, note: entry.note?.trim() ?? '', updatedBy: user.id }).onConflictDoUpdate({ target: [dutyAttendanceEntries.userId, dutyAttendanceEntries.workDate], set: { departmentId, codeId, note: entry.note?.trim() ?? '', updatedBy: user.id, updatedAt: new Date() } });
      }
    });
    return { saved: dto.entries.length };
  }

  async saveManualValues(user: AccessContext, dto: SaveAttendanceManualValuesDto) {
    const departmentId = await this.deptId(user, dto.departmentId); this.assertMonth(dto.month);
    if (!dto.values.length) return { saved: 0 };
    const today = bangkokToday();
    const lockPolicy = await this.attendanceLockPolicy();
    if (isManualMonthLocked(dto.month, today, lockPolicy)) throw new ForbiddenException('Tháng/kỳ năm đã qua được khóa theo chế độ khóa bảng hiện tại');
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
  private assertNotSystemMetricCode(code: string) { if (ATTENDANCE_SYSTEM_METRIC_KEYS.has(code)) throw new ConflictException(`Mã ký hiệu “${code}” được hệ thống dành cho biến công thức nghiệp vụ`); }
  async createCode(dto: AttendanceCodeDto) {
    const code = dto.code.trim().toUpperCase(); this.assertNotSystemMetricCode(code);
    const group = await this.assertActiveCodeGroup(dto.group);
    const [item] = await this.db.db.insert(dutyAttendanceCodes).values({ code, name: dto.name.trim(), group, color: dto.color ?? '#0f766e', countsAsDuty: dto.countsAsDuty ?? false, showSummary: dto.showSummary ?? true, countValue: this.countValue(dto.countValue), calculationRole: dto.calculationRole ?? 'NONE', deductsWorkday: dto.deductsWorkday ?? false, restSource: dto.restSource ?? 'ANY_DUTY', sortOrder: dto.sortOrder ?? 0, active: dto.active ?? true, note: dto.note?.trim() ?? '' }).returning(); return item;
  }
  async updateCode(id: number, dto: Partial<AttendanceCodeDto>) {
    const [current] = await this.db.db.select({ group: dutyAttendanceCodes.group }).from(dutyAttendanceCodes).where(eq(dutyAttendanceCodes.id, id));
    if (!current) throw new NotFoundException('Không tìm thấy ký hiệu');
    const requestedCode = dto.code?.trim().toUpperCase(); if (requestedCode) this.assertNotSystemMetricCode(requestedCode);
    const requestedGroup = dto.group?.trim().toUpperCase();
    const group = requestedGroup === undefined ? undefined : requestedGroup === current.group ? current.group : await this.assertActiveCodeGroup(requestedGroup);
    const values = { ...(requestedCode !== undefined ? { code: requestedCode } : {}), ...(dto.name !== undefined ? { name: dto.name.trim() } : {}), ...(group !== undefined ? { group } : {}), ...(dto.color !== undefined ? { color: dto.color } : {}), ...(dto.countsAsDuty !== undefined ? { countsAsDuty: dto.countsAsDuty } : {}), ...(dto.showSummary !== undefined ? { showSummary: dto.showSummary } : {}), ...(dto.countValue !== undefined ? { countValue: this.countValue(dto.countValue) } : {}), ...(dto.calculationRole !== undefined ? { calculationRole: dto.calculationRole } : {}), ...(dto.deductsWorkday !== undefined ? { deductsWorkday: dto.deductsWorkday } : {}), ...(dto.restSource !== undefined ? { restSource: dto.restSource } : {}), ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}), ...(dto.active !== undefined ? { active: dto.active } : {}), ...(dto.note !== undefined ? { note: dto.note.trim() } : {}), updatedAt: new Date() };
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
  async workdayOverrides(q: AttendanceMonthQueryDto) { this.assertMonth(q.month); const { from, to } = monthBounds(q.month); return this.db.db.select().from(dutyAttendanceWorkdayOverrides).where(and(gte(dutyAttendanceWorkdayOverrides.workDate, from), lt(dutyAttendanceWorkdayOverrides.workDate, to))).orderBy(asc(dutyAttendanceWorkdayOverrides.workDate)); }
  private assertCalendarDate(value: string, label: string) { if (!YMD.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new BadRequestException(`${label} không hợp lệ`); }
  /** Người dùng chủ động sửa/thêm ngày lễ sẽ trở thành ngày bệnh viện khai báo, không bị lịch mẫu quốc gia ghi đè sau này. */
  async saveHoliday(user: AccessContext, dto: AttendanceHolidayDto) {
    this.assertCalendarDate(dto.holidayDate, 'Ngày nghỉ/lễ'); const holidayYear = Number(dto.holidayDate.slice(0, 4));
    return this.db.transaction(async (tx) => {
      const [workday] = await tx.select().from(dutyAttendanceWorkdayOverrides).where(eq(dutyAttendanceWorkdayOverrides.workDate, dto.holidayDate));
      if (workday?.source === 'HOSPITAL') throw new ConflictException('Ngày này đang là ngày làm việc do bệnh viện khai báo. Hãy xóa hoặc điều chỉnh ngày làm việc trước.');
      if (workday) await tx.delete(dutyAttendanceWorkdayOverrides).where(eq(dutyAttendanceWorkdayOverrides.id, workday.id));
      const [item] = await tx.insert(dutyAttendanceHolidays).values({ holidayDate: dto.holidayDate, name: dto.name.trim(), note: dto.note?.trim() ?? '', source: 'HOSPITAL', ruleKey: '', holidayYear: Number.isInteger(holidayYear) ? holidayYear : null, createdBy: user.id }).onConflictDoUpdate({ target: dutyAttendanceHolidays.holidayDate, set: { name: dto.name.trim(), note: dto.note?.trim() ?? '', source: 'HOSPITAL', ruleKey: '', holidayYear: Number.isInteger(holidayYear) ? holidayYear : null } }).returning(); return item;
    });
  }
  async deleteHoliday(id: number) { const [item] = await this.db.db.delete(dutyAttendanceHolidays).where(eq(dutyAttendanceHolidays.id, id)).returning(); if (!item) throw new NotFoundException('Không tìm thấy ngày nghỉ'); return { deleted: true }; }
  /** Khai báo ngày làm việc thay thế của bệnh viện. Nếu thay thế lịch mẫu, chỉ lịch mẫu được gỡ bỏ; dữ liệu bệnh viện luôn phải được xử lý rõ ràng. */
  async saveWorkdayOverride(user: AccessContext, dto: AttendanceWorkdayOverrideDto) {
    this.assertCalendarDate(dto.workDate, 'Ngày làm việc'); const workdayYear = Number(dto.workDate.slice(0, 4));
    return this.db.transaction(async (tx) => {
      const [holiday] = await tx.select().from(dutyAttendanceHolidays).where(eq(dutyAttendanceHolidays.holidayDate, dto.workDate));
      if (holiday?.source === 'HOSPITAL') throw new ConflictException('Ngày này đang là ngày nghỉ/lễ do bệnh viện khai báo. Hãy xóa hoặc điều chỉnh ngày nghỉ trước.');
      if (holiday) await tx.delete(dutyAttendanceHolidays).where(eq(dutyAttendanceHolidays.id, holiday.id));
      const [item] = await tx.insert(dutyAttendanceWorkdayOverrides).values({ workDate: dto.workDate, name: dto.name.trim(), note: dto.note?.trim() ?? '', source: 'HOSPITAL', ruleKey: '', workdayYear: Number.isInteger(workdayYear) ? workdayYear : null, createdBy: user.id }).onConflictDoUpdate({ target: dutyAttendanceWorkdayOverrides.workDate, set: { name: dto.name.trim(), note: dto.note?.trim() ?? '', source: 'HOSPITAL', ruleKey: '', workdayYear: Number.isInteger(workdayYear) ? workdayYear : null } }).returning(); return item;
    });
  }
  async deleteWorkdayOverride(id: number) { const [item] = await this.db.db.delete(dutyAttendanceWorkdayOverrides).where(eq(dutyAttendanceWorkdayOverrides.id, id)).returning(); if (!item) throw new NotFoundException('Không tìm thấy ngày làm việc hoán đổi'); return { deleted: true }; }

  private nationalHolidayConfig(dto: NationalHolidayPlanDto): NationalHolidayPlanConfig {
    return { year: dto.year, tetStartOffset: dto.tetStartOffset, tetDayCount: dto.tetDayCount, nationalDayAdjacent: dto.nationalDayAdjacent, compensateWeeklyRest: dto.compensateWeeklyRest, additionalRestDays: dto.additionalRestDays ?? [], compensatoryWorkdays: dto.compensatoryWorkdays ?? [], note: dto.note?.trim() ?? '' };
  }
  private storedNationalHolidayConfig(stored: typeof dutyAttendanceNationalHolidayPlans.$inferSelect): NationalHolidayPlanConfig {
    return { year: stored.year, tetStartOffset: stored.tetStartOffset, tetDayCount: stored.tetDayCount, nationalDayAdjacent: stored.nationalDayAdjacent, compensateWeeklyRest: stored.compensateWeeklyRest, additionalRestDays: Array.isArray(stored.additionalRestDays) ? stored.additionalRestDays : [], compensatoryWorkdays: Array.isArray(stored.compensatoryWorkdays) ? stored.compensatoryWorkdays : [], note: stored.note };
  }
  private proposalFor(config: NationalHolidayPlanConfig) {
    try { return nationalHolidayProposal(config); } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Không tạo được dự thảo lịch nghỉ lễ'); }
  }
  private planValues(plan: NationalHolidayPlanConfig) { return { ...plan, additionalRestDays: plan.additionalRestDays ?? [], compensatoryWorkdays: plan.compensatoryWorkdays ?? [] }; }
  async nationalHolidayPlan(year: number) {
    const [stored] = await this.db.db.select().from(dutyAttendanceNationalHolidayPlans).where(eq(dutyAttendanceNationalHolidayPlans.year, year));
    const plan = stored ? this.storedNationalHolidayConfig(stored) : defaultNationalHolidayPlan(year);
    return { ...this.proposalFor(plan), saved: !!stored };
  }
  async previewNationalHolidayPlan(dto: NationalHolidayPlanDto) { return { ...this.proposalFor(this.nationalHolidayConfig(dto)), saved: false }; }
  async saveNationalHolidayPlan(user: AccessContext, dto: NationalHolidayPlanDto) {
    const plan = this.proposalFor(this.nationalHolidayConfig(dto)).plan;
    const [stored] = await this.db.db.insert(dutyAttendanceNationalHolidayPlans).values({ ...this.planValues(plan), createdBy: user.id, updatedBy: user.id }).onConflictDoUpdate({ target: dutyAttendanceNationalHolidayPlans.year, set: { tetStartOffset: plan.tetStartOffset, tetDayCount: plan.tetDayCount, nationalDayAdjacent: plan.nationalDayAdjacent, compensateWeeklyRest: plan.compensateWeeklyRest, additionalRestDays: plan.additionalRestDays ?? [], compensatoryWorkdays: plan.compensatoryWorkdays ?? [], note: plan.note ?? '', updatedBy: user.id, updatedAt: new Date() } }).returning();
    return { ...this.proposalFor(this.storedNationalHolidayConfig(stored)), saved: true };
  }
  /**
   * Áp dụng dự thảo sau xác nhận. Khi phương án cùng năm đổi, chỉ các dòng NATIONAL_TEMPLATE
   * đã trở nên lỗi thời mới được gỡ trong cùng giao dịch. Dòng HOSPITAL không bao giờ bị ghi đè/xóa.
   */
  async applyNationalHolidayPlan(user: AccessContext, dto: NationalHolidayPlanDto) {
    const proposal = this.proposalFor(this.nationalHolidayConfig(dto)); const plan = proposal.plan;
    const from = `${plan.year}-01-01`; const to = `${plan.year + 1}-01-01`;
    return this.db.transaction(async (tx) => {
      const [stored] = await tx.insert(dutyAttendanceNationalHolidayPlans).values({ ...this.planValues(plan), createdBy: user.id, updatedBy: user.id }).onConflictDoUpdate({ target: dutyAttendanceNationalHolidayPlans.year, set: { tetStartOffset: plan.tetStartOffset, tetDayCount: plan.tetDayCount, nationalDayAdjacent: plan.nationalDayAdjacent, compensateWeeklyRest: plan.compensateWeeklyRest, additionalRestDays: plan.additionalRestDays ?? [], compensatoryWorkdays: plan.compensatoryWorkdays ?? [], note: plan.note ?? '', updatedBy: user.id, updatedAt: new Date() } }).returning();
      const [holidayRows, workdayRows] = await Promise.all([
        tx.select().from(dutyAttendanceHolidays).where(and(gte(dutyAttendanceHolidays.holidayDate, from), lt(dutyAttendanceHolidays.holidayDate, to))),
        tx.select().from(dutyAttendanceWorkdayOverrides).where(and(gte(dutyAttendanceWorkdayOverrides.workDate, from), lt(dutyAttendanceWorkdayOverrides.workDate, to))),
      ]);
      const plannedHolidayDates = new Set(proposal.candidates.map((candidate) => candidate.date)); const plannedWorkdayDates = new Set(proposal.workdayCandidates.map((candidate) => candidate.date));
      let removed = 0; let removedWorkdays = 0;
      for (const current of holidayRows) if (current.source === 'NATIONAL_TEMPLATE' && current.holidayYear === plan.year && !plannedHolidayDates.has(current.holidayDate)) { await tx.delete(dutyAttendanceHolidays).where(eq(dutyAttendanceHolidays.id, current.id)); removed += 1; }
      for (const current of workdayRows) if (current.source === 'NATIONAL_TEMPLATE' && current.workdayYear === plan.year && !plannedWorkdayDates.has(current.workDate)) { await tx.delete(dutyAttendanceWorkdayOverrides).where(eq(dutyAttendanceWorkdayOverrides.id, current.id)); removedWorkdays += 1; }
      const holidaysByDate = new Map(holidayRows.filter((row) => !(row.source === 'NATIONAL_TEMPLATE' && row.holidayYear === plan.year && !plannedHolidayDates.has(row.holidayDate))).map((row) => [row.holidayDate, row]));
      const workdaysByDate = new Map(workdayRows.filter((row) => !(row.source === 'NATIONAL_TEMPLATE' && row.workdayYear === plan.year && !plannedWorkdayDates.has(row.workDate))).map((row) => [row.workDate, row]));
      let added = 0; let updated = 0; let preservedHospital = 0; let unchanged = 0; let addedWorkdays = 0; let updatedWorkdays = 0; let unchangedWorkdays = 0; let templateConflicts = 0;
      for (const candidate of proposal.candidates) {
        const current = holidaysByDate.get(candidate.date); const workday = workdaysByDate.get(candidate.date);
        if (!current && workday) { if (workday.source === 'HOSPITAL') preservedHospital += 1; else templateConflicts += 1; continue; }
        if (!current) { await tx.insert(dutyAttendanceHolidays).values({ holidayDate: candidate.date, name: candidate.name, note: candidate.note, source: 'NATIONAL_TEMPLATE', ruleKey: candidate.ruleKey, holidayYear: plan.year, createdBy: user.id }); added += 1; continue; }
        if (current.source === 'HOSPITAL') { preservedHospital += 1; continue; }
        if (current.name === candidate.name && current.note === candidate.note && current.ruleKey === candidate.ruleKey && current.holidayYear === plan.year) { unchanged += 1; continue; }
        await tx.update(dutyAttendanceHolidays).set({ name: candidate.name, note: candidate.note, source: 'NATIONAL_TEMPLATE', ruleKey: candidate.ruleKey, holidayYear: plan.year }).where(eq(dutyAttendanceHolidays.id, current.id)); updated += 1;
      }
      for (const candidate of proposal.workdayCandidates) {
        const current = workdaysByDate.get(candidate.date); const holiday = holidaysByDate.get(candidate.date);
        if (!current && holiday) { if (holiday.source === 'HOSPITAL') preservedHospital += 1; else templateConflicts += 1; continue; }
        if (!current) { await tx.insert(dutyAttendanceWorkdayOverrides).values({ workDate: candidate.date, name: candidate.name, note: candidate.note, source: 'NATIONAL_TEMPLATE', ruleKey: candidate.ruleKey, workdayYear: plan.year, createdBy: user.id }); addedWorkdays += 1; continue; }
        if (current.source === 'HOSPITAL') { preservedHospital += 1; continue; }
        if (current.name === candidate.name && current.note === candidate.note && current.ruleKey === candidate.ruleKey && current.workdayYear === plan.year) { unchangedWorkdays += 1; continue; }
        await tx.update(dutyAttendanceWorkdayOverrides).set({ name: candidate.name, note: candidate.note, source: 'NATIONAL_TEMPLATE', ruleKey: candidate.ruleKey, workdayYear: plan.year }).where(eq(dutyAttendanceWorkdayOverrides.id, current.id)); updatedWorkdays += 1;
      }
      return { ...proposal, plan: this.storedNationalHolidayConfig(stored), saved: true, added, updated, removed, preservedHospital, unchanged, addedWorkdays, updatedWorkdays, removedWorkdays, unchangedWorkdays, templateConflicts };
    });
  }

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
