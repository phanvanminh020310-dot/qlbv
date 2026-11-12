import { apiFetch } from '@/lib/api';

export interface AttendanceCodeGroup { id: number; code: string; name: string; sortOrder: number; active: boolean }
export type AttendanceCalculationRole = 'NONE' | 'DUTY' | 'REINFORCEMENT' | 'REST';
export type AttendanceRestSource = 'ANY_DUTY' | 'DUTY' | 'REINFORCEMENT';
export interface AttendanceCode { id: number; code: string; name: string; group: string; color: string; countsAsDuty: boolean; showSummary: boolean; countValue: string; calculationRole: AttendanceCalculationRole; deductsWorkday: boolean; restSource: AttendanceRestSource; sortOrder: number; active: boolean; note: string }
export interface AttendanceSystemMetric { key: string; label: string; description: string }
export interface AttendanceSection { id: number; code: string; name: string; kind: 'ADMIN' | 'DAYS' | 'SYMBOLS' | 'REPORT' | 'CUSTOM'; color: string; sortOrder: number; active: boolean }
export interface AttendanceColumn { id: number; sectionId: number; key: string; name: string; columnType: 'FORMULA' | 'MANUAL'; dataType: 'NUMBER' | 'TEXT'; formula: string; placeholder: string; sortOrder: number; active: boolean }
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
export interface AttendanceLayout { sections: AttendanceSection[]; columns: AttendanceColumn[]; validations: AttendanceValidation[]; systemMetrics: AttendanceSystemMetric[] }
export type AttendanceLockPolicy = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export interface AttendanceDate { date: string; day: number; weekday: string; isWeekend: boolean; isPast: boolean; isLocked: boolean; isRest: boolean; holidayName: string; workdayName: string; isWorkingOverride: boolean }
export interface AttendanceStaff { stt: number; id: number; key: string; departmentId: number; departmentName: string; fullName: string; title: string; manv: string; username: string }
export interface AttendanceDepartment { id: number; name: string; code: string; shortName: string }
export interface AttendanceDepartmentScope { canSelect: boolean; items: AttendanceDepartment[] }
export interface AttendanceMonth {
  month: string;
  today: string;
  lockPolicy: AttendanceLockPolicy;
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
  /** Khoảng truy ca trực trước đó để phân loại nghỉ bù. */
  restPairLookbackDays: number;
  staff: AttendanceStaff[];
  entries: Record<string, { code: string; note: string }>;
  /** Giá trị cột tự nhập đang có, dùng khóa staffKey:columnId. */
  manualValues: Record<string, string>;
  /** Thông điệp các ràng buộc chưa thỏa, theo ô tự nhập staffKey:columnId. */
  manualViolations: Record<string, string[]>;
  /** Nghỉ bù chưa ghép được ca trực/tăng cường phù hợp, theo staffKey; không chặn nhập liệu. */
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
  save: (entries: Array<{ userId: number; workDate: string; code?: string | null; note?: string }>, departmentId: number) => put<{ saved: number }>('/duty-attendance/entries', { entries, departmentId }),
  saveManualValues: (month: string, values: Array<{ userId: number; columnId: number; value?: string | null }>, departmentId: number) => put<{ saved: number }>('/duty-attendance/manual-values', { month, values, departmentId }),
  exportPath: (format: 'xlsx' | 'docx' | 'pdf', month: string, departmentIds: number[]) => `/duty-attendance/export/${format}?${attendanceScopeParams(month, departmentIds)}`,
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
  deleteHoliday: (id: number) => remove(`/duty-attendance/holidays/${id}`),
  saveWorkdayOverride: (body: { workDate: string; name: string; note?: string }) => post<AttendanceWorkdayOverride>('/duty-attendance/workday-overrides', body),
  deleteWorkdayOverride: (id: number) => remove(`/duty-attendance/workday-overrides/${id}`),
};
/** Khóa cache luôn có ID tài khoản để không lộ bảng/tình trạng cũ khi đổi tài khoản không cần F5. */
export const attendanceKeys = {
  departments: (userId?: number) => ['duty-attendance', 'departments', userId ?? 0] as const,
  month: (userId: number | undefined, month: string, departmentIds: number[]) => ['duty-attendance', 'month', userId ?? 0, month, ...departmentIds] as const,
  layout: ['duty-attendance', 'layout'] as const,
  codeGroups: ['duty-attendance', 'code-groups'] as const,
};
