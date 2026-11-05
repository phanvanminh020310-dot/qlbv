import { apiFetch } from '@/lib/api';

export interface AttendanceCode { id: number; code: string; name: string; group: string; color: string; countsAsDuty: boolean; showSummary: boolean; sortOrder: number; active: boolean; note: string }
export interface AttendanceDate { date: string; day: number; weekday: string; isWeekend: boolean; isPast: boolean; isRest: boolean; holidayName: string }
export interface AttendanceStaff { stt: number; id: number; fullName: string; title: string; username: string; totals: Record<string, number> }
export interface AttendanceDepartment { id: number; name: string; code: string; shortName: string }
export interface AttendanceDepartmentScope { canSelect: boolean; items: AttendanceDepartment[] }
export interface AttendanceMonth {
  month: string;
  /** Ngày hiện tại do server (Asia/Ho_Chi_Minh) trả về, dùng để khóa ngày đã qua. */
  today: string;
  department: { id: number; name: string; hospital: string };
  dates: AttendanceDate[];
  codes: AttendanceCode[];
  summaryCodes: string[];
  summaryColumns: Array<{ code: string; name: string }>;
  staff: AttendanceStaff[];
  entries: Record<string, { code: string; note: string }>;
  holidays: Array<{ id: number; holidayDate: string; name: string; note: string }>;
}
const get = <T,>(path: string) => apiFetch<T>(path);
const put = <T,>(path: string, body: unknown) => apiFetch<T>(path, { method: 'PUT', body });
export const dutyAttendanceApi = {
  departments: () => get<AttendanceDepartmentScope>('/duty-attendance/departments'),
  month: (month: string, departmentId?: number) => get<AttendanceMonth>(`/duty-attendance/month?${new URLSearchParams({ month, ...(departmentId ? { departmentId: String(departmentId) } : {}) })}`),
  save: (entries: Array<{ userId: number; workDate: string; code?: string | null; note?: string }>, departmentId?: number) => put<{ saved: number }>('/duty-attendance/entries', { entries, ...(departmentId ? { departmentId } : {}) }),
  exportPath: (format: 'xlsx' | 'docx' | 'pdf', month: string, departmentId?: number) => `/duty-attendance/export/${format}?${new URLSearchParams({ month, ...(departmentId ? { departmentId: String(departmentId) } : {}) })}`,
  codes: () => get<AttendanceCode[]>('/duty-attendance/codes'),
  createCode: (body: Omit<AttendanceCode, 'id'>) => apiFetch<AttendanceCode>('/duty-attendance/codes', { method: 'POST', body }),
  updateCode: (id: number, body: Omit<AttendanceCode, 'id'>) => put<AttendanceCode>(`/duty-attendance/codes/${id}`, body),
  deleteCode: (id: number) => apiFetch<{ deleted: true }>(`/duty-attendance/codes/${id}`, { method: 'DELETE' }),
  holidays: (month: string) => get<Array<{ id: number; holidayDate: string; name: string; note: string }>>(`/duty-attendance/holidays?month=${month}`),
  saveHoliday: (body: { holidayDate: string; name: string; note?: string }) => apiFetch('/duty-attendance/holidays', { method: 'POST', body }),
  deleteHoliday: (id: number) => apiFetch(`/duty-attendance/holidays/${id}`, { method: 'DELETE' }),
};
/** Khóa cache luôn có ID tài khoản để không lộ bảng/tình trạng cũ khi đổi tài khoản không cần F5. */
export const attendanceKeys = {
  departments: (userId?: number) => ['duty-attendance', 'departments', userId ?? 0] as const,
  month: (userId: number | undefined, month: string, departmentId?: number) => ['duty-attendance', 'month', userId ?? 0, month, departmentId ?? 0] as const,
};
