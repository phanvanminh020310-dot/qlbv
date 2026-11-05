import { apiFetch } from '@/lib/api';

export interface AttendanceCode { id: number; code: string; name: string; group: string; color: string; countsAsDuty: boolean; showSummary: boolean; sortOrder: number; active: boolean; note: string }
export interface AttendanceDate { date: string; day: number; weekday: string; isRest: boolean; holidayName: string }
export interface AttendanceStaff { stt: number; id: number; fullName: string; title: string; username: string; totals: Record<string, number> }
export interface AttendanceMonth {
  month: string;
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
  month: (month: string) => get<AttendanceMonth>(`/duty-attendance/month?month=${month}`),
  save: (entries: Array<{ userId: number; workDate: string; code?: string | null; note?: string }>) => put<{ saved: number }>('/duty-attendance/entries', { entries }),
  exportPath: (format: 'xlsx' | 'docx' | 'pdf', month: string) => `/duty-attendance/export/${format}?month=${month}`,
  codes: () => get<AttendanceCode[]>('/duty-attendance/codes'),
  createCode: (body: Omit<AttendanceCode, 'id'>) => apiFetch<AttendanceCode>('/duty-attendance/codes', { method: 'POST', body }),
  updateCode: (id: number, body: Omit<AttendanceCode, 'id'>) => put<AttendanceCode>(`/duty-attendance/codes/${id}`, body),
  holidays: (month: string) => get<Array<{ id: number; holidayDate: string; name: string; note: string }>>(`/duty-attendance/holidays?month=${month}`),
  saveHoliday: (body: { holidayDate: string; name: string; note?: string }) => apiFetch('/duty-attendance/holidays', { method: 'POST', body }),
  deleteHoliday: (id: number) => apiFetch(`/duty-attendance/holidays/${id}`, { method: 'DELETE' }),
};
export const attendanceKeys = { month: (month: string) => ['duty-attendance', month] as const };
