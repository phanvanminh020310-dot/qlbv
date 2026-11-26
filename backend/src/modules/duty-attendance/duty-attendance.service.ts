import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import * as ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType } from 'docx';
import { DbService, type Executor } from '../../db/db.service';
import {
  departments,
  dutyAttendanceCodeGroups,
  dutyAttendanceCodes,
  dutyAttendanceColumnGroups,
  dutyAttendanceColumns,
  dutyAttendanceDailyNotes,
  dutyAttendanceDepartmentAssignments,
  dutyAttendanceEntries,
  dutyAttendanceEntryCodes,
  dutyAttendanceHolidays,
  dutyAttendanceManualValues,
  dutyAttendanceNationalHolidayPlans,
  dutyAttendanceSections,
  dutyAttendanceWorkdayOverrides,
  dutyAttendanceValidations,
  jobTitles,
  managementPositions,
  userManagementPositions,
  users,
  type DutyAttendanceColumnType,
} from '../../db/schema';
import type { AccessContext } from '../../common/types/access-context';
import { renderPrintDocument } from '../../infra/rendering/pdf-renderer';
import { SettingsService } from '../settings/settings.service';
import { bangkokToday } from '../duty/duty-rules';
import { booleanExpression, evaluateExpression, expressionReferences, numericExpression } from './attendance-expression';
import { ATTENDANCE_SYSTEM_METRICS, ATTENDANCE_SYSTEM_METRIC_KEYS, attendanceRestBalance, calculateAttendanceMetrics } from './attendance-metrics';
import { MAX_COLUMN_GROUP_DEPTH, buildHeaderCells, groupPath, orderColumnsByTree, replaceFormulaReferences, applyReplacements, visibleGroupIds, type HeaderCell } from './attendance-layout';
import { defaultNationalHolidayPlan, nationalHolidayProposal, type NationalHolidayPlanConfig } from './national-holiday-plan';
import type {
  AttendanceCodeDto,
  AttendanceCodeGroupDto,
  AttendanceColumnDto,
  AttendanceColumnGroupDto,
  DuplicateAttendanceColumnGroupDto,
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
export const ATTENDANCE_STAFF_ORDER_MODES = ['PROFESSIONAL', 'MANAGEMENT_THEN_PROFESSIONAL'] as const;
export type AttendanceStaffOrderMode = (typeof ATTENDANCE_STAFF_ORDER_MODES)[number];

/** Dữ liệu chưa có danh mục luôn xếp sau; không bao giờ dùng ID danh mục làm thứ tự. */
const compareCatalogSortOrder = (left: number | null, right: number | null) => {
  if (left === null && right !== null) return 1;
  if (left !== null && right === null) return -1;
  return (left ?? 0) - (right ?? 0);
};

/**
 * Có thể cấu hình ưu tiên chức danh chuyên môn hoặc chức vụ quản lý trước.
 * Chức danh luôn là tiêu chí kế tiếp và users.id là thứ tự phụ ổn định.
 */
const compareByAttendanceStaffOrder = (
  a: { id: number; titleSortOrder: number | null; managementPositionSortOrder: number | null },
  b: { id: number; titleSortOrder: number | null; managementPositionSortOrder: number | null },
  mode: AttendanceStaffOrderMode,
) => {
  if (mode === 'MANAGEMENT_THEN_PROFESSIONAL') {
    const management = compareCatalogSortOrder(a.managementPositionSortOrder, b.managementPositionSortOrder);
    if (management) return management;
  }
  const title = compareCatalogSortOrder(a.titleSortOrder, b.titleSortOrder);
  return title || a.id - b.id;
};
export const ATTENDANCE_LOCK_POLICIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
export type AttendanceLockPolicy = (typeof ATTENDANCE_LOCK_POLICIES)[number];
const SYSTEM_SECTION_CODES = new Set(['ADMIN', 'DAYS', 'SYMBOLS', 'REPORT']);
const monthBounds = (month: string) => ({ from: `${month}-01`, to: `${month === '9999-12' ? '10000-01' : `${Number(month.slice(0, 4)) + (month.endsWith('-12') ? 1 : 0)}-${String((Number(month.slice(5)) % 12) + 1).padStart(2, '0')}`}-01` });
const daysInMonth = (month: string) => new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
const fmtDate = (ymd: string) => { const [y, m, d] = ymd.split('-'); return `${d}/${m}/${y}`; };
const vnWeekday = (ymd: string) => ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][new Date(`${ymd}T00:00:00`).getDay()];
const lockPolicyOf = (value: unknown): AttendanceLockPolicy => {
  const candidate = String(value ?? '').trim().toUpperCase();
  return (ATTENDANCE_LOCK_POLICIES as readonly string[]).includes(candidate) ? candidate as AttendanceLockPolicy : 'DAILY';
};
const staffOrderModeOf = (value: unknown): AttendanceStaffOrderMode => {
  const candidate = String(value ?? '').trim().toUpperCase();
  return (ATTENDANCE_STAFF_ORDER_MODES as readonly string[]).includes(candidate) ? candidate as AttendanceStaffOrderMode : 'MANAGEMENT_THEN_PROFESSIONAL';
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
  groups: Awaited<ReturnType<DutyAttendanceService['layout']>>['groups'];
  validations: Awaited<ReturnType<DutyAttendanceService['layout']>>['validations'];
};
type Board = Awaited<ReturnType<DutyAttendanceService['month']>>;
type DisplayColumn = { key: string; name: string; source: 'ADMIN' | 'DAY' | 'VALUE'; section: Board['sections'][number]; day?: Board['dates'][number]; column?: Board['columns'][number]; path: Array<{ id: number; name: string; color: string }> };

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

  private async attendanceStaffOrderMode(): Promise<AttendanceStaffOrderMode> {
    return staffOrderModeOf(this.settings ? await this.settings.get<string>('dutyAttendance.staffOrderMode', 'MANAGEMENT_THEN_PROFESSIONAL') : 'MANAGEMENT_THEN_PROFESSIONAL');
  }

  /**
   * Toàn bộ ký hiệu đã lưu của các nhân viên (mọi khoa, mọi ngày) để tính số dư nghỉ bù
   * tích lũy theo người. entry_codes là nguồn nhiều ký hiệu; dòng entries cũ chỉ dùng
   * dự phòng cho ô (khoa, người, ngày) chưa có ký hiệu mới, đúng như bảng chấm công.
   * Khóa ô là `departmentId:userId:workDate`.
   */
  private async attendanceCodeHistory(executor: Executor, userIds: number[], codeById: Map<number, string>) {
    const cells = new Map<string, string[]>();
    if (!userIds.length) return cells;
    const [modernRows, legacyRows] = await Promise.all([
      executor.select({ departmentId: dutyAttendanceEntryCodes.departmentId, userId: dutyAttendanceEntryCodes.userId, workDate: dutyAttendanceEntryCodes.workDate, codeId: dutyAttendanceEntryCodes.codeId }).from(dutyAttendanceEntryCodes).where(inArray(dutyAttendanceEntryCodes.userId, userIds)),
      executor.select({ departmentId: dutyAttendanceEntries.departmentId, userId: dutyAttendanceEntries.userId, workDate: dutyAttendanceEntries.workDate, codeId: dutyAttendanceEntries.codeId }).from(dutyAttendanceEntries).where(inArray(dutyAttendanceEntries.userId, userIds)),
    ]);
    const add = (row: { departmentId: number; userId: number; workDate: string; codeId: number }) => {
      const code = codeById.get(row.codeId); if (!code) return;
      const cell = `${row.departmentId}:${row.userId}:${row.workDate}`; const current = cells.get(cell) ?? [];
      if (!current.includes(code)) cells.set(cell, [...current, code]);
    };
    for (const row of modernRows) add(row);
    const modernCells = new Set(cells.keys());
    for (const row of legacyRows) if (!modernCells.has(`${row.departmentId}:${row.userId}:${row.workDate}`)) add(row);
    return cells;
  }

  /** Tách khóa ô lịch sử thành khoa, người, ngày. */
  private historyCell(cell: string) {
    const [departmentId, userId, workDate] = cell.split(':');
    return { departmentId: Number(departmentId), userId: Number(userId), workDate: workDate! };
  }

  /** Vai trò phạm vi TOÀN VIỆN (gồm Điều phối chấm công KHTH) được chọn khoa rõ ràng. */
  private canSelectAnyDepartment(user: AccessContext) { return user.isSuperAdmin || user.dataScope === 'ALL'; }

  /**
   * Chuẩn hóa phạm vi khoa được chọn. `departmentId` được giữ để các liên kết/API
   * cũ tiếp tục dùng được; `departmentIds` là phạm vi nhiều khoa mới.
   */
  private async deptIds(user: AccessContext, requestedDepartmentId?: number, requestedDepartmentIds?: number[]) {
    const requested = [...new Set([...(requestedDepartmentIds ?? []), ...(requestedDepartmentId ? [requestedDepartmentId] : [])])];
    if (!this.canSelectAnyDepartment(user)) {
      if (!user.departmentId) throw new ForbiddenException('Tài khoản chưa được gán khoa/phòng; không thể nhập bảng chấm công');
      if (requested.some((id) => id !== user.departmentId)) throw new ForbiddenException('Bạn chỉ được xem và chấm công cho khoa/phòng được gán');
      return [user.departmentId];
    }
    if (!requested.length) throw new BadRequestException('Vui lòng chọn khoa/phòng cần xem bảng chấm công');
    const rows = await this.db.db.select({ id: departments.id }).from(departments).where(and(inArray(departments.id, requested), eq(departments.active, true), isNull(departments.deletedAt)));
    if (rows.length !== requested.length) throw new NotFoundException('Có khoa/phòng không tồn tại hoặc đã ngừng hoạt động');
    return rows.map((row) => row.id).sort((a, b) => a - b);
  }

  /** Phép ghi một ô luôn chỉ thuộc một khoa; phạm vi nhiều khoa chỉ dành cho xem/xuất. */
  private async deptId(user: AccessContext, requestedDepartmentId?: number) {
    const ids = await this.deptIds(user, requestedDepartmentId);
    return ids[0]!;
  }

  async availableDepartments(user: AccessContext) {
    if (this.canSelectAnyDepartment(user)) {
      const items = await this.db.db.select({ id: departments.id, name: departments.name, code: departments.code, shortName: departments.shortName }).from(departments).where(and(eq(departments.active, true), isNull(departments.deletedAt))).orderBy(asc(departments.name));
      return { canSelect: true, items };
    }
    const id = (await this.deptIds(user))[0]!;
    const [item] = await this.db.db.select({ id: departments.id, name: departments.name, code: departments.code, shortName: departments.shortName }).from(departments).where(eq(departments.id, id));
    return { canSelect: false, items: item ? [item] : [] };
  }

  /** Khoa có hiệu lực tại đầu ngày; nếu chưa có nhật ký (dữ liệu trước nâng cấp), dùng khoa hiện tại làm mốc tương thích. */
  private departmentAtDate(
    assignments: Array<{ departmentId: number; effectiveFrom: string }>,
    fallbackDepartmentId: number | null,
    date: string,
  ) {
    let departmentId: number | null = null;
    for (const assignment of assignments) {
      if (assignment.effectiveFrom > date) break;
      departmentId = assignment.departmentId;
    }
    return departmentId ?? fallbackDepartmentId;
  }

  private assignedToDepartmentInMonth(
    assignments: Array<{ departmentId: number; effectiveFrom: string }>,
    fallbackDepartmentId: number | null,
    departmentId: number,
    month: string,
  ) {
    const { from, to } = monthBounds(month);
    if (!assignments.length) return fallbackDepartmentId === departmentId;
    const points = [from, ...assignments.filter((assignment) => assignment.effectiveFrom >= from && assignment.effectiveFrom < to).map((assignment) => assignment.effectiveFrom)];
    return points.some((date) => this.departmentAtDate(assignments, fallbackDepartmentId, date) === departmentId);
  }

  private assertMonth(month: string) { if (!MONTH.test(month)) throw new BadRequestException('Tháng phải có dạng YYYY-MM'); }

  /** Layout đầy đủ (kể cả ngừng dùng) dành cho màn hình khai báo. */
  async layout() {
    const [sections, columns, groups, validations] = await Promise.all([
      this.db.db.select().from(dutyAttendanceSections).orderBy(asc(dutyAttendanceSections.sortOrder), asc(dutyAttendanceSections.id)),
      this.db.db.select().from(dutyAttendanceColumns).orderBy(asc(dutyAttendanceColumns.sortOrder), asc(dutyAttendanceColumns.id)),
      this.db.db.select().from(dutyAttendanceColumnGroups).orderBy(asc(dutyAttendanceColumnGroups.sortOrder), asc(dutyAttendanceColumnGroups.id)),
      this.db.db.select().from(dutyAttendanceValidations).orderBy(asc(dutyAttendanceValidations.sortOrder), asc(dutyAttendanceValidations.id)),
    ]);
    // Cột trả về theo đúng thứ tự cây nhóm để màn hình khai báo và bảng hiển thị giống nhau.
    return { sections, columns: orderColumnsByTree(sections.map((section) => section.id), groups, columns), groups, validations, systemMetrics: ATTENDANCE_SYSTEM_METRICS };
  }

  private async activeLayout(): Promise<ActiveLayout> {
    const [sections, allColumns, allGroups, validations] = await Promise.all([
      this.db.db.select().from(dutyAttendanceSections).where(eq(dutyAttendanceSections.active, true)).orderBy(asc(dutyAttendanceSections.sortOrder), asc(dutyAttendanceSections.id)),
      this.db.db.select().from(dutyAttendanceColumns).where(eq(dutyAttendanceColumns.active, true)).orderBy(asc(dutyAttendanceColumns.sortOrder), asc(dutyAttendanceColumns.id)),
      this.db.db.select().from(dutyAttendanceColumnGroups).orderBy(asc(dutyAttendanceColumnGroups.sortOrder), asc(dutyAttendanceColumnGroups.id)),
      this.db.db.select().from(dutyAttendanceValidations).where(eq(dutyAttendanceValidations.active, true)).orderBy(asc(dutyAttendanceValidations.sortOrder), asc(dutyAttendanceValidations.id)),
    ]);
    // Ẩn một nhóm thì ẩn cả nhánh con của nó (nhóm con và cột) khỏi bảng/xuất file.
    const visible = visibleGroupIds(allGroups);
    const groups = allGroups.filter((group) => visible.has(group.id));
    const columns = orderColumnsByTree(sections.map((section) => section.id), groups, allColumns.filter((column) => !column.groupId || visible.has(column.groupId)));
    return { sections, columns, groups, validations };
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
    if (input.groupId) {
      const [group] = await this.db.db.select().from(dutyAttendanceColumnGroups).where(eq(dutyAttendanceColumnGroups.id, input.groupId));
      if (!group) throw new NotFoundException('Không tìm thấy nhóm tiêu đề cột');
      if (group.sectionId !== input.sectionId) throw new BadRequestException('Nhóm tiêu đề phải thuộc cùng phần với cột');
    }
    if (ATTENDANCE_SYSTEM_METRIC_KEYS.has(key)) throw new ConflictException(`Mã cột “${key}” được hệ thống dành cho công thức nghiệp vụ`);
    const [codes, current] = await Promise.all([this.db.db.select({ code: dutyAttendanceCodes.code }).from(dutyAttendanceCodes), this.db.db.select().from(dutyAttendanceColumns)]);
    if (codes.some((code) => code.code.toUpperCase() === key)) throw new ConflictException(`Mã cột “${key}” trùng mã ký hiệu chấm công`);
    if (current.some((column) => column.id !== editingId && column.key.toUpperCase() === key)) throw new ConflictException(`Mã cột “${key}” đã được dùng`);
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

  /** Xây dựng bảng của một khoa, bao gồm mốc chuyển khoa và dữ liệu lịch sử đã ghi. */
  private async buildSingleBoard(departmentId: number, month: string, overrides = new Map<string, string | null>()) {
    this.assertMonth(month);
    const [lockPolicy, staffOrderMode] = await Promise.all([this.attendanceLockPolicy(), this.attendanceStaffOrderMode()]);
    const { from, to } = monthBounds(month);
    const layout = await this.activeLayout();
    const [department, allCodes, metricHolidayRows, metricWorkdayRows, dailyCodeRows, legacyCodeRows, dailyNotes, manualRows, departmentAssignmentRows, currentDepartmentUsers] = await Promise.all([
      this.db.db.select().from(departments).where(eq(departments.id, departmentId)),
      // Giữ mã ngừng dùng trong tập tính nghiệp vụ để dữ liệu lịch sử vẫn phân loại đúng,
      // nhưng chỉ trả mã đang dùng về bảng để không thể chọn thêm mã đã dừng.
      this.db.db.select().from(dutyAttendanceCodes).orderBy(asc(dutyAttendanceCodes.sortOrder), asc(dutyAttendanceCodes.code)),
      // Lấy mọi ngày lễ/làm bù: nghỉ bù tích lũy có thể trừ vào ca Trực ở bất kỳ tháng nào.
      this.db.db.select().from(dutyAttendanceHolidays),
      this.db.db.select().from(dutyAttendanceWorkdayOverrides),
      this.db.db.select({ userId: dutyAttendanceEntryCodes.userId, workDate: dutyAttendanceEntryCodes.workDate, code: dutyAttendanceCodes.code }).from(dutyAttendanceEntryCodes).innerJoin(dutyAttendanceCodes, eq(dutyAttendanceEntryCodes.codeId, dutyAttendanceCodes.id)).where(and(eq(dutyAttendanceEntryCodes.departmentId, departmentId), gte(dutyAttendanceEntryCodes.workDate, from), lt(dutyAttendanceEntryCodes.workDate, to))),
      // Dòng cũ vẫn là lớp tương thích khi một máy chủ cũ vừa ghi dữ liệu trước lúc nâng cấp.
      this.db.db.select({ userId: dutyAttendanceEntries.userId, workDate: dutyAttendanceEntries.workDate, code: dutyAttendanceCodes.code }).from(dutyAttendanceEntries).innerJoin(dutyAttendanceCodes, eq(dutyAttendanceEntries.codeId, dutyAttendanceCodes.id)).where(and(eq(dutyAttendanceEntries.departmentId, departmentId), gte(dutyAttendanceEntries.workDate, from), lt(dutyAttendanceEntries.workDate, to))),
      this.db.db.select({ userId: dutyAttendanceDailyNotes.userId, workDate: dutyAttendanceDailyNotes.workDate, note: dutyAttendanceDailyNotes.note }).from(dutyAttendanceDailyNotes).where(and(eq(dutyAttendanceDailyNotes.departmentId, departmentId), gte(dutyAttendanceDailyNotes.workDate, from), lt(dutyAttendanceDailyNotes.workDate, to))),
      this.db.db.select({ userId: dutyAttendanceManualValues.userId, columnId: dutyAttendanceManualValues.columnId, value: dutyAttendanceManualValues.value }).from(dutyAttendanceManualValues).where(and(eq(dutyAttendanceManualValues.departmentId, departmentId), eq(dutyAttendanceManualValues.month, month))),
      this.db.db.select({ userId: dutyAttendanceDepartmentAssignments.userId }).from(dutyAttendanceDepartmentAssignments).where(and(eq(dutyAttendanceDepartmentAssignments.departmentId, departmentId), lt(dutyAttendanceDepartmentAssignments.effectiveFrom, to))),
      this.db.db.select({ id: users.id }).from(users).where(and(eq(users.departmentId, departmentId), eq(users.active, true), isNull(users.deletedAt))),
    ]);
    const currentDepartment = department[0];
    if (!currentDepartment) throw new NotFoundException('Không tìm thấy khoa/phòng được gán');

    // Ngoài nhân viên đang có mốc làm việc ở khoa trong tháng, luôn giữ các nhân viên
    // có dòng chấm công/số liệu đã ghi tại khoa này. Đây là lớp bảo toàn dữ liệu trước
    // khi hệ thống bắt đầu ghi lịch sử chuyển khoa.
    const candidateIds = [...new Set([
      ...departmentAssignmentRows.map((row) => row.userId),
      ...currentDepartmentUsers.map((row) => row.id),
      ...dailyCodeRows.map((row) => row.userId),
      ...legacyCodeRows.map((row) => row.userId),
      ...dailyNotes.map((row) => row.userId),
      ...manualRows.map((row) => row.userId),
    ])];
    const people = candidateIds.length
      ? await this.db.db
        .select({ id: users.id, fullName: users.fullName, title: users.title, managementPosition: users.managementPosition, manv: users.manv, username: users.username, departmentId: users.departmentId, active: users.active, deletedAt: users.deletedAt, titleSortOrder: jobTitles.sortOrder })
        .from(users)
        // users.title lưu tên; bỏ khoảng trắng thừa và không phân biệt hoa/thường để dữ liệu cũ vẫn lấy đúng thứ tự danh mục.
        .leftJoin(jobTitles, sql`lower(btrim(${jobTitles.name})) = lower(btrim(${users.title}))`)
        .where(inArray(users.id, candidateIds))
      : [];
    const managementPositionRows = candidateIds.length
      ? await this.db.db
        .select({ userId: userManagementPositions.userId, id: managementPositions.id, code: managementPositions.code, name: managementPositions.name, sortOrder: managementPositions.sortOrder })
        .from(userManagementPositions)
        .innerJoin(managementPositions, eq(managementPositions.id, userManagementPositions.managementPositionId))
        .where(inArray(userManagementPositions.userId, candidateIds))
        .orderBy(asc(userManagementPositions.userId), asc(managementPositions.sortOrder), asc(managementPositions.name))
      : [];
    const managementByUser = new Map<number, Array<{ id: number; code: string; name: string; sortOrder: number }>>();
    for (const position of managementPositionRows) {
      managementByUser.set(position.userId, [...(managementByUser.get(position.userId) ?? []), { id: position.id, code: position.code, name: position.name, sortOrder: position.sortOrder }]);
    }
    const peopleWithManagement = people.map((person) => {
      const positions = managementByUser.get(person.id) ?? [];
      return {
        ...person,
        managementPositions: positions,
        managementPosition: positions.map((position) => position.name).join('; ') || person.managementPosition,
        managementPositionSortOrder: positions[0]?.sortOrder ?? null,
      };
    });
    const assignmentRows = candidateIds.length
      ? await this.db.db.select({ userId: dutyAttendanceDepartmentAssignments.userId, departmentId: dutyAttendanceDepartmentAssignments.departmentId, effectiveFrom: dutyAttendanceDepartmentAssignments.effectiveFrom }).from(dutyAttendanceDepartmentAssignments).where(inArray(dutyAttendanceDepartmentAssignments.userId, candidateIds)).orderBy(asc(dutyAttendanceDepartmentAssignments.userId), asc(dutyAttendanceDepartmentAssignments.effectiveFrom))
      : [];
    const assignmentsByUser = new Map<number, Array<{ departmentId: number; effectiveFrom: string }>>();
    for (const assignment of assignmentRows) assignmentsByUser.set(assignment.userId, [...(assignmentsByUser.get(assignment.userId) ?? []), { departmentId: assignment.departmentId, effectiveFrom: assignment.effectiveFrom }]);
    const retainedIds = new Set([...dailyCodeRows.map((row) => row.userId), ...legacyCodeRows.map((row) => row.userId), ...dailyNotes.map((row) => row.userId), ...manualRows.map((row) => row.userId)]);
    const staff = peopleWithManagement
      .filter((person) => {
        if (person.deletedAt) return false;
        const assignedHere = this.assignedToDepartmentInMonth(assignmentsByUser.get(person.id) ?? [], person.departmentId, departmentId, month);
        return retainedIds.has(person.id) || (person.active && assignedHere);
      })
      .sort((left, right) => compareByAttendanceStaffOrder(left, right, staffOrderMode));

    const today = bangkokToday();
    const holidays = metricHolidayRows.filter((holiday) => holiday.holidayDate >= from && holiday.holidayDate < to).sort((left, right) => left.holidayDate.localeCompare(right.holidayDate));
    const workdayOverrides = metricWorkdayRows.filter((workday) => workday.workDate >= from && workday.workDate < to).sort((left, right) => left.workDate.localeCompare(right.workDate));
    const holidayDates = new Set(metricHolidayRows.map((holiday) => holiday.holidayDate));
    const workdayDates = new Set(metricWorkdayRows.map((workday) => workday.workDate));
    const dates = Array.from({ length: daysInMonth(month) }, (_, index) => {
      const date = `${month}-${String(index + 1).padStart(2, '0')}`; const dow = new Date(`${date}T00:00:00`).getDay(); const isWeekend = dow === 0 || dow === 6; const holiday = holidays.find((item) => item.holidayDate === date); const workday = workdayOverrides.find((item) => item.workDate === date);
      return { date, day: index + 1, weekday: vnWeekday(date), isWeekend, isPast: date < today, isLocked: isDateLocked(date, today, lockPolicy), isRest: holiday ? true : isWeekend && !workday, holidayName: holiday?.name ?? '', workdayName: !holiday ? workday?.name ?? '' : '', isWorkingOverride: !!workday && !holiday };
    });
    // entry_codes là nguồn nhiều ký hiệu. Dòng entries cũ chỉ được dùng dự phòng khi có máy chủ cũ vừa ghi dữ liệu.
    const codeSort = new Map(allCodes.map((code, index) => [code.code.toUpperCase(), index]));
    const codesByCell = new Map<string, string[]>();
    const addCode = (userId: number, workDate: string, code: string) => {
      const cell = `${userId}:${workDate}`; const current = codesByCell.get(cell) ?? [];
      if (!current.includes(code)) codesByCell.set(cell, [...current, code]);
    };
    for (const row of dailyCodeRows) addCode(row.userId, row.workDate, row.code);
    for (const row of legacyCodeRows) {
      const cell = `${row.userId}:${row.workDate}`;
      if (!codesByCell.has(cell)) addCode(row.userId, row.workDate, row.code);
    }
    for (const codesForDay of codesByCell.values()) codesForDay.sort((left, right) => (codeSort.get(left.toUpperCase()) ?? Number.MAX_SAFE_INTEGER) - (codeSort.get(right.toUpperCase()) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right));
    // Số dư nghỉ bù đi theo người qua mọi khoa và mọi tháng; `current` đánh dấu ký hiệu
    // thuộc chính khoa này để số liệu theo tháng không cộng nhầm ngày ở khoa khác.
    const history = await this.attendanceCodeHistory(this.db.db, staff.map((person) => person.id), new Map(allCodes.map((code) => [code.id, code.code.toUpperCase()])));
    const historyByUser = new Map<number, Array<{ date: string; code: string; current: boolean }>>();
    for (const [cell, codesForDay] of history) {
      const item = this.historyCell(cell);
      historyByUser.set(item.userId, [...(historyByUser.get(item.userId) ?? []), ...codesForDay.map((code) => ({ date: item.workDate, code, current: item.departmentId === departmentId }))]);
    }
    const noteByCell = new Map(dailyNotes.map((item) => [`${item.userId}:${item.workDate}`, item.note]));
    const entryByCell = new Map<string, { code: string; codes: string[]; note: string }>();
    for (const [cell, codesForDay] of codesByCell) {
      const workDate = cell.slice(cell.indexOf(':') + 1); if (workDate < from) continue;
      entryByCell.set(cell, { code: codesForDay.join(', '), codes: codesForDay, note: noteByCell.get(cell) ?? '' });
    }
    // Ghi chú không cần ký hiệu vẫn được trả về bảng với danh sách ký hiệu rỗng.
    for (const [cell, note] of noteByCell) if (!entryByCell.has(cell)) entryByCell.set(cell, { code: '', codes: [], note });
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
        for (const selectedCode of entry?.codes ?? []) {
          if (!activeCodeKeys.has(selectedCode.toUpperCase())) continue;
          const code = codes.find((item) => item.code.toUpperCase() === selectedCode.toUpperCase());
          if (code) values[code.code.toUpperCase()] = codeCount(values[code.code.toUpperCase()]) + codeCount(code.countValue);
        }
      }
      const metrics = calculateAttendanceMetrics({
        monthDates: dates.map((date) => date.date), holidayDates, workdayDates, codes: allCodes,
        entries: historyByUser.get(person.id) ?? [],
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
      const referencedManualColumns = expressionReferences(rule.expression).map((reference) => manualColumns.find((column) => column.key.toUpperCase() === reference)).filter((column): column is typeof manualColumns[number] => !!column);
      if (!referencedManualColumns.length) continue;
      for (const person of staff) {
        const values = rowValues[String(person.id)];
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
      month, today, lockPolicy, staffOrderMode, manualLocked: isManualMonthLocked(month, today, lockPolicy),
      department: { id: currentDepartment.id, name: currentDepartment.name, hospital: currentDepartment.hospital },
      departments: [{ id: currentDepartment.id, name: currentDepartment.name }], multiDepartment: false,
      dates, codes, sections: layout.sections, columns: layout.columns, validations: layout.validations,
      systemMetrics: ATTENDANCE_SYSTEM_METRICS, columnGroups: layout.groups,
      staff: staff.map((person, index) => ({ stt: index + 1, id: person.id, fullName: person.fullName, title: person.title, titleSortOrder: person.titleSortOrder, managementPosition: person.managementPosition, managementPositionSortOrder: person.managementPositionSortOrder, managementPositions: person.managementPositions, manv: person.manv, username: person.username, key: String(person.id), departmentId, departmentName: currentDepartment.name })),
      entries, manualValues, manualViolations, calculationWarnings, rowValues, holidays, workdayOverrides,
    };
  }

  /** Ghép nhiều bảng khoa thành một phạm vi xem/xuất, không làm lẫn hàng của cùng nhân viên ở các khoa khác nhau. */
  private async buildBoard(departmentIds: number[], month: string) {
    const boards = await Promise.all(departmentIds.map((departmentId) => this.buildSingleBoard(departmentId, month)));
    const first = boards[0];
    if (!first) throw new BadRequestException('Vui lòng chọn ít nhất một khoa/phòng');
    if (boards.length === 1) return first;
    const entries: Record<string, { code: string; codes: string[]; note: string }> = {};
    const manualValues: Record<string, string> = {};
    const manualViolations: Record<string, string[]> = {};
    const calculationWarnings: Record<string, string[]> = {};
    const rowValues: Record<string, Record<string, string | number>> = {};
    const mergedStaff = boards.flatMap((board) => board.staff.map((person) => ({ ...person, key: `${board.department.id}:${person.id}`, departmentId: board.department.id, departmentName: board.department.name })));
    for (const board of boards) {
      const prefix = `${board.department.id}:`;
      for (const [key, value] of Object.entries(board.entries)) entries[`${prefix}${key}`] = value;
      for (const [key, value] of Object.entries(board.manualValues)) manualValues[`${prefix}${key}`] = value;
      for (const [key, value] of Object.entries(board.manualViolations)) manualViolations[`${prefix}${key}`] = value;
      for (const [key, value] of Object.entries(board.calculationWarnings)) calculationWarnings[`${prefix}${key}`] = value;
      for (const [key, value] of Object.entries(board.rowValues)) rowValues[`${prefix}${key}`] = value;
    }
    const staff = mergedStaff.sort((a, b) => compareByAttendanceStaffOrder(a, b, first.staffOrderMode) || a.departmentId - b.departmentId).map((person, index) => ({ ...person, stt: index + 1 }));
    return {
      ...first,
      department: { id: 0, name: `${boards.length} khoa/phòng đã chọn`, hospital: first.department.hospital },
      departments: boards.map((board) => ({ id: board.department.id, name: board.department.name })), multiDepartment: true,
      staff, entries, manualValues, manualViolations, calculationWarnings, rowValues,
    };
  }

  async month(user: AccessContext, q: AttendanceMonthQueryDto) {
    this.assertMonth(q.month);
    return this.buildBoard(await this.deptIds(user, q.departmentId, q.departmentIds), q.month);
  }

  /**
   * Ký hiệu và ghi chú cùng thuộc một ngày nhưng được lưu độc lập: có thể ghi chú
   * một ngày trống ký hiệu, xóa ký hiệu vẫn giữ ghi chú, và đổi ký hiệu không xóa ghi chú.
   */
  async save(user: AccessContext, dto: SaveAttendanceEntriesDto) {
    const departmentId = await this.deptId(user, dto.departmentId);
    if (!dto.entries.length) return { saved: 0 };
    const dates = [...new Set(dto.entries.map((entry) => entry.workDate))].sort();
    const today = bangkokToday();
    const lockPolicy = await this.attendanceLockPolicy();
    for (const date of dates) {
      if (!YMD.test(date)) throw new BadRequestException('Ngày chấm công không hợp lệ');
      if (isDateLocked(date, today, lockPolicy)) throw new ForbiddenException(`Không được sửa chấm công ngày ${fmtDate(date)} theo chế độ khóa bảng hiện tại`);
    }
    const personIds = [...new Set(dto.entries.map((entry) => entry.userId))];
    const [people, allStoredCodes, existingEntries, existingEntryCodes, existingNotes, assignmentRows] = await Promise.all([
      this.db.db.select({ id: users.id, departmentId: users.departmentId, active: users.active, deletedAt: users.deletedAt }).from(users).where(inArray(users.id, personIds)),
      // Mã ngừng dùng vẫn cần nhận diện để người dùng có thể giữ/bỏ đúng ký hiệu lịch sử đã có,
      // nhưng tuyệt đối không được chọn mới cho một ô chưa từng có mã đó.
      this.db.db.select({ id: dutyAttendanceCodes.id, code: dutyAttendanceCodes.code, active: dutyAttendanceCodes.active, countValue: dutyAttendanceCodes.countValue, calculationRole: dutyAttendanceCodes.calculationRole, deductsWorkday: dutyAttendanceCodes.deductsWorkday, restSource: dutyAttendanceCodes.restSource, sortOrder: dutyAttendanceCodes.sortOrder }).from(dutyAttendanceCodes),
      // Dòng cũ là ký hiệu đầu tiên, để API/bản sao lưu cũ vẫn đọc được một ký hiệu hợp lệ.
      this.db.db.select({ id: dutyAttendanceEntries.id, userId: dutyAttendanceEntries.userId, workDate: dutyAttendanceEntries.workDate, departmentId: dutyAttendanceEntries.departmentId, codeId: dutyAttendanceEntries.codeId, note: dutyAttendanceEntries.note }).from(dutyAttendanceEntries).where(and(inArray(dutyAttendanceEntries.userId, personIds), inArray(dutyAttendanceEntries.workDate, dates))),
      this.db.db.select({ id: dutyAttendanceEntryCodes.id, userId: dutyAttendanceEntryCodes.userId, workDate: dutyAttendanceEntryCodes.workDate, departmentId: dutyAttendanceEntryCodes.departmentId, codeId: dutyAttendanceEntryCodes.codeId }).from(dutyAttendanceEntryCodes).where(and(inArray(dutyAttendanceEntryCodes.userId, personIds), inArray(dutyAttendanceEntryCodes.workDate, dates))),
      this.db.db.select({ id: dutyAttendanceDailyNotes.id, userId: dutyAttendanceDailyNotes.userId, workDate: dutyAttendanceDailyNotes.workDate, departmentId: dutyAttendanceDailyNotes.departmentId, note: dutyAttendanceDailyNotes.note }).from(dutyAttendanceDailyNotes).where(and(inArray(dutyAttendanceDailyNotes.userId, personIds), inArray(dutyAttendanceDailyNotes.workDate, dates))),
      this.db.db.select({ userId: dutyAttendanceDepartmentAssignments.userId, departmentId: dutyAttendanceDepartmentAssignments.departmentId, effectiveFrom: dutyAttendanceDepartmentAssignments.effectiveFrom }).from(dutyAttendanceDepartmentAssignments).where(inArray(dutyAttendanceDepartmentAssignments.userId, personIds)).orderBy(asc(dutyAttendanceDepartmentAssignments.userId), asc(dutyAttendanceDepartmentAssignments.effectiveFrom)),
    ]);
    if (people.length !== personIds.length) throw new NotFoundException('Không tìm thấy nhân viên cần chấm công');
    const peopleById = new Map(people.map((person) => [person.id, person]));
    const assignmentsByUser = new Map<number, Array<{ departmentId: number; effectiveFrom: string }>>();
    for (const assignment of assignmentRows) assignmentsByUser.set(assignment.userId, [...(assignmentsByUser.get(assignment.userId) ?? []), assignment]);
    const existingEntryByCell = new Map(existingEntries.map((entry) => [`${entry.userId}:${entry.workDate}`, entry]));
    const existingCodesByCell = new Map<string, typeof existingEntryCodes>();
    for (const item of existingEntryCodes) {
      const cell = `${item.userId}:${item.workDate}`;
      existingCodesByCell.set(cell, [...(existingCodesByCell.get(cell) ?? []), item]);
    }
    const existingNoteByCell = new Map(existingNotes.map((item) => [`${item.userId}:${item.workDate}`, item]));
    const byCode = new Map(allStoredCodes.map((code) => [code.code.toUpperCase(), code]));
    const preparedEntries = dto.entries.map((entry) => {
      const codeProvided = entry.codes !== undefined || entry.code !== undefined;
      const rawCodes: Array<string | null | undefined> = entry.codes !== undefined ? entry.codes : entry.code !== undefined ? [entry.code] : [];
      const codes = rawCodes.map((value) => value?.trim().toUpperCase() ?? '').filter(Boolean);
      if (new Set(codes).size !== codes.length) throw new BadRequestException('Không được chọn trùng ký hiệu trong cùng một ngày');
      for (const code of codes) if (!byCode.has(code)) throw new BadRequestException(`Ký hiệu “${code}” không tồn tại`);
      return { entry, codeProvided, codes: codeProvided ? codes : undefined, noteProvided: entry.note !== undefined, note: entry.note !== undefined ? entry.note.trim() : undefined };
    });

    for (const prepared of preparedEntries) {
      const { entry, codeProvided, codes, noteProvided, note } = prepared;
      const cell = `${entry.userId}:${entry.workDate}`;
      const person = peopleById.get(entry.userId)!;
      const existingEntry = existingEntryByCell.get(cell);
      const existingCodeRows = existingCodesByCell.get(cell) ?? [];
      const existingNote = existingNoteByCell.get(cell);
      // Cả ký hiệu và ghi chú đều mang khoa lịch sử: không được chuyển dữ liệu giữa khoa ngầm định.
      if (existingEntry && existingEntry.departmentId !== departmentId) throw new ConflictException('Dòng chấm công ngày này đã thuộc khoa/phòng khác; hệ thống giữ nguyên khoa lịch sử để tránh sai lệch dữ liệu');
      if (existingCodeRows.some((row) => row.departmentId !== departmentId)) throw new ConflictException('Ký hiệu chấm công ngày này đã thuộc khoa/phòng khác; hệ thống giữ nguyên khoa lịch sử để tránh sai lệch dữ liệu');
      if (existingNote && existingNote.departmentId !== departmentId) throw new ConflictException('Ghi chú ngày này đã thuộc khoa/phòng khác; hệ thống giữ nguyên khoa lịch sử để tránh sai lệch dữ liệu');
      const existingCodeIds = new Set([...(existingEntry ? [existingEntry.codeId] : []), ...existingCodeRows.map((row) => row.codeId)]);
      for (const code of codes ?? []) {
        const selectedCode = byCode.get(code)!;
        if (!selectedCode.active && !existingCodeIds.has(selectedCode.id)) throw new BadRequestException(`Ký hiệu “${code}” đã ngừng sử dụng; chỉ có thể giữ hoặc bỏ ký hiệu lịch sử đang có`);
      }
      const hasExistingCodes = existingCodeIds.size > 0;
      const isNewCode = codeProvided && !!codes?.length && !hasExistingCodes;
      const isNewNote = noteProvided && !!note && !existingNote;
      if (!isNewCode && !isNewNote) continue;
      if (person.deletedAt || !person.active) throw new ForbiddenException('Chỉ được ghi dữ liệu mới cho nhân viên đang hoạt động');
      const actualDepartment = this.departmentAtDate(assignmentsByUser.get(person.id) ?? [], person.departmentId, entry.workDate);
      if (actualDepartment !== departmentId) throw new ForbiddenException(`Nhân viên không thuộc khoa/phòng này vào ngày ${fmtDate(entry.workDate)}`);
    }

    await this.db.transaction(async (tx) => {
      // Nghỉ bù tính theo số lượng tích lũy: tổng nghỉ bù (NB = 1, NB2 = 0,5…) của
      // một người, mọi khoa và mọi ngày, không được vượt tổng ca Trực. Kiểm tra nằm
      // trong giao dịch, trên trạng thái sau khi áp dụng yêu cầu, nên thêm nghỉ bù hay
      // bỏ/sửa một ca Trực cũ đều không thể làm số dư âm và không lưu dở một phần.
      const balanceRole = (code: string) => { const role = byCode.get(code)?.calculationRole; return role === 'DUTY' || role === 'REST'; };
      const touchesBalance = preparedEntries.some(({ entry, codeProvided, codes }) => {
        if (!codeProvided) return false;
        const cell = `${entry.userId}:${entry.workDate}`;
        const existingEntry = existingEntryByCell.get(cell);
        const existingIds = new Set([...(existingEntry ? [existingEntry.codeId] : []), ...(existingCodesByCell.get(cell) ?? []).map((row) => row.codeId)]);
        const before = allStoredCodes.filter((code) => existingIds.has(code.id)).map((code) => code.code.toUpperCase());
        return [...before, ...(codes ?? [])].some(balanceRole);
      });
      if (touchesBalance) {
        const before = await this.attendanceCodeHistory(tx, personIds, new Map(allStoredCodes.map((code) => [code.id, code.code.toUpperCase()])));
        const after = new Map(before);
        for (const { entry, codeProvided, codes } of preparedEntries) if (codeProvided) after.set(`${departmentId}:${entry.userId}:${entry.workDate}`, codes ?? []);
        const entriesOf = (cells: Map<string, string[]>, personId: number) => [...cells.entries()].flatMap(([cell, selectedCodes]) => {
          const item = this.historyCell(cell);
          return item.userId === personId ? selectedCodes.map((code) => ({ date: item.workDate, code })) : [];
        });
        const number = (value: number) => String(value).replace('.', ',');
        for (const personId of personIds) {
          const previous = attendanceRestBalance({ codes: allStoredCodes, entries: entriesOf(before, personId) });
          const next = attendanceRestBalance({ codes: allStoredCodes, entries: entriesOf(after, personId) });
          // Dữ liệu cũ có thể đã âm: vẫn cho sửa ô khác hoặc bỏ bớt nghỉ bù, chỉ chặn khi làm âm thêm.
          if (next.remaining < 0 && next.remaining < previous.remaining) {
            throw new BadRequestException(`Không thể lưu: tổng nghỉ bù tích lũy (${number(next.rest)}) sẽ vượt tổng ca Trực tích lũy (${number(next.duty)}) của nhân viên. Hiện chỉ còn được nghỉ bù ${number(Math.max(0, previous.remaining))} ngày; hãy bỏ bớt nghỉ bù trước khi thêm nghỉ hoặc xóa/sửa ca Trực.`);
          }
        }
      }

      for (const prepared of preparedEntries) {
        const { entry, codeProvided, codes, noteProvided, note } = prepared;
        const existingEntry = existingEntryByCell.get(`${entry.userId}:${entry.workDate}`);
        const existingNote = existingNoteByCell.get(`${entry.userId}:${entry.workDate}`);

        if (codeProvided) {
          // Danh sách được thay thế nguyên vẹn, nên thao tác bỏ dấu tick luôn xóa chính xác ký hiệu đó.
          await tx.delete(dutyAttendanceEntryCodes).where(and(eq(dutyAttendanceEntryCodes.departmentId, departmentId), eq(dutyAttendanceEntryCodes.userId, entry.userId), eq(dutyAttendanceEntryCodes.workDate, entry.workDate)));
          if (codes?.length) {
            await tx.insert(dutyAttendanceEntryCodes).values(codes.map((code) => ({ departmentId, userId: entry.userId, workDate: entry.workDate, codeId: byCode.get(code)!.id, updatedBy: user.id })));
          }
          const primaryCodeId = codes?.length ? byCode.get(codes[0]!)!.id : undefined;
          if (!primaryCodeId) {
            if (existingEntry) await tx.delete(dutyAttendanceEntries).where(eq(dutyAttendanceEntries.id, existingEntry.id));
          } else {
            const compatibilityNote = noteProvided ? note ?? '' : existingNote?.note ?? existingEntry?.note ?? '';
            if (existingEntry) {
              await tx.update(dutyAttendanceEntries).set({ codeId: primaryCodeId, note: compatibilityNote, updatedBy: user.id, updatedAt: new Date() }).where(eq(dutyAttendanceEntries.id, existingEntry.id));
            } else {
              await tx.insert(dutyAttendanceEntries).values({ departmentId, userId: entry.userId, workDate: entry.workDate, codeId: primaryCodeId, note: compatibilityNote, updatedBy: user.id });
            }
          }
        }

        if (noteProvided) {
          if (!note) {
            if (existingNote) await tx.delete(dutyAttendanceDailyNotes).where(eq(dutyAttendanceDailyNotes.id, existingNote.id));
          } else {
            await tx.insert(dutyAttendanceDailyNotes).values({ departmentId, userId: entry.userId, workDate: entry.workDate, note, updatedBy: user.id }).onConflictDoUpdate({ target: [dutyAttendanceDailyNotes.userId, dutyAttendanceDailyNotes.workDate], set: { note, updatedBy: user.id, updatedAt: new Date() } });
          }
          // Cột note cũ được đồng bộ cho tích hợp/bản sao lưu cũ; nguồn đọc chính là daily_notes.
          if (existingEntry && !codeProvided) await tx.update(dutyAttendanceEntries).set({ note: note ?? '', updatedBy: user.id, updatedAt: new Date() }).where(eq(dutyAttendanceEntries.id, existingEntry.id));
        }
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
    const [columns, people, existingValues, assignmentRows] = await Promise.all([
      this.db.db.select().from(dutyAttendanceColumns).where(and(inArray(dutyAttendanceColumns.id, columnIds), eq(dutyAttendanceColumns.active, true))),
      this.db.db.select({ id: users.id, departmentId: users.departmentId, active: users.active, deletedAt: users.deletedAt }).from(users).where(inArray(users.id, personIds)),
      this.db.db.select({ userId: dutyAttendanceManualValues.userId, columnId: dutyAttendanceManualValues.columnId }).from(dutyAttendanceManualValues).where(and(eq(dutyAttendanceManualValues.departmentId, departmentId), eq(dutyAttendanceManualValues.month, dto.month), inArray(dutyAttendanceManualValues.userId, personIds), inArray(dutyAttendanceManualValues.columnId, columnIds))),
      this.db.db.select({ userId: dutyAttendanceDepartmentAssignments.userId, departmentId: dutyAttendanceDepartmentAssignments.departmentId, effectiveFrom: dutyAttendanceDepartmentAssignments.effectiveFrom }).from(dutyAttendanceDepartmentAssignments).where(inArray(dutyAttendanceDepartmentAssignments.userId, personIds)).orderBy(asc(dutyAttendanceDepartmentAssignments.userId), asc(dutyAttendanceDepartmentAssignments.effectiveFrom)),
    ]);
    if (people.length !== personIds.length) throw new NotFoundException('Không tìm thấy nhân viên cần nhập số liệu');
    if (columns.length !== columnIds.length || columns.some((column) => column.columnType !== 'MANUAL')) throw new BadRequestException('Chỉ cột tự nhập đang hoạt động mới được ghi số liệu');
    const peopleById = new Map(people.map((person) => [person.id, person]));
    const assignmentsByUser = new Map<number, Array<{ departmentId: number; effectiveFrom: string }>>();
    for (const assignment of assignmentRows) assignmentsByUser.set(assignment.userId, [...(assignmentsByUser.get(assignment.userId) ?? []), assignment]);
    const existingCells = new Set(existingValues.map((value) => `${value.userId}:${value.columnId}`));
    for (const person of people) {
      const hasExisting = dto.values.some((value) => value.userId === person.id && existingCells.has(`${value.userId}:${value.columnId}`));
      const belongsThisMonth = this.assignedToDepartmentInMonth(assignmentsByUser.get(person.id) ?? [], person.departmentId, departmentId, dto.month);
      if (!hasExisting && (person.deletedAt || !person.active || !belongsThisMonth)) throw new ForbiddenException('Chỉ được nhập số liệu mới cho nhân viên đang hoạt động thuộc khoa/phòng trong tháng đã chọn');
    }
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
    const [[{ legacyTotal }], [{ multiTotal }]] = await Promise.all([
      this.db.db.select({ legacyTotal: sql<number>`count(*)::int` }).from(dutyAttendanceEntries).where(eq(dutyAttendanceEntries.codeId, id)),
      this.db.db.select({ multiTotal: sql<number>`count(*)::int` }).from(dutyAttendanceEntryCodes).where(eq(dutyAttendanceEntryCodes.codeId, id)),
    ]);
    if (Number(legacyTotal) > 0 || Number(multiTotal) > 0) throw new ConflictException(`Không thể xóa ký hiệu “${code.code}” vì đã được dùng trong bảng chấm công. Hãy ngừng sử dụng ký hiệu này thay vì xóa.`);
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
    const prepared = await this.assertColumnConfig(dto); const [item] = await this.db.db.insert(dutyAttendanceColumns).values({ sectionId: dto.sectionId, groupId: dto.groupId || null, key: prepared.key, name: dto.name.trim(), columnType: dto.columnType, dataType: dto.columnType === 'FORMULA' ? 'NUMBER' : dto.dataType ?? 'NUMBER', formula: prepared.formula, placeholder: dto.columnType === 'MANUAL' ? (dto.placeholder?.trim() || 'Tự nhập') : '', sortOrder: dto.sortOrder ?? 100, active: dto.active ?? true }).returning(); return item;
  }
  async updateColumn(id: number, dto: Partial<AttendanceColumnDto>) {
    const [current] = await this.db.db.select().from(dutyAttendanceColumns).where(eq(dutyAttendanceColumns.id, id)); if (!current) throw new NotFoundException('Không tìm thấy cột');
    const full = { sectionId: dto.sectionId ?? current.sectionId, groupId: dto.groupId !== undefined ? dto.groupId || null : current.groupId, key: dto.key ?? current.key, name: dto.name ?? current.name, columnType: (dto.columnType ?? current.columnType) as DutyAttendanceColumnType, dataType: dto.dataType ?? current.dataType, formula: dto.formula ?? current.formula, placeholder: dto.placeholder ?? current.placeholder, sortOrder: dto.sortOrder ?? current.sortOrder, active: dto.active ?? current.active } as AttendanceColumnDto;
    const prepared = await this.assertColumnConfig(full, id);
    const [item] = await this.db.db.update(dutyAttendanceColumns).set({ sectionId: full.sectionId, groupId: full.groupId || null, key: prepared.key, name: full.name.trim(), columnType: full.columnType, dataType: full.columnType === 'FORMULA' ? 'NUMBER' : full.dataType ?? 'NUMBER', formula: prepared.formula, placeholder: full.columnType === 'MANUAL' ? (full.placeholder?.trim() || 'Tự nhập') : '', sortOrder: full.sortOrder ?? 100, active: full.active ?? true, updatedAt: new Date() }).where(eq(dutyAttendanceColumns.id, id)).returning(); return item;
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

  /** Chữ trắng trên nền đậm, chữ đen trên nền nhạt để tiêu đề Excel luôn đọc được. */
  private excelForeground(hex: string) {
    const raw = hex.replace('#', ''); const r = Number.parseInt(raw.slice(0, 2), 16); const g = Number.parseInt(raw.slice(2, 4), 16); const b = Number.parseInt(raw.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? 'FF0F172A' : 'FFFFFFFF';
  }

  /** Ô tiêu đề Word: gộp ngang (columnSpan) và gộp dọc (rowSpan) đúng như Excel. */
  private wordHeaderCell(item: HeaderCell, totalColumns: number) {
    const fill = item.kind === 'SECTION' ? item.color : item.kind === 'GROUP' ? item.color : '';
    return new TableCell({
      columnSpan: item.colSpan > 1 ? item.colSpan : undefined, rowSpan: item.rowSpan > 1 ? item.rowSpan : undefined,
      width: { size: Math.max(180, Math.floor(9500 / totalColumns)) * item.colSpan, type: WidthType.DXA },
      ...(fill ? { shading: { fill: fill.replace('#', ''), color: 'auto', type: ShadingType.CLEAR } } : {}),
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({ alignment: 'center', children: [new TextRun({ text: item.text, bold: true, size: 14, ...(fill ? { color: this.excelForeground(fill).slice(2) } : {}) })] })],
    });
  }

  /* ------------------------------------------------ nhóm tiêu đề cột nhiều tầng */

  private async configurableSection(sectionId: number) {
    const [section] = await this.db.db.select().from(dutyAttendanceSections).where(eq(dutyAttendanceSections.id, sectionId));
    if (!section) throw new NotFoundException('Không tìm thấy phần của bảng chấm công');
    if (!['REPORT', 'CUSTOM'].includes(section.kind)) throw new BadRequestException('Chỉ phần Báo cáo hoặc phần tự khai báo mới có nhóm tiêu đề cột');
    return section;
  }

  /** Kiểm tra nhóm cha: cùng phần, không tạo vòng lặp và không vượt số tầng cho phép. */
  private async assertGroupParent(sectionId: number, parentId: number | null, editingId?: number) {
    const groups = await this.db.db.select().from(dutyAttendanceColumnGroups);
    const byId = new Map(groups.map((group) => [group.id, group]));
    const subtreeDepth = (id: number): number => { const kids = groups.filter((group) => group.parentId === id); return 1 + (kids.length ? Math.max(...kids.map((kid) => subtreeDepth(kid.id))) : 0); };
    let parentDepth = 0;
    if (parentId) {
      const parent = byId.get(parentId);
      if (!parent) throw new NotFoundException('Không tìm thấy nhóm cha');
      if (parent.sectionId !== sectionId) throw new BadRequestException('Nhóm cha phải thuộc cùng phần');
      const path = groupPath(parentId, byId);
      if (editingId && path.some((group) => group.id === editingId)) throw new BadRequestException('Không thể đặt nhóm vào chính nó hoặc nhóm con của nó');
      parentDepth = path.length;
    }
    const ownDepth = editingId ? subtreeDepth(editingId) : 1;
    if (parentDepth + ownDepth > MAX_COLUMN_GROUP_DEPTH) throw new BadRequestException(`Tiêu đề chỉ hỗ trợ tối đa ${MAX_COLUMN_GROUP_DEPTH} tầng nhóm dưới một phần`);
  }

  /** Gán đúng danh sách cột vào nhóm (cột bỏ chọn được đưa về ngay dưới phần). */
  private async assignGroupColumns(executor: Executor, groupId: number, sectionId: number, columnIds: number[]) {
    const ids = [...new Set(columnIds)];
    if (ids.length) {
      const rows = await executor.select({ id: dutyAttendanceColumns.id, sectionId: dutyAttendanceColumns.sectionId }).from(dutyAttendanceColumns).where(inArray(dutyAttendanceColumns.id, ids));
      if (rows.length !== ids.length) throw new NotFoundException('Có cột được chọn không còn tồn tại');
      if (rows.some((row) => row.sectionId !== sectionId)) throw new BadRequestException('Chỉ gán được các cột cùng phần với nhóm');
    }
    await executor.update(dutyAttendanceColumns).set({ groupId: null, updatedAt: new Date() }).where(and(eq(dutyAttendanceColumns.groupId, groupId), ...(ids.length ? [sql`${dutyAttendanceColumns.id} not in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`] : [])));
    if (ids.length) await executor.update(dutyAttendanceColumns).set({ groupId, updatedAt: new Date() }).where(inArray(dutyAttendanceColumns.id, ids));
  }

  async createColumnGroup(dto: AttendanceColumnGroupDto) {
    await this.configurableSection(dto.sectionId);
    const parentId = dto.parentId || null;
    await this.assertGroupParent(dto.sectionId, parentId);
    return this.db.transaction(async (tx) => {
      const [item] = await tx.insert(dutyAttendanceColumnGroups).values({ sectionId: dto.sectionId, parentId, name: dto.name.trim(), color: dto.color ?? '', sortOrder: dto.sortOrder ?? 100, active: dto.active ?? true }).returning();
      if (dto.columnIds) await this.assignGroupColumns(tx, item!.id, dto.sectionId, dto.columnIds);
      return item!;
    });
  }

  async updateColumnGroup(id: number, dto: Partial<AttendanceColumnGroupDto>) {
    const [current] = await this.db.db.select().from(dutyAttendanceColumnGroups).where(eq(dutyAttendanceColumnGroups.id, id));
    if (!current) throw new NotFoundException('Không tìm thấy nhóm tiêu đề cột');
    const sectionId = dto.sectionId ?? current.sectionId;
    const parentId = dto.parentId !== undefined ? dto.parentId || null : current.parentId;
    if (sectionId !== current.sectionId) {
      await this.configurableSection(sectionId);
      const [[{ kids }], [{ cols }]] = await Promise.all([
        this.db.db.select({ kids: sql<number>`count(*)::int` }).from(dutyAttendanceColumnGroups).where(eq(dutyAttendanceColumnGroups.parentId, id)),
        this.db.db.select({ cols: sql<number>`count(*)::int` }).from(dutyAttendanceColumns).where(eq(dutyAttendanceColumns.groupId, id)),
      ]);
      if (Number(kids) || (Number(cols) && !dto.columnIds)) throw new BadRequestException('Nhóm còn nhóm con/cột; hãy chuyển chúng ra trước khi đổi sang phần khác');
    }
    await this.assertGroupParent(sectionId, parentId, id);
    return this.db.transaction(async (tx) => {
      const [item] = await tx.update(dutyAttendanceColumnGroups).set({ sectionId, parentId, name: (dto.name ?? current.name).trim(), color: dto.color ?? current.color, sortOrder: dto.sortOrder ?? current.sortOrder, active: dto.active ?? current.active, updatedAt: new Date() }).where(eq(dutyAttendanceColumnGroups.id, id)).returning();
      if (dto.columnIds) await this.assignGroupColumns(tx, id, sectionId, dto.columnIds);
      return item!;
    });
  }

  /** Xóa nhóm chỉ xóa tầng tiêu đề: nhóm con và cột được đưa lên nhóm cha, không mất cột hay số liệu. */
  async deleteColumnGroup(id: number) {
    const [current] = await this.db.db.select().from(dutyAttendanceColumnGroups).where(eq(dutyAttendanceColumnGroups.id, id));
    if (!current) throw new NotFoundException('Không tìm thấy nhóm tiêu đề cột');
    await this.db.transaction(async (tx) => {
      await tx.update(dutyAttendanceColumnGroups).set({ parentId: current.parentId, updatedAt: new Date() }).where(eq(dutyAttendanceColumnGroups.parentId, id));
      await tx.update(dutyAttendanceColumns).set({ groupId: current.parentId, updatedAt: new Date() }).where(eq(dutyAttendanceColumns.groupId, id));
      await tx.delete(dutyAttendanceColumnGroups).where(eq(dutyAttendanceColumnGroups.id, id));
    });
    return { deleted: true };
  }

  /**
   * Nhân bản một nhóm cùng toàn bộ nhóm con và cột để mở rộng bảng nhanh, ví dụ chép
   * “Ngày lễ” thành “Ngày nghỉ” với quy tắc NGAY_LE → NGAY_NGHI. Quy tắc thay thế áp dụng
   * cho mã cột và tham chiếu trong công thức; tên nhóm con/cột giữ nguyên để tự sửa sau.
   */
  async duplicateColumnGroup(id: number, dto: DuplicateAttendanceColumnGroupDto) {
    const [codes, groups, columns] = await Promise.all([
      this.db.db.select({ code: dutyAttendanceCodes.code }).from(dutyAttendanceCodes),
      this.db.db.select().from(dutyAttendanceColumnGroups),
      this.db.db.select().from(dutyAttendanceColumns),
    ]);
    const source = groups.find((group) => group.id === id);
    if (!source) throw new NotFoundException('Không tìm thấy nhóm tiêu đề cột');
    const parentId = dto.parentId !== undefined ? dto.parentId || null : source.parentId;
    await this.assertGroupParent(source.sectionId, parentId);
    const replacements = (dto.replacements ?? []).map((rule) => ({ from: rule.from.trim().toUpperCase(), to: rule.to.trim().toUpperCase() })).filter((rule) => rule.from);
    const subtree: typeof groups = []; const collect = (groupId: number) => { for (const group of groups.filter((item) => item.parentId === groupId)) { subtree.push(group); collect(group.id); } };
    collect(id);
    const depthOf = (groupId: number): number => { const kids = groups.filter((group) => group.parentId === groupId); return 1 + (kids.length ? Math.max(...kids.map((kid) => depthOf(kid.id))) : 0); };
    if (groupPath(parentId, new Map(groups.map((group) => [group.id, group]))).length + depthOf(id) > MAX_COLUMN_GROUP_DEPTH) throw new BadRequestException(`Tiêu đề chỉ hỗ trợ tối đa ${MAX_COLUMN_GROUP_DEPTH} tầng nhóm dưới một phần`);
    const groupIds = new Set([id, ...subtree.map((group) => group.id)]);
    const sourceColumns = columns.filter((column) => column.groupId && groupIds.has(column.groupId));
    const existingKeys = new Set(columns.map((column) => column.key.toUpperCase()));
    const codeKeys = new Set(codes.map((code) => code.code.toUpperCase()));
    const newColumns = sourceColumns.map((column) => {
      const key = applyReplacements(column.key.toUpperCase(), replacements);
      if (!COLUMN_KEY.test(key)) throw new BadRequestException(`Mã cột mới “${key}” không hợp lệ (chỉ chữ in hoa, số, dấu gạch dưới, tối đa 32 ký tự)`);
      if (existingKeys.has(key)) throw new ConflictException(`Mã cột “${key}” (chép từ ${column.key}) đã tồn tại. Hãy khai báo quy tắc thay thế mã, ví dụ NGAY_LE → NGAY_NGHI.`);
      if (codeKeys.has(key) || ATTENDANCE_SYSTEM_METRIC_KEYS.has(key)) throw new ConflictException(`Mã cột mới “${key}” trùng mã ký hiệu/biến hệ thống`);
      return { source: column, key, formula: column.columnType === 'FORMULA' ? replaceFormulaReferences(column.formula, replacements) : '' };
    });
    const newKeys = newColumns.map((column) => column.key);
    if (new Set(newKeys).size !== newKeys.length) throw new ConflictException('Sau khi thay thế, có hai cột mới trùng mã; hãy điều chỉnh quy tắc thay thế');
    const virtualColumns = [...columns.map((column) => ({ key: column.key, columnType: column.columnType, formula: column.formula, active: column.active })), ...newColumns.map((column) => ({ key: column.key, columnType: column.source.columnType, formula: column.formula, active: column.source.active }))];
    for (const column of newColumns) if (column.formula) this.validateReferences(column.formula, codes, virtualColumns);
    this.assertFormulaGraph(virtualColumns);
    return this.db.transaction(async (tx) => {
      const idMap = new Map<number, number>();
      const [root] = await tx.insert(dutyAttendanceColumnGroups).values({ sectionId: source.sectionId, parentId, name: dto.name.trim(), color: source.color, sortOrder: dto.sortOrder ?? source.sortOrder + 1, active: source.active }).returning();
      idMap.set(id, root!.id);
      for (const group of subtree) {
        const [copy] = await tx.insert(dutyAttendanceColumnGroups).values({ sectionId: group.sectionId, parentId: idMap.get(group.parentId!)!, name: group.name, color: group.color, sortOrder: group.sortOrder, active: group.active }).returning();
        idMap.set(group.id, copy!.id);
      }
      for (const column of newColumns) {
        const item = column.source;
        await tx.insert(dutyAttendanceColumns).values({ sectionId: item.sectionId, groupId: idMap.get(item.groupId!)!, key: column.key, name: item.name, columnType: item.columnType, dataType: item.dataType, formula: column.formula, placeholder: item.placeholder, sortOrder: item.sortOrder, active: item.active });
      }
      return { group: root!, groups: subtree.length + 1, columns: newColumns.length, keys: newKeys };
    });
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
  /** Sửa khai báo riêng bệnh viện, gồm cả đổi ngày; không cho biến lịch mẫu Nhà nước thành dữ liệu tự do một cách âm thầm. */
  async updateHoliday(user: AccessContext, id: number, dto: AttendanceHolidayDto) {
    this.assertCalendarDate(dto.holidayDate, 'Ngày nghỉ/lễ'); const holidayYear = Number(dto.holidayDate.slice(0, 4));
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(dutyAttendanceHolidays).where(eq(dutyAttendanceHolidays.id, id));
      if (!current) throw new NotFoundException('Không tìm thấy ngày nghỉ/lễ');
      if (current.source !== 'HOSPITAL') throw new BadRequestException('Ngày lễ từ lịch Nhà nước phải được điều chỉnh trong phương án năm; không sửa trực tiếp tại danh sách bệnh viện');
      const [sameDate] = await tx.select({ id: dutyAttendanceHolidays.id }).from(dutyAttendanceHolidays).where(and(eq(dutyAttendanceHolidays.holidayDate, dto.holidayDate), ne(dutyAttendanceHolidays.id, id))).limit(1);
      if (sameDate) throw new ConflictException('Đã có một ngày nghỉ/lễ khác vào ngày này; hãy gộp hoặc xóa ngày trùng trước');
      const [workday] = await tx.select().from(dutyAttendanceWorkdayOverrides).where(eq(dutyAttendanceWorkdayOverrides.workDate, dto.holidayDate));
      if (workday?.source === 'HOSPITAL') throw new ConflictException('Ngày này đang là ngày làm việc do bệnh viện khai báo. Hãy xóa hoặc điều chỉnh ngày làm việc trước.');
      if (workday) await tx.delete(dutyAttendanceWorkdayOverrides).where(eq(dutyAttendanceWorkdayOverrides.id, workday.id));
      const [item] = await tx.update(dutyAttendanceHolidays).set({ holidayDate: dto.holidayDate, name: dto.name.trim(), note: dto.note?.trim() ?? '', holidayYear: Number.isInteger(holidayYear) ? holidayYear : null }).where(eq(dutyAttendanceHolidays.id, id)).returning();
      return item;
    });
  }
  async deleteHoliday(id: number) { const [current] = await this.db.db.select().from(dutyAttendanceHolidays).where(eq(dutyAttendanceHolidays.id, id)); if (!current) throw new NotFoundException('Không tìm thấy ngày nghỉ'); if (current.source !== 'HOSPITAL') throw new BadRequestException('Ngày lễ từ lịch Nhà nước phải được điều chỉnh trong phương án năm; không xóa trực tiếp tại danh sách bệnh viện'); await this.db.db.delete(dutyAttendanceHolidays).where(eq(dutyAttendanceHolidays.id, id)); return { deleted: true }; }
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
  async updateWorkdayOverride(user: AccessContext, id: number, dto: AttendanceWorkdayOverrideDto) {
    this.assertCalendarDate(dto.workDate, 'Ngày làm việc'); const workdayYear = Number(dto.workDate.slice(0, 4));
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(dutyAttendanceWorkdayOverrides).where(eq(dutyAttendanceWorkdayOverrides.id, id));
      if (!current) throw new NotFoundException('Không tìm thấy ngày làm việc hoán đổi');
      if (current.source !== 'HOSPITAL') throw new BadRequestException('Ngày làm bù từ lịch Nhà nước phải được điều chỉnh trong phương án năm; không sửa trực tiếp tại danh sách bệnh viện');
      const [sameDate] = await tx.select({ id: dutyAttendanceWorkdayOverrides.id }).from(dutyAttendanceWorkdayOverrides).where(and(eq(dutyAttendanceWorkdayOverrides.workDate, dto.workDate), ne(dutyAttendanceWorkdayOverrides.id, id))).limit(1);
      if (sameDate) throw new ConflictException('Đã có một ngày làm việc khác vào ngày này; hãy gộp hoặc xóa ngày trùng trước');
      const [holiday] = await tx.select().from(dutyAttendanceHolidays).where(eq(dutyAttendanceHolidays.holidayDate, dto.workDate));
      if (holiday?.source === 'HOSPITAL') throw new ConflictException('Ngày này đang là ngày nghỉ/lễ do bệnh viện khai báo. Hãy xóa hoặc điều chỉnh ngày nghỉ trước.');
      if (holiday) await tx.delete(dutyAttendanceHolidays).where(eq(dutyAttendanceHolidays.id, holiday.id));
      const [item] = await tx.update(dutyAttendanceWorkdayOverrides).set({ workDate: dto.workDate, name: dto.name.trim(), note: dto.note?.trim() ?? '', workdayYear: Number.isInteger(workdayYear) ? workdayYear : null }).where(eq(dutyAttendanceWorkdayOverrides.id, id)).returning();
      return item;
    });
  }
  async deleteWorkdayOverride(id: number) { const [current] = await this.db.db.select().from(dutyAttendanceWorkdayOverrides).where(eq(dutyAttendanceWorkdayOverrides.id, id)); if (!current) throw new NotFoundException('Không tìm thấy ngày làm việc hoán đổi'); if (current.source !== 'HOSPITAL') throw new BadRequestException('Ngày làm bù từ lịch Nhà nước phải được điều chỉnh trong phương án năm; không xóa trực tiếp tại danh sách bệnh viện'); await this.db.db.delete(dutyAttendanceWorkdayOverrides).where(eq(dutyAttendanceWorkdayOverrides.id, id)); return { deleted: true }; }

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
    const groupsById = new Map(data.columnGroups.map((group) => [group.id, group]));
    for (const section of data.sections) {
      if (section.kind === 'ADMIN') columns.push(...[
        { key: 'STT', name: 'STT', source: 'ADMIN', section, path: [] }, { key: 'USERNAME', name: 'MANV', source: 'ADMIN', section, path: [] }, { key: 'FULL_NAME', name: 'Họ và tên', source: 'ADMIN', section, path: [] }, { key: 'TITLE', name: 'Chức vụ', source: 'ADMIN', section, path: [] },
        ...(data.multiDepartment ? [{ key: 'DEPARTMENT', name: 'Khoa/Phòng', source: 'ADMIN' as const, section, path: [] }] : []),
      ] as DisplayColumn[]);
      if (section.kind === 'DAYS') columns.push(...data.dates.map((day) => ({ key: `DAY:${day.date}`, name: String(day.day), source: 'DAY' as const, section, day, path: [] })));
      if (section.kind === 'SYMBOLS') columns.push(...data.codes.map((code) => ({ key: code.code.toUpperCase(), name: code.name, source: 'VALUE' as const, section, path: [] })));
      if (section.kind === 'REPORT' || section.kind === 'CUSTOM') columns.push(...data.columns.filter((column) => column.sectionId === section.id).map((column) => ({ key: column.key.toUpperCase(), name: column.name, source: 'VALUE' as const, section, column, path: groupPath(column.groupId, groupsById).map((group) => ({ id: group.id, name: group.name, color: group.color })) })));
    }
    return columns;
  }
  /** Ô tiêu đề nhiều tầng (phần → nhóm → cột) theo đúng cấu hình nhóm tiêu đề. */
  private headerCells(columns: DisplayColumn[]) {
    return buildHeaderCells(columns.map((column) => ({ sectionId: column.section.id, sectionName: column.section.name, sectionColor: column.section.color, name: column.name, path: column.path })));
  }
  private groups(data: Board) { const columns = this.displayColumns(data); return data.sections.map((section) => ({ section, columns: columns.filter((column) => column.section.id === section.id) })).filter((group) => group.columns.length); }
  private cellValue(person: Board['staff'][number], column: DisplayColumn, data: Board) {
    if (column.source === 'DAY') return data.entries[`${person.key}:${column.day!.date}`]?.code ?? '';
    if (column.source === 'VALUE') return data.rowValues[person.key]?.[column.key] ?? '';
    if (column.key === 'STT') return person.stt; if (column.key === 'FULL_NAME') return person.fullName; if (column.key === 'TITLE') return person.managementPosition || person.title; if (column.key === 'DEPARTMENT') return person.departmentName; return person.manv;
  }
  private matrix(data: Board) { const columns = this.displayColumns(data); return data.staff.map((person) => columns.map((column) => this.cellValue(person, column, data))); }
  private async exportData(user: AccessContext, month: string, departmentId?: number, departmentIds?: number[]) { return this.month(user, { month, departmentId, departmentIds }); }

  async exportExcel(user: AccessContext, month: string, departmentId?: number, departmentIds?: number[], includeDailyNotes = false): Promise<AttendanceExport> {
    const data = await this.exportData(user, month, departmentId, departmentIds); const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Cham cong'); const groups = this.groups(data); const columns = groups.flatMap((group) => group.columns); const total = columns.length;
    sheet.mergeCells(1, 1, 1, total); sheet.getCell('A1').value = data.department.hospital.toUpperCase(); sheet.getCell('A1').font = { name: 'Times New Roman', bold: true, size: 12 }; sheet.getCell('A1').alignment = { horizontal: 'center' };
    sheet.mergeCells(2, 1, 2, total); sheet.getCell('A2').value = 'BẢNG CHẤM CÔNG TRỰC VÀ CHẤM CÔNG KHÁC'; sheet.getCell('A2').font = { name: 'Times New Roman', bold: true, size: 15 }; sheet.getCell('A2').alignment = { horizontal: 'center' };
    sheet.mergeCells(3, 1, 3, total); sheet.getCell('A3').value = `Khoa/Phòng: ${data.department.name} — Tháng ${month.slice(5)}/${month.slice(0, 4)}`; sheet.getCell('A3').alignment = { horizontal: 'center' };
    // Tiêu đề nhiều tầng: hàng 4 = phần, các hàng nhóm, rồi tên cột (gộp dọc tới hàng cuối), sau cùng là hàng thứ/ghi chú.
    const header = this.headerCells(columns); const headerTop = 4; const infoRow = headerTop + header.rows; const firstDataRow = infoRow + 1;
    const thin = { style: 'thin' as const }; const borderAll = { top: thin, bottom: thin, left: thin, right: thin };
    for (let row = headerTop; row <= infoRow; row++) for (let col = 1; col <= total; col++) { const cell = sheet.getCell(row, col); cell.border = borderAll; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF2F8' } }; }
    for (const item of header.cells) {
      const row = headerTop + item.row; const col = item.col + 1;
      if (item.rowSpan > 1 || item.colSpan > 1) sheet.mergeCells(row, col, row + item.rowSpan - 1, col + item.colSpan - 1);
      const cell = sheet.getCell(row, col); cell.value = item.text;
      const fill = item.kind === 'SECTION' ? item.color : item.kind === 'GROUP' && item.color ? item.color : '';
      if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hexToArgb(fill) } };
      else if (item.kind === 'GROUP') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      cell.font = { name: 'Times New Roman', bold: true, size: item.kind === 'LEAF' ? 9 : 10, ...(fill ? { color: { argb: this.excelForeground(fill) } } : {}) };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    }
    columns.forEach((column, index) => { const cell = sheet.getCell(infoRow, index + 1); cell.value = column.source === 'DAY' ? column.day!.weekday : ''; cell.font = { name: 'Times New Roman', bold: true, size: 9 }; cell.alignment = { horizontal: 'center', vertical: 'middle' }; });
    const dailyNoteRows = new Set<number>();
    const fullNameColumn = columns.findIndex((column) => column.key === 'FULL_NAME');
    for (const person of data.staff) {
      const row = sheet.addRow(columns.map((column) => this.cellValue(person, column, data)));
      // ExcelJS receives all persisted manual values as strings. Configured manual NUMBER values
      // must remain actual Excel numbers so report users can sum/filter them correctly; TEXT stays untouched.
      columns.forEach((column, index) => {
        if (column.source !== 'VALUE' || column.column?.columnType !== 'MANUAL' || column.column.dataType !== 'NUMBER') return;
        const raw = String(this.cellValue(person, column, data) ?? '').trim(); if (!raw) return;
        const numeric = Number(raw.replace(',', '.')); if (Number.isFinite(numeric)) row.getCell(index + 1).value = numeric;
      });
      // Tùy chọn Excel: mỗi nhân viên có ghi chú được thêm một dòng ngay dưới dòng chấm công,
      // đặt ghi chú đúng cột ngày để không bị hiểu nhầm là ghi chú của ký hiệu.
      if (includeDailyNotes) {
        const notes = columns.map((column) => column.source === 'DAY' ? (data.entries[`${person.key}:${column.day!.date}`]?.note ?? '') : '');
        if (notes.some((note) => note.trim())) {
          if (fullNameColumn >= 0) notes[fullNameColumn] = 'Ghi chú ngày';
          const noteRow = sheet.addRow(notes); dailyNoteRows.add(noteRow.number);
        }
      }
    }
    sheet.views = [{ state: 'frozen', xSplit: Math.min(4, total), ySplit: infoRow }];
    columns.forEach((column, index) => { sheet.getColumn(index + 1).width = column.key === 'FULL_NAME' ? 28 : column.key === 'TITLE' ? 20 : column.key === 'USERNAME' ? 16 : column.source === 'DAY' ? 5 : 13; });
    for (let row = headerTop + 1; row < infoRow; row++) sheet.getRow(row).height = 30;
    for (let row = firstDataRow; row <= sheet.rowCount; row++) {
      const isDailyNoteRow = dailyNoteRows.has(row); const excelRow = sheet.getRow(row);
      if (isDailyNoteRow) excelRow.height = 30;
      excelRow.eachCell((cell) => {
        cell.alignment = { horizontal: isDailyNoteRow ? 'left' : Number(cell.col) > 4 ? 'center' : 'left', vertical: 'middle', wrapText: isDailyNoteRow };
        cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
        if (isDailyNoteRow) { cell.font = { ...(cell.font ?? {}), italic: true, color: { argb: 'FF475569' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }; }
      });
    }
    return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), fileName: `BANG_CHAM_CONG_${month}_${data.department.id}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }

  async exportWord(user: AccessContext, month: string, departmentId?: number, departmentIds?: number[]): Promise<AttendanceExport> {
    const data = await this.exportData(user, month, departmentId, departmentIds); const groups = this.groups(data); const columns = groups.flatMap((group) => group.columns); const mkCell = (value: unknown, bold = false) => new TableCell({ width: { size: Math.max(180, Math.floor(9500 / columns.length)), type: WidthType.DXA }, children: [new Paragraph({ alignment: 'center', children: [new TextRun({ text: String(value ?? ''), bold, size: 14 })] })] });
    const header = this.headerCells(columns);
    const headerRows = Array.from({ length: header.rows }, (_, row) => new TableRow({ tableHeader: true, children: header.cells.filter((item) => item.row === row).map((item) => this.wordHeaderCell(item, columns.length)) }));
    const rows = [...headerRows, new TableRow({ tableHeader: true, children: columns.map((column) => mkCell(column.source === 'DAY' ? column.day!.weekday : '', true)) }), ...this.matrix(data).map((row) => new TableRow({ children: row.map((value) => mkCell(value)) }))];
    const doc = new Document({ sections: [{ properties: { page: { size: { width: 16840, height: 11900 }, margin: { top: 600, right: 500, bottom: 600, left: 500 } } }, children: [new Paragraph({ alignment: 'center', children: [new TextRun({ text: data.department.hospital.toUpperCase(), bold: true, size: 20 })] }), new Paragraph({ alignment: 'center', children: [new TextRun({ text: 'BẢNG CHẤM CÔNG TRỰC VÀ CHẤM CÔNG KHÁC', bold: true, size: 26 })] }), new Paragraph({ alignment: 'center', children: [new TextRun({ text: `Khoa/Phòng: ${data.department.name} — Tháng ${month.slice(5)}/${month.slice(0, 4)}`, italics: true, size: 18 })] }), new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })] }] });
    return { buffer: await Packer.toBuffer(doc), fileName: `BANG_CHAM_CONG_${month}_${data.department.id}.docx`, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  }

  async exportPdf(user: AccessContext, month: string, departmentId?: number, departmentIds?: number[]): Promise<AttendanceExport> {
    const data = await this.exportData(user, month, departmentId, departmentIds); const columns = this.displayColumns(data); const rows = data.staff.map((person) => Object.fromEntries(columns.map((column, index) => [`c${index}`, this.cellValue(person, column, data)])));
    const width = columns.length > 42 ? 5.4 : 7.5; const W = 273; const L = 12;
    const doc = { paperSize: 'A4', orientation: 'landscape', margins: { top: 8, right: 8, bottom: 10, left: 8 }, defaultStyle: { fontFamily: 'Times New Roman', fontSize: 6.5 }, pageNumbering: { show: true, position: 'bottom-right', format: 'Trang {page}/{pages}' }, pages: [{ id: 'p', name: 'Bảng chấm công', elements: [
      { id: 'org', type: 'text', x: L, y: 7, w: W, h: 5, text: data.department.hospital.toUpperCase(), style: { bold: true, align: 'center', fontSize: 9 } },
      { id: 'title', type: 'text', x: L, y: 13, w: W, h: 7, text: 'BẢNG CHẤM CÔNG TRỰC VÀ CHẤM CÔNG KHÁC', style: { bold: true, align: 'center', fontSize: 12 } },
      { id: 'sub', type: 'text', x: L, y: 21, w: W, h: 5, text: `Khoa/Phòng: ${data.department.name} — Tháng ${month.slice(5)}/${month.slice(0, 4)}`, style: { italic: true, align: 'center', fontSize: 8 } },
      { id: 'table', type: 'table', x: L, y: 29, w: W, h: 10, style: { fontSize: 5.8 }, table: { dataSource: 'rows', repeatHeader: true, minRowHeight: 5, columns: columns.map((column, index) => ({ id: `c${index}`, title: column.source === 'DAY' ? `${column.name}\n${column.day!.weekday}` : column.path.length ? `${column.path.map((group) => group.name).join(' › ')}\n${column.name}` : column.name, width: column.key === 'FULL_NAME' ? 24 : column.key === 'TITLE' ? 17 : width, align: ['FULL_NAME', 'TITLE'].includes(column.key) ? 'left' : 'center', binding: { source: 'row', path: `c${index}` } })) } },
      { id: 'legend', type: 'text', x: L, y: 185, w: W, h: 5, text: `Ký hiệu: ${data.codes.map((code) => `${code.code} – ${code.name} (${code.countValue})`).join('; ')}`, style: { fontSize: 7, wrap: true } },
    ] }] } as any;
    const output = await renderPrintDocument(doc, { data: { rows }, fileName: `BANG_CHAM_CONG_${month}` }); return { buffer: output.buffer, fileName: `BANG_CHAM_CONG_${month}_${data.department.id}.pdf`, mime: 'application/pdf' };
  }
}
