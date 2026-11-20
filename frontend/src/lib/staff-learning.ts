import { apiFetch } from '@/lib/api';

export interface StaffLearningDay { date: string; weekday: string; label: string }
export interface StaffLearningDepartment { id: number; code: string; name: string; shortName: string }
export interface StaffLearningPerson { userId: number; fullName: string; title: string; manv: string }
export interface StaffLearningStaff extends StaffLearningPerson {
  departmentId: number;
  departmentName: string;
  departmentShortName: string;
}
export interface StaffLearningRegistrationInput { userId: number; studyDate: string }
export interface StaffLearningWeek {
  weekStart: string;
  days: StaffLearningDay[];
  departments: StaffLearningDepartment[];
  /** Nhân viên đang hoạt động thuộc khoa/phòng mà tài khoản được phép nhập lịch. */
  staff: StaffLearningStaff[];
  /** Khóa departmentId:YYYY-MM-DD, danh sách cán bộ đã đăng ký học trong ô. */
  entries: Record<string, StaffLearningPerson[]>;
  viewer: { userId: number; canRegister: boolean; seesAllDepartments: boolean };
  summary: { registrations: number; people: number; departments: number; daysWithRegistration: number };
}

const get = <T,>(path: string) => apiFetch<T>(path);
const post = <T,>(path: string, body: unknown) => apiFetch<T>(path, { method: 'POST', body });
const remove = <T,>(path: string) => apiFetch<T>(path, { method: 'DELETE' });
const params = (weekStart: string) => new URLSearchParams({ weekStart }).toString();

export const staffLearningApi = {
  week: (weekStart: string) => get<StaffLearningWeek>(`/staff-learning/week?${params(weekStart)}`),
  register: (input: StaffLearningRegistrationInput) => post<{ registered: true; alreadyRegistered: boolean }>('/staff-learning/registrations', input),
  remove: ({ userId, studyDate }: StaffLearningRegistrationInput) => remove<{ removed: boolean }>(`/staff-learning/registrations/${userId}/${encodeURIComponent(studyDate)}`),
  exportPath: (weekStart: string) => `/staff-learning/export?${params(weekStart)}`,
};

export const staffLearningKeys = {
  week: (userId: number | undefined, weekStart: string) => ['staff-learning', 'week', userId ?? 0, weekStart] as const,
};
