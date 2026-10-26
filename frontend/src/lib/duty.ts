/**
 * Lớp dữ liệu phân hệ LỊCH TRỰC KHÁM BỆNH: kiểu dữ liệu khớp với API, nhãn tiếng Việt,
 * định dạng thời gian theo múi giờ Asia/Bangkok và các hàm gọi API.
 */
import { apiFetch } from '@/lib/api';

export { defaultLockAtLocal } from './duty-period-defaults';

export type PeriodStatus = 'NHAP' | 'CONG_BO' | 'DA_CHOT';
export type Phase = 'NHAP' | 'MO' | 'CHOT';
export type RequestType = 'NHUONG' | 'DOI' | 'NGOAI_LE';
export type RequestStatus = 'CHO_NGUOI_NHAN' | 'CHO_DUYET' | 'DA_DUYET' | 'TU_CHOI' | 'HUY';

export interface DutyRules {
  maxShiftsPerDay: number;
  maxShiftsPerPeriod: number;
  maxNightShiftsPerPeriod: number;
  maxHoursPerDay: number;
  maxHoursPerWeek: number;
  minRestHours: number;
  crossDeptPolicy: 'CHO_PHEP' | 'CANH_BAO' | 'CHAN';
  allowSelfRegister: boolean;
  swapNeedsApproval: boolean;
  requireFullBeforePublish: boolean;
}

export interface DutyPeriod {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  status: PeriodStatus;
  phase: Phase;
  locked: boolean;
  lockAt: string;
  registrationOpensAt: string | null;
  lockedAt: string | null;
  publishedAt: string | null;
  rules: DutyRules;
  note: string;
  slotCount?: number;
  requiredCount?: number;
  filledCount?: number;
  isCurrent?: boolean;
  isoWeek?: number;
  year?: number;
  month?: number;
}

export interface GridRoom { id: number; code: string; name: string; departmentId: number | null; location: string; sortOrder: number }
export interface GridShift { id: number; code: string; name: string; startTime: string; endTime: string; color: string; isNight: boolean; sortOrder: number }
export interface GridRole { id: number; code: string; name: string; requiredTitle: string; sortOrder: number }
export interface GridDay { date: string; weekday: number; label: string; closed: boolean; closedName: string }
export interface GridAssignment { id: number; userId: number; fullName: string; title: string; departmentName: string; source: string; note: string }
export interface GridSlot {
  id: number;
  periodId: number;
  dutyDate: string;
  roomId: number;
  roomCode: string;
  roomName: string;
  roomDepartmentId: number | null;
  shiftId: number;
  shiftCode: string;
  shiftName: string;
  shiftColor: string;
  startTime: string;
  endTime: string;
  isNight: boolean;
  hours: number;
  start: number;
  end: number;
  roleId: number;
  roleName: string;
  requiredTitle: string;
  requiredCount: number;
  filled: number;
  note: string;
  periodStatus: PeriodStatus;
  locked: boolean;
  past: boolean;
  assignments: GridAssignment[];
}
export interface AbsenceRow {
  id: number; userId: number; fullName: string; startDate: string; endDate: string; reason: string; note?: string;
  kind?: 'REQUEST' | 'APPROVED'; status?: 'CHO_DUYET' | 'DA_DUYET' | 'TU_CHOI' | 'HUY'; responseNote?: string;
  actions?: { canCancel: boolean; canApprove: boolean };
}
export interface AbsenceReview extends AbsenceRow {
  canApprove: boolean;
  approvalBlockReason: string | null;
  affected: Array<{ slotId: number; assignmentId: number; periodName: string; dutyDate: string; roomCode: string; shiftCode: string; roleName: string; candidates: Array<{ userId: number; fullName: string; title: string }> }>;
}
export interface GridResponse {
  period: DutyPeriod;
  rooms: GridRoom[];
  shifts: GridShift[];
  roles: GridRole[];
  days: GridDay[];
  slots: GridSlot[];
  absences: AbsenceRow[];
  summary: { slots: number; required: number; filled: number; missing: number; people: number };
  viewer: {
    userId: number;
    canManage: boolean;
    canManageAll: boolean;
    canRegister: boolean;
    canExport: boolean;
    canApproveSwap: boolean;
    canResolveException: boolean;
    mySlotIds: number[];
  };
}
export interface Candidate {
  userId: number;
  fullName: string;
  title: string;
  departmentId: number | null;
  departmentName: string;
  /** Ứng viên thuộc phạm vi khoa của người xếp lịch hiện tại. */
  inSchedulerDepartment: boolean;
  ok: boolean;
  errors: string[];
  warnings: string[];
  codes: string[];
}
export interface MyOptionsResponse {
  blocked: string | null;
  locked: boolean;
  items: Array<{ slotId: number; mine: boolean; canRegister: boolean; errors: string[]; warnings: string[] }>;
}
export interface RequestRow {
  id: number;
  periodId: number;
  periodName: string;
  periodStatus: PeriodStatus;
  type: RequestType;
  status: RequestStatus;
  urgent: boolean;
  reason: string;
  responseNote: string;
  requesterId: number;
  requesterName: string;
  targetUserId: number | null;
  targetName: string | null;
  replacementUserId: number | null;
  replacementName: string | null;
  slotId: number;
  slotDate: string;
  roomCode: string;
  shiftCode: string;
  roleName: string;
  targetSlotId: number | null;
  targetSlotDate: string | null;
  targetRoomCode: string | null;
  targetShiftCode: string | null;
  createdAt: string;
  lockedNow: boolean;
  actions: { canCancel: boolean; canAccept: boolean; canDecline: boolean; canApprove: boolean; canReject: boolean };
}
export interface MySlot extends Omit<GridSlot, 'assignments'> {
  source: string;
  canSelfCancel: boolean;
  canRequestSwap: boolean;
}
export interface MeResponse {
  today: string;
  assignments: MySlot[];
  absences: Array<{ id: number; userId: number; startDate: string; endDate: string; reason: string; note: string }>;
  periods: DutyPeriod[];
}
export interface StaffItem { id: number; fullName: string; title: string; departmentName: string }
export interface SummaryItem { userId: number; fullName: string; title: string; departmentName: string; shifts: number; nights: number; hours: number; days: number }
export interface SummaryResponse { items: SummaryItem[]; fairness: { people: number; maxHours: number; minHours: number; gapHours: number } }
export interface LogRow {
  id: number;
  action: string;
  reason: string;
  detail: Record<string, unknown>;
  createdAt: string;
  actorName: string | null;
  userName: string | null;
}

export interface LiveMonitorDoctor {
  userId: number;
  fullName: string;
  title: string;
  departmentName: string;
  absent: boolean;
  /** Chỉ true khi có bản ghi AI_FACIAL_BIOMETRICS. */
  verified: boolean;
  verifiedAt: string | null;
  /** Mở khẩn cấp IT bằng PIN; luôn tách biệt với xác thực khuôn mặt. */
  itOverrideAt: string | null;
}
export interface LiveMonitorSlot {
  id: number;
  roleName: string;
  shiftCode: string;
  shiftName: string;
  shiftColor: string;
  startTime: string;
  endTime: string;
  requiredCount: number;
  doctors: LiveMonitorDoctor[];
  unassigned: number;
}
export interface LiveMonitorRoom {
  id: number;
  code: string;
  name: string;
  location: string;
  departmentId: number | null;
  slots: LiveMonitorSlot[];
}
export interface LiveMonitorResponse {
  serverTime: string;
  scope: 'ALL' | 'DEPT';
  summary: { rooms: number; slots: number; expected: number; verified: number; itOverrides: number; pending: number; unassigned: number };
  rooms: LiveMonitorRoom[];
}

/* ------------------------------------------------------------------ Nhãn */

export const PHASE_LABEL: Record<Phase, string> = { NHAP: 'Bản nháp', MO: 'Đã công bố', CHOT: 'Đã chốt' };
export const PHASE_TONE: Record<Phase, 'muted' | 'info' | 'success'> = { NHAP: 'muted', MO: 'info', CHOT: 'success' };
export const REQUEST_TYPE_LABEL: Record<RequestType, string> = { NHUONG: 'Nhường ca', DOI: 'Đổi ca', NGOAI_LE: 'Ngoại lệ (KHTH)' };
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  CHO_NGUOI_NHAN: 'Chờ người nhận',
  CHO_DUYET: 'Chờ duyệt',
  DA_DUYET: 'Đã duyệt',
  TU_CHOI: 'Từ chối',
  HUY: 'Đã huỷ',
};
export const REQUEST_STATUS_TONE: Record<RequestStatus, 'warning' | 'info' | 'success' | 'danger' | 'muted'> = {
  CHO_NGUOI_NHAN: 'warning',
  CHO_DUYET: 'info',
  DA_DUYET: 'success',
  TU_CHOI: 'danger',
  HUY: 'muted',
};
export const SOURCE_LABEL: Record<string, string> = {
  DANG_KY: 'Tự đăng ký',
  PHAN_CONG: 'Phân công',
  NHUONG: 'Nhận nhường',
  DOI: 'Đổi ca',
  NGOAI_LE: 'Thay (ngoại lệ)',
  DIEU_CHINH: 'Điều chỉnh',
};
export const ABSENCE_REASON_LABEL: Record<string, string> = {
  PHEP_NAM: 'Nghỉ phép năm',
  OM_DAU: 'Ốm đau',
  HOC_TAP: 'Học tập',
  CONG_TAC: 'Công tác',
  KHAC: 'Lý do khác',
};
export const ACTION_LABEL: Record<string, string> = {
  PERIOD_CREATE: 'Tạo kỳ lịch',
  PERIOD_UPDATE: 'Sửa kỳ lịch',
  SLOTS_GENERATE: 'Sinh ô trực',
  SLOT_CREATE: 'Thêm ô trực',
  SLOT_UPDATE: 'Sửa ô trực',
  SLOT_DELETE: 'Xoá ô trực',
  ASSIGN: 'Xếp người trực',
  UNASSIGN: 'Gỡ người trực',
  SELF_REGISTER: 'Tự đăng ký ca',
  SELF_UNREGISTER: 'Huỷ đăng ký ca',
  PUBLISH: 'Công bố lịch',
  LOCK: 'Chốt lịch',
  UNLOCK: 'Mở chốt',
  REQUEST_NHUONG: 'Yêu cầu nhường ca',
  REQUEST_DOI: 'Yêu cầu đổi ca',
  REQUEST_NGOAI_LE: 'Yêu cầu ngoại lệ',
  REQUEST_ACCEPTED: 'Người nhận đồng ý',
  REQUEST_DECLINED: 'Người nhận từ chối',
  REQUEST_CANCELLED: 'Huỷ yêu cầu',
  REQUEST_REJECTED: 'Từ chối yêu cầu',
  HANDOVER: 'Nhường ca (đã duyệt)',
  SWAP: 'Đổi ca (đã duyệt)',
  EXCEPTION: 'Xử lý ngoại lệ',
  OVERRIDE: 'Điều chỉnh trực tiếp',
  ABSENCE: 'Ghi nhận nghỉ phép',
  EXPORT: 'Xuất lịch',
};

/* ------------------------------------------------------------------ Thời gian (múi giờ Asia/Bangkok) */

const WEEKDAY_LABEL = ['', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
export const weekdayLabel = (n: number) => WEEKDAY_LABEL[n] ?? '';

export function bkkTodayYmd(): string {
  return new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
}
export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** 1 = Thứ 2 … 7 = Chủ nhật */
export function isoWeekday(ymd: string): number {
  const d = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}
/** Thứ 2 của tuần kế tiếp (tính theo giờ Việt Nam) */
export function nextMondayYmd(): string {
  const t = bkkTodayYmd();
  const dow = new Date(`${t}T00:00:00Z`).getUTCDay() || 7;
  return addDaysYmd(t, 8 - dow);
}

/** Tính số tuần ISO 8601 và năm ISO của một ngày YMD */
export function isoWeekNumber(ymd: string): { year: number; week: number } {
  const [y, m, d] = ymd.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1, d));
  const dayNr = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNr);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: target.getUTCFullYear(), week: weekNo };
}

/** Tính khoảng ngày Thứ Hai - Chủ Nhật từ năm và số tuần ISO */
export function isoWeekRange(year: number, week: number): { startDate: string; endDate: string } {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const mondayWeek1 = new Date(jan4.getTime() - (jan4Day - 1) * 86400000);
  const monday = new Date(mondayWeek1.getTime() + (week - 1) * 7 * 86400000);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  return {
    startDate: monday.toISOString().slice(0, 10),
    endDate: sunday.toISOString().slice(0, 10),
  };
}

/** Tự động sinh tên chuẩn cho kỳ lịch theo tuần ISO: "Tuần 43 (19/10 – 25/10/2026) - Tháng 10" */
export function smartPeriodTitle(startDate: string, endDate: string): string {
  const { year, week } = isoWeekNumber(startDate);
  const [, m] = startDate.split('-').map(Number);
  return `Tuần ${week} (${fmtDm(startDate)} – ${fmtDm(endDate)}/${year}) - Tháng ${String(m).padStart(2, '0')}`;
}

export const fmtDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
};
export const fmtDm = (ymd: string) => {
  const [, m, d] = ymd.split('-');
  return `${d}/${m}`;
};
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}
/** ISO → chuỗi `YYYY-MM-DDTHH:mm` theo giờ Việt Nam (để gán vào ô datetime-local) */
export function isoToBkkLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}
/** `YYYY-MM-DDTHH:mm` (giờ Việt Nam) → ISO có múi giờ +07:00 */
export function bkkLocalToIso(local: string): string {
  return `${local.length === 16 ? `${local}:00` : local}+07:00`;
}
export function hoursText(h: number): string {
  return Number.isInteger(h) ? `${h} giờ` : `${h.toFixed(1)} giờ`;
}
export function shiftTimeText(s: { startTime: string; endTime: string }) {
  return `${s.startTime}–${s.endTime}`;
}

/* ------------------------------------------------------------------ API */

type Json = Record<string, unknown>;
const post = <T,>(path: string, body?: Json) => apiFetch<T>(path, { method: 'POST', body: body ?? {} });
const put = <T,>(path: string, body: Json) => apiFetch<T>(path, { method: 'PUT', body });
const del = <T,>(path: string) => apiFetch<T>(path, { method: 'DELETE' });
const get = <T,>(path: string) => apiFetch<T>(path);

export const dutyApi = {
  periods: (q?: { from?: string; to?: string; year?: number; month?: number; status?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (q?.from) qs.set('from', q.from);
    if (q?.to) qs.set('to', q.to);
    if (q?.year) qs.set('year', String(q.year));
    if (q?.month) qs.set('month', String(q.month));
    if (q?.status) qs.set('status', q.status);
    if (q?.search) qs.set('search', q.search);
    return get<DutyPeriod[]>(`/duty/periods${qs.toString() ? `?${qs}` : ''}`);
  },
  suggestNext: () =>
    get<{
      year: number;
      week: number;
      startDate: string;
      endDate: string;
      name: string;
      lockAt: string;
      lastPeriod: { id: number; name: string; slotCount: number; filledCount: number } | null;
    }>('/duty/periods/suggest-next'),
  period: (id: number) => get<DutyPeriod>(`/duty/periods/${id}`),
  createPeriod: (body: Json) => post<DutyPeriod>('/duty/periods', body),
  clonePeriod: (id: number, body?: { startDate?: string; endDate?: string; name?: string; copyAssignments?: boolean }) =>
    post<DutyPeriod & { copiedSlots?: number; copiedAssignments?: number }>(`/duty/periods/${id}/clone`, body),
  updatePeriod: (id: number, body: Json) => put<DutyPeriod>(`/duty/periods/${id}`, body),
  deletePeriod: (id: number, body?: { reason?: string; confirmName?: string }) =>
    post<{ ok: boolean; notified: number }>(`/duty/periods/${id}/delete`, body ?? {}),
  publish: (id: number, force = false) => post<{ ok: boolean; missing: number; notified: number }>(`/duty/periods/${id}/publish`, { force }),
  lock: (id: number) => post<{ ok: boolean }>(`/duty/periods/${id}/lock`),
  unlock: (id: number, reason: string, lockAt: string) => post<{ ok: boolean }>(`/duty/periods/${id}/unlock`, { reason, lockAt }),
  grid: (id: number) => get<GridResponse>(`/duty/periods/${id}/grid`),
  myOptions: (id: number) => get<MyOptionsResponse>(`/duty/periods/${id}/my-options`),
  summary: (id: number) => get<SummaryResponse>(`/duty/periods/${id}/summary`),
  logs: (id: number) => get<LogRow[]>(`/duty/periods/${id}/logs`),
  generate: (id: number, body: Json) => post<{ created: number; skipped: number; days: number }>(`/duty/periods/${id}/slots/generate`, body),
  createSlot: (id: number, body: Json) => post<GridSlot>(`/duty/periods/${id}/slots`, body),
  updateSlot: (id: number, body: Json) => put<GridSlot>(`/duty/slots/${id}`, body),
  deleteSlot: (id: number, body: Json) => post<{ ok: boolean }>(`/duty/slots/${id}/delete`, body),
  candidates: (slotId: number, q?: string) => get<Candidate[]>(`/duty/slots/${slotId}/candidates${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  assign: (slotId: number, body: Json) => post<GridSlot>(`/duty/slots/${slotId}/assignments`, body),
  unassign: (assignmentId: number, reason?: string) => post<{ ok: boolean }>(`/duty/assignments/${assignmentId}/remove`, { reason: reason ?? '' }),
  register: (slotId: number) => post<{ ok: boolean }>(`/duty/slots/${slotId}/register`),
  unregister: (slotId: number) => post<{ ok: boolean }>(`/duty/slots/${slotId}/unregister`),
  me: () => get<MeResponse>('/duty/me'),
  liveMonitor: () => get<LiveMonitorResponse>('/duty/live-monitor'),
  staff: (q?: string) => get<StaffItem[]>(`/duty/staff${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  absences: (q?: { from?: string; to?: string; userId?: number }) => {
    const qs = new URLSearchParams();
    if (q?.from) qs.set('from', q.from);
    if (q?.to) qs.set('to', q.to);
    if (q?.userId) qs.set('userId', String(q.userId));
    return get<AbsenceRow[]>(`/duty/absences${qs.toString() ? `?${qs}` : ''}`);
  },
  createAbsence: (body: Json) => post<AbsenceRow & { affected: Array<{ slotId: number; dutyDate: string; roomCode: string; shiftCode: string }> }>('/duty/absences', body),
  deleteAbsence: (id: number) => del<{ ok: boolean }>(`/duty/absences/${id}`),
  absenceRequests: (box: 'mine' | 'approval' | 'all' = 'mine') => get<AbsenceRow[]>(`/duty/absence-requests?box=${box}`),
  absenceReview: (id: number) => get<AbsenceReview>(`/duty/absence-requests/${id}`),
  approveAbsence: (id: number, body: Json) => post<{ ok: boolean }>(`/duty/absence-requests/${id}/approve`, body),
  rejectAbsence: (id: number, note: string) => post<{ ok: boolean }>(`/duty/absence-requests/${id}/reject`, { note }),
  cancelAbsence: (id: number) => post<{ ok: boolean }>(`/duty/absence-requests/${id}/cancel`, {}),
  requests: (box: 'mine' | 'incoming' | 'approval' | 'all', periodId?: number) =>
    get<RequestRow[]>(`/duty/requests?box=${box}${periodId ? `&periodId=${periodId}` : ''}`),
  createRequest: (body: Json) => post<RequestRow>('/duty/requests', body),
  acceptRequest: (id: number) => post<{ ok: boolean; status: string; reason: string }>(`/duty/requests/${id}/accept`),
  declineRequest: (id: number, note?: string) => post<{ ok: boolean }>(`/duty/requests/${id}/decline`, { note: note ?? '' }),
  cancelRequest: (id: number) => post<{ ok: boolean }>(`/duty/requests/${id}/cancel`),
  approveRequest: (id: number, body: Json = {}) => post<{ ok: boolean }>(`/duty/requests/${id}/approve`, body),
  rejectRequest: (id: number, note: string) => post<{ ok: boolean }>(`/duty/requests/${id}/reject`, { note }),
  override: (body: Json) => post<GridSlot & { forced: boolean; violations: string[] }>('/duty/exceptions/override', body),
  roomOptions: () => get<Array<{ value: number; label: string; departmentId: number | null; active: boolean }>>('/duty/rooms/options'),
  shiftOptions: () =>
    get<Array<{ value: number; label: string; code: string; name: string; startTime: string; endTime: string; isNight: boolean; color: string; active: boolean }>>('/duty/shifts/options'),
  roleOptions: () => get<Array<{ value: number; label: string; name: string; requiredTitle: string; active: boolean }>>('/duty/roles/options'),
  exportPath: (id: number) => `/duty/periods/${id}/export`,
};

export const DUTY_KEYS = {
  periods: ['duty-periods'] as const,
  period: (id: number) => ['duty-period', id] as const,
  grid: (id: number) => ['duty-grid', id] as const,
  myOptions: (id: number) => ['duty-options', id] as const,
  summary: (id: number) => ['duty-summary', id] as const,
  logs: (id: number) => ['duty-logs', id] as const,
  liveMonitor: ['duty-live-monitor'] as const,
  candidates: (slotId: number) => ['duty-candidates', slotId] as const,
  me: ['duty-me'] as const,
  staff: ['duty-staff'] as const,
  absences: ['duty-absences'] as const,
  absenceRequests: ['duty-absence-requests'] as const,
  requests: ['duty-requests'] as const,
  rooms: ['duty-rooms'] as const,
};

/** Bảng màu cho ca trực: dịu mắt, tươi mát, đủ tương phản với chữ trắng trên ô lịch */
export const SHIFT_PALETTE: { value: string; label: string }[] = [
  { value: '#0F766E', label: 'Ngọc lam' },
  { value: '#0E7490', label: 'Xanh cổ vịt' },
  { value: '#0369A1', label: 'Xanh biển' },
  { value: '#1D4ED8', label: 'Xanh dương' },
  { value: '#4338CA', label: 'Chàm' },
  { value: '#6D28D9', label: 'Oải hương' },
  { value: '#BE185D', label: 'Hồng mận' },
  { value: '#BE123C', label: 'Đỏ san hô' },
  { value: '#C2410C', label: 'Cam đất' },
  { value: '#B45309', label: 'Hổ phách' },
  { value: '#15803D', label: 'Xanh lá' },
  { value: '#475569', label: 'Xám đá' },
];
