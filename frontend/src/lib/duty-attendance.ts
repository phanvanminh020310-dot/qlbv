import { apiFetch } from '@/lib/api';

export interface AttendanceCodeGroup { id: number; code: string; name: string; sortOrder: number; active: boolean }
export type AttendanceCalculationRole = 'NONE' | 'DUTY' | 'REINFORCEMENT' | 'REST';
export type AttendanceRestSource = 'ANY_DUTY' | 'DUTY' | 'REINFORCEMENT';
export interface AttendanceCode { id: number; code: string; name: string; group: string; color: string; countsAsDuty: boolean; showSummary: boolean; countValue: string; calculationRole: AttendanceCalculationRole; deductsWorkday: boolean; restSource: AttendanceRestSource; sortOrder: number; active: boolean; note: string }
export interface AttendanceSystemMetric { key: string; label: string; description: string }
export interface AttendanceSection { id: number; code: string; name: string; kind: 'ADMIN' | 'DAYS' | 'SYMBOLS' | 'REPORT' | 'CUSTOM'; color: string; sortOrder: number; active: boolean }
/** Nhóm tiêu đề cột nhiều tầng; parentId null = nhóm cấp 1 ngay dưới phần. color rỗng = nền nhạt mặc định. */
export interface AttendanceColumnGroup { id: number; sectionId: number; parentId: number | null; name: string; color: string; sortOrder: number; active: boolean }
export interface AttendanceColumn { id: number; sectionId: number; groupId: number | null; key: string; name: string; columnType: 'FORMULA' | 'MANUAL'; dataType: 'NUMBER' | 'TEXT'; formula: string; placeholder: string; sortOrder: number; active: boolean }
export interface AttendanceValidation { id: number; name: string; expression: string; message: string; sortOrder: number; active: boolean }
export type AttendanceHolidaySource = 'HOSPITAL' | 'NATIONAL_TEMPLATE';
export interface AttendanceHoliday { id: number; holidayDate: string; name: string; note: string; source: AttendanceHolidaySource; ruleKey: string; holidayYear: number | null }
export interface AttendanceWorkdayOverride { id: number; workDate: string; name: string; note: string; source: AttendanceHolidaySource; ruleKey: string; workdayYear: number | null }
export type NationalDayAdjacent = 'BEFORE' | 'AFTER';
export interface NationalHolidayPlanAdjustment { date: string; name: string; note: string }
export interface NationalHolidayPlan { year: number; tetStartOffset: number; tetDayCount: number; nationalDayAdjacent: NationalDayAdjacent; compensateWeeklyRest: boolean; additionalRestDays: NationalHolidayPlanAdjustment[]; compensatoryWorkdays: NationalHolidayPlanAdjustment[]; note: string }
export interface NationalHolidayCandidate { date: string; name: string; note: string; ruleKey: string; kind: 'STATUTORY' | 'SUBSTITUTE' | 'APPROVED_ADJUSTMENT' }
export interface NationalWorkdayCandidate { date: string; name: string; note: string; ruleKey: string; kind: 'COMPENSATORY_WORKDAY' }
export interface NationalHolidayProposal { plan: NationalHolidayPlan; lunarNewYear: string; candidates: NationalHolidayCandidate[]; workdayCandidates: NationalWorkdayCandidate[]; warnings: string[]; saved: boolean; added?: number; updated?: number; removed?: number; preservedHospital?: number; unchanged?: number; addedWorkdays?: number; updatedWorkdays?: number; removedWorkdays?: number; unchangedWorkdays?: number; templateConflicts?: number }
export interface AttendanceLayout { sections: AttendanceSection[]; columns: AttendanceColumn[]; groups: AttendanceColumnGroup[]; validations: AttendanceValidation[]; systemMetrics: AttendanceSystemMetric[] }
export type AttendanceLockPolicy = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export type AttendanceStaffOrderMode = 'PROFESSIONAL' | 'MANAGEMENT_THEN_PROFESSIONAL';
export interface AttendanceDate { date: string; day: number; weekday: string; isWeekend: boolean; isPast: boolean; isLocked: boolean; isRest: boolean; holidayName: string; workdayName: string; isWorkingOverride: boolean }
export interface AttendanceStaff { stt: number; id: number; key: string; departmentId: number; departmentName: string; fullName: string; title: string; /** job_titles.sort_order; null khi title là dữ liệu cũ/chưa có trong danh mục. */ titleSortOrder: number | null; managementPosition: string; /** management_positions.sort_order nhỏ nhất của các chức vụ; null khi không kiêm nhiệm. */ managementPositionSortOrder: number | null; managementPositions: Array<{ id: number; code: string; name: string; sortOrder: number }>; manv: string; username: string }
export interface AttendanceDepartment { id: number; name: string; code: string; shortName: string }
export interface AttendanceDepartmentScope { canSelect: boolean; items: AttendanceDepartment[] }
export interface AttendanceMonth {
  month: string;
  today: string;
  lockPolicy: AttendanceLockPolicy;
  /** Quy tắc ưu tiên thứ tự nhân sự được cấu hình tại Quản trị → Cấu hình hệ thống. */
  staffOrderMode: AttendanceStaffOrderMode;
  /** Cột tự nhập đại diện cho cả tháng, nên có khóa riêng theo tháng/năm. */
  manualLocked: boolean;
  department: { id: number; name: string; hospital: string };
  departments: Array<{ id: number; name: string }>;
  multiDepartment: boolean;
  dates: AttendanceDate[];
  codes: AttendanceCode[];
  sections: AttendanceSection[];
  columns: AttendanceColumn[];
  validations: AttendanceValidation[];
  systemMetrics: AttendanceSystemMetric[];
  /** Nhóm tiêu đề cột đang hiển thị (đã lọc nhánh bị ẩn). */
  columnGroups: AttendanceColumnGroup[];
  staff: AttendanceStaff[];
  /** code là chuỗi hiển thị tương thích; codes là danh sách ký hiệu đầy đủ của ngày. */
  entries: Record<string, { code: string; codes: string[]; note: string }>;
  /** Giá trị cột tự nhập đang có, dùng khóa staffKey:columnId. */
  manualValues: Record<string, string>;
  /** Thông điệp các ràng buộc chưa thỏa, theo ô tự nhập staffKey:columnId. */
  manualViolations: Record<string, string[]>;
  /** Cảnh báo tổng hợp (VD: dữ liệu cũ có nghỉ bù vượt tổng Trực tích lũy), theo staffKey. */
  calculationWarnings: Record<string, string[]>;
  /** Cột ký hiệu, công thức và tự nhập theo mã cột, dùng khóa staffKey. */
  rowValues: Record<string, Record<string, string | number>>;
  holidays: AttendanceHoliday[];
  workdayOverrides: AttendanceWorkdayOverride[];
}
type CodeGroupPayload = Omit<AttendanceCodeGroup, 'id'>;
type CodePayload = Omit<AttendanceCode, 'id'>;
type SectionPayload = Omit<AttendanceSection, 'id' | 'kind'> & { kind?: AttendanceSection['kind'] };
type ColumnPayload = Omit<AttendanceColumn, 'id'>;
export type ColumnGroupPayload = Omit<AttendanceColumnGroup, 'id'> & { columnIds?: number[] };
export type DuplicateColumnGroupPayload = { name: string; parentId?: number | null; sortOrder?: number; replacements: Array<{ from: string; to: string }> };
type ValidationPayload = Omit<AttendanceValidation, 'id'>;
const get = <T,>(path: string) => apiFetch<T>(path);
const put = <T,>(path: string, body: unknown) => apiFetch<T>(path, { method: 'PUT', body });
const post = <T,>(path: string, body: unknown) => apiFetch<T>(path, { method: 'POST', body });
const remove = <T,>(path: string) => apiFetch<T>(path, { method: 'DELETE' });
const attendanceScopeParams = (month: string, departmentIds: number[]) => {
  const params = new URLSearchParams({ month });
  departmentIds.forEach((id) => params.append('departmentIds', String(id)));
  return params;
};
export const dutyAttendanceApi = {
  departments: () => get<AttendanceDepartmentScope>('/duty-attendance/departments'),
  month: (month: string, departmentIds: number[]) => get<AttendanceMonth>(`/duty-attendance/month?${attendanceScopeParams(month, departmentIds)}`),
  /** codes thay thế toàn bộ danh sách tick của ngày; code đơn vẫn được giữ cho ứng dụng khách cũ. Ghi chú độc lập với ký hiệu. */
  save: (entries: Array<{ userId: number; workDate: string; code?: string | null; codes?: string[]; note?: string }>, departmentId: number) => put<{ saved: number }>('/duty-attendance/entries', { entries, departmentId }),
  saveManualValues: (month: string, values: Array<{ userId: number; columnId: number; value?: string | null }>, departmentId: number) => put<{ saved: number }>('/duty-attendance/manual-values', { month, values, departmentId }),
  exportPath: (format: 'xlsx' | 'docx' | 'pdf', month: string, departmentIds: number[], includeDailyNotes = false) => { const params = attendanceScopeParams(month, departmentIds); if (format === 'xlsx' && includeDailyNotes) params.set('includeDailyNotes', 'true'); return `/duty-attendance/export/${format}?${params}`; },
  codeGroups: () => get<AttendanceCodeGroup[]>('/duty-attendance/code-groups'),
  createCodeGroup: (body: CodeGroupPayload) => post<AttendanceCodeGroup>('/duty-attendance/code-groups', body),
  updateCodeGroup: (id: number, body: CodeGroupPayload) => put<AttendanceCodeGroup>(`/duty-attendance/code-groups/${id}`, body),
  deleteCodeGroup: (id: number) => remove<{ deleted: true }>(`/duty-attendance/code-groups/${id}`),
  codes: () => get<AttendanceCode[]>('/duty-attendance/codes'),
  createCode: (body: CodePayload) => post<AttendanceCode>('/duty-attendance/codes', body),
  updateCode: (id: number, body: CodePayload) => put<AttendanceCode>(`/duty-attendance/codes/${id}`, body),
  deleteCode: (id: number) => remove<{ deleted: true }>(`/duty-attendance/codes/${id}`),
  layout: () => get<AttendanceLayout>('/duty-attendance/layout'),
  createSection: (body: SectionPayload) => post<AttendanceSection>('/duty-attendance/sections', body),
  updateSection: (id: number, body: SectionPayload) => put<AttendanceSection>(`/duty-attendance/sections/${id}`, body),
  deleteSection: (id: number) => remove<{ deleted: true }>(`/duty-attendance/sections/${id}`),
  createColumn: (body: ColumnPayload) => post<AttendanceColumn>('/duty-attendance/columns', body),
  updateColumn: (id: number, body: ColumnPayload) => put<AttendanceColumn>(`/duty-attendance/columns/${id}`, body),
  deleteColumn: (id: number) => remove<{ deleted: true }>(`/duty-attendance/columns/${id}`),
  createColumnGroup: (body: ColumnGroupPayload) => post<AttendanceColumnGroup>('/duty-attendance/column-groups', body),
  updateColumnGroup: (id: number, body: ColumnGroupPayload) => put<AttendanceColumnGroup>(`/duty-attendance/column-groups/${id}`, body),
  deleteColumnGroup: (id: number) => remove<{ deleted: true }>(`/duty-attendance/column-groups/${id}`),
  duplicateColumnGroup: (id: number, body: DuplicateColumnGroupPayload) => post<{ group: AttendanceColumnGroup; groups: number; columns: number; keys: string[] }>(`/duty-attendance/column-groups/${id}/duplicate`, body),
  createValidation: (body: ValidationPayload) => post<AttendanceValidation>('/duty-attendance/validations', body),
  updateValidation: (id: number, body: ValidationPayload) => put<AttendanceValidation>(`/duty-attendance/validations/${id}`, body),
  deleteValidation: (id: number) => remove<{ deleted: true }>(`/duty-attendance/validations/${id}`),
  holidays: (month: string) => get<AttendanceHoliday[]>(`/duty-attendance/holidays?month=${month}`),
  workdayOverrides: (month: string) => get<AttendanceWorkdayOverride[]>(`/duty-attendance/workday-overrides?month=${month}`),
  nationalHolidayPlan: (year: number) => get<NationalHolidayProposal>(`/duty-attendance/holidays/national-plan?year=${year}`),
  previewNationalHolidayPlan: (body: NationalHolidayPlan) => post<NationalHolidayProposal>('/duty-attendance/holidays/national-plan/preview', body),
  saveNationalHolidayPlan: (body: NationalHolidayPlan) => put<NationalHolidayProposal>('/duty-attendance/holidays/national-plan', body),
  applyNationalHolidayPlan: (body: NationalHolidayPlan) => post<NationalHolidayProposal>('/duty-attendance/holidays/national-plan/apply', body),
  saveHoliday: (body: { holidayDate: string; name: string; note?: string }) => post<AttendanceHoliday>('/duty-attendance/holidays', body),
  updateHoliday: (id: number, body: { holidayDate: string; name: string; note?: string }) => put<AttendanceHoliday>(`/duty-attendance/holidays/${id}`, body),
  deleteHoliday: (id: number) => remove(`/duty-attendance/holidays/${id}`),
  saveWorkdayOverride: (body: { workDate: string; name: string; note?: string }) => post<AttendanceWorkdayOverride>('/duty-attendance/workday-overrides', body),
  updateWorkdayOverride: (id: number, body: { workDate: string; name: string; note?: string }) => put<AttendanceWorkdayOverride>(`/duty-attendance/workday-overrides/${id}`, body),
  deleteWorkdayOverride: (id: number) => remove(`/duty-attendance/workday-overrides/${id}`),
};
/** Khóa cache luôn có ID tài khoản để không lộ bảng/tình trạng cũ khi đổi tài khoản không cần F5. */
export const attendanceKeys = {
  departments: (userId?: number) => ['duty-attendance', 'departments', userId ?? 0] as const,
  month: (userId: number | undefined, month: string, departmentIds: number[]) => ['duty-attendance', 'month', userId ?? 0, month, ...departmentIds] as const,
  layout: ['duty-attendance', 'layout'] as const,
  codeGroups: ['duty-attendance', 'code-groups'] as const,
};

/* ------------------------------------------------------------------ tiêu đề nhiều tầng */

/** Đường dẫn nhóm từ cấp 1 đến nhóm trực tiếp chứa cột (giống máy chủ). */
export function attendanceGroupPath(groupId: number | null | undefined, groupsById: Map<number, AttendanceColumnGroup>): AttendanceColumnGroup[] {
  const path: AttendanceColumnGroup[] = []; const seen = new Set<number>();
  let current = groupId ? groupsById.get(groupId) : undefined;
  while (current && !seen.has(current.id)) { seen.add(current.id); path.unshift(current); current = current.parentId ? groupsById.get(current.parentId) : undefined; }
  return path;
}

export type AttendanceHeaderInput = { sectionId: number; name: string; path: Array<{ id: number; name: string; color: string }> };
export type AttendanceHeaderCell = { kind: 'SECTION' | 'GROUP' | 'LEAF'; row: number; col: number; rowSpan: number; colSpan: number; text: string; color: string };

/**
 * Lưới tiêu đề giống Excel: hàng 0 = phần, hàng 1..depth = các tầng nhóm, tên cột đặt
 * ngay dưới nhóm sâu nhất của nó và gộp dọc tới hàng cuối. Cùng thuật toán với máy chủ.
 */
export function buildAttendanceHeader(columns: AttendanceHeaderInput[], sectionOf: (sectionId: number) => { name: string; color: string }) {
  const depth = columns.reduce((max, column) => Math.max(max, column.path.length), 0);
  const cells: AttendanceHeaderCell[] = [];
  for (let index = 0; index < columns.length;) {
    let end = index + 1; while (end < columns.length && columns[end]!.sectionId === columns[index]!.sectionId) end += 1;
    const section = sectionOf(columns[index]!.sectionId);
    cells.push({ kind: 'SECTION', row: 0, col: index, rowSpan: 1, colSpan: end - index, text: section.name, color: section.color }); index = end;
  }
  for (let level = 0; level < depth; level++) {
    for (let index = 0; index < columns.length;) {
      const group = columns[index]!.path[level]; if (!group) { index += 1; continue; }
      let end = index + 1; while (end < columns.length && columns[end]!.sectionId === columns[index]!.sectionId && columns[end]!.path[level]?.id === group.id) end += 1;
      cells.push({ kind: 'GROUP', row: level + 1, col: index, rowSpan: 1, colSpan: end - index, text: group.name, color: group.color }); index = end;
    }
  }
  columns.forEach((column, index) => { const row = column.path.length + 1; cells.push({ kind: 'LEAF', row, col: index, rowSpan: depth + 2 - row, colSpan: 1, text: column.name, color: '' }); });
  return { depth, rows: depth + 2, cells: cells.sort((left, right) => left.row - right.row || left.col - right.col) };
}

/** Chữ đen trên nền nhạt, chữ trắng trên nền đậm. */
export function attendanceForeground(hex: string) {
  const raw = hex.replace('#', ''); const r = Number.parseInt(raw.slice(0, 2), 16); const g = Number.parseInt(raw.slice(2, 4), 16); const b = Number.parseInt(raw.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#0f172a' : '#ffffff';
}
