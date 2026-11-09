import { apiFetch } from '@/lib/api';

export interface AttendanceCodeGroup { id: number; code: string; name: string; sortOrder: number; active: boolean }
export interface AttendanceCode { id: number; code: string; name: string; group: string; color: string; countsAsDuty: boolean; showSummary: boolean; countValue: string; sortOrder: number; active: boolean; note: string }
export interface AttendanceSection { id: number; code: string; name: string; kind: 'ADMIN' | 'DAYS' | 'SYMBOLS' | 'REPORT' | 'CUSTOM'; color: string; sortOrder: number; active: boolean }
export interface AttendanceColumn { id: number; sectionId: number; key: string; name: string; columnType: 'FORMULA' | 'MANUAL'; dataType: 'NUMBER' | 'TEXT'; formula: string; placeholder: string; sortOrder: number; active: boolean }
export interface AttendanceValidation { id: number; name: string; expression: string; message: string; sortOrder: number; active: boolean }
export interface AttendanceLayout { sections: AttendanceSection[]; columns: AttendanceColumn[]; validations: AttendanceValidation[] }
export interface AttendanceDate { date: string; day: number; weekday: string; isWeekend: boolean; isPast: boolean; isRest: boolean; holidayName: string }
export interface AttendanceStaff { stt: number; id: number; fullName: string; title: string; username: string }
export interface AttendanceDepartment { id: number; name: string; code: string; shortName: string }
export interface AttendanceDepartmentScope { canSelect: boolean; items: AttendanceDepartment[] }
export interface AttendanceMonth {
  month: string;
  today: string;
  department: { id: number; name: string; hospital: string };
  dates: AttendanceDate[];
  codes: AttendanceCode[];
  sections: AttendanceSection[];
  columns: AttendanceColumn[];
  validations: AttendanceValidation[];
  staff: AttendanceStaff[];
  entries: Record<string, { code: string; note: string }>;
  /** Giá trị cột tự nhập đang có, dùng khóa userId:columnId. */
  manualValues: Record<string, string>;
  /** Cột ký hiệu, công thức và tự nhập theo mã cột, dùng khóa userId. */
  rowValues: Record<string, Record<string, string | number>>;
  holidays: Array<{ id: number; holidayDate: string; name: string; note: string }>;
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
export const dutyAttendanceApi = {
  departments: () => get<AttendanceDepartmentScope>('/duty-attendance/departments'),
  month: (month: string, departmentId?: number) => get<AttendanceMonth>(`/duty-attendance/month?${new URLSearchParams({ month, ...(departmentId ? { departmentId: String(departmentId) } : {}) })}`),
  save: (entries: Array<{ userId: number; workDate: string; code?: string | null; note?: string }>, departmentId?: number) => put<{ saved: number; adjustedManualValues?: number }>('/duty-attendance/entries', { entries, ...(departmentId ? { departmentId } : {}) }),
  saveManualValues: (month: string, values: Array<{ userId: number; columnId: number; value?: string | null }>, departmentId?: number) => put<{ saved: number }>('/duty-attendance/manual-values', { month, values, ...(departmentId ? { departmentId } : {}) }),
  exportPath: (format: 'xlsx' | 'docx' | 'pdf', month: string, departmentId?: number) => `/duty-attendance/export/${format}?${new URLSearchParams({ month, ...(departmentId ? { departmentId: String(departmentId) } : {}) })}`,
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
  holidays: (month: string) => get<Array<{ id: number; holidayDate: string; name: string; note: string }>>(`/duty-attendance/holidays?month=${month}`),
  saveHoliday: (body: { holidayDate: string; name: string; note?: string }) => post('/duty-attendance/holidays', body),
  deleteHoliday: (id: number) => remove(`/duty-attendance/holidays/${id}`),
};
/** Khóa cache luôn có ID tài khoản để không lộ bảng/tình trạng cũ khi đổi tài khoản không cần F5. */
export const attendanceKeys = {
  departments: (userId?: number) => ['duty-attendance', 'departments', userId ?? 0] as const,
  month: (userId: number | undefined, month: string, departmentId?: number) => ['duty-attendance', 'month', userId ?? 0, month, departmentId ?? 0] as const,
  layout: ['duty-attendance', 'layout'] as const,
  codeGroups: ['duty-attendance', 'code-groups'] as const,
};
