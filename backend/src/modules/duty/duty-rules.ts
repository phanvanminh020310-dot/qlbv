/**
 * LÕI NGHIỆP VỤ LỊCH TRỰC — hàm thuần, không truy vấn CSDL (dễ kiểm thử).
 *
 * - Thời gian vận hành cố định Asia/Bangkok (UTC+7, không có giờ mùa hè); mọi mốc quy về mili-giây UTC.
 * - `evaluateCandidate` trả về danh sách VI PHẠM: lỗi (ERROR) chặn xếp trực, cảnh báo (WARNING) chỉ báo.
 * - Tuần tính theo ISO (Thứ 2 → Chủ nhật) để khớp cách lập lịch tuần trong thực tế.
 */
import type { DutyRules } from '../../db/schema/duty';

export const BKK_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;
const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;

/**
 * Mặc định lập kỳ mới theo yêu cầu vận hành: chỉ giới hạn một ca/ngày;
 * các ngưỡng số giờ/số ca theo tuần-kỳ và khoảng nghỉ đều bằng 0 = không giới hạn.
 * Lịch đã tạo giữ nguyên bộ quy tắc đã lưu riêng của kỳ đó.
 */
export const DEFAULT_DUTY_RULES: DutyRules = {
  maxShiftsPerDay: 1,
  maxShiftsPerPeriod: 0,
  maxNightShiftsPerPeriod: 0,
  maxHoursPerDay: 0,
  maxHoursPerWeek: 0,
  minRestHours: 0,
  crossDeptPolicy: 'CANH_BAO',
  allowSelfRegister: true,
  swapNeedsApproval: true,
  requireFullBeforePublish: true,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function pickNumber(src: Record<string, unknown>, key: keyof DutyRules, lo: number, hi: number, def: number): number {
  const raw = src[key];
  if (raw === undefined || raw === null || raw === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) ? clamp(n, lo, hi) : def;
}

/** Chuẩn hoá cấu hình người dùng gửi lên: thiếu → mặc định, ngoài khoảng → kẹp về biên */
export function normalizeRules(input: unknown): DutyRules {
  const s = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const D = DEFAULT_DUTY_RULES;
  const policy = ['CHO_PHEP', 'CANH_BAO', 'CHAN'].includes(String(s.crossDeptPolicy))
    ? (s.crossDeptPolicy as DutyRules['crossDeptPolicy'])
    : D.crossDeptPolicy;
  const bool = (k: keyof DutyRules): boolean => (typeof s[k] === 'boolean' ? (s[k] as boolean) : D[k] as boolean);
  return {
    maxShiftsPerDay: Math.round(pickNumber(s, 'maxShiftsPerDay', 0, 10, D.maxShiftsPerDay)),
    maxShiftsPerPeriod: Math.round(pickNumber(s, 'maxShiftsPerPeriod', 0, 500, D.maxShiftsPerPeriod)),
    maxNightShiftsPerPeriod: Math.round(pickNumber(s, 'maxNightShiftsPerPeriod', 0, 500, D.maxNightShiftsPerPeriod)),
    maxHoursPerDay: pickNumber(s, 'maxHoursPerDay', 0, 24, D.maxHoursPerDay),
    maxHoursPerWeek: pickNumber(s, 'maxHoursPerWeek', 0, 168, D.maxHoursPerWeek),
    minRestHours: pickNumber(s, 'minRestHours', 0, 72, D.minRestHours),
    crossDeptPolicy: policy,
    allowSelfRegister: bool('allowSelfRegister'),
    swapNeedsApproval: bool('swapNeedsApproval'),
    requireFullBeforePublish: bool('requireFullBeforePublish'),
  };
}

/* ------------------------------------------------------------------ Thời gian */

export const parseYmd = (ymd: string): [number, number, number] => {
  const [y, m, d] = ymd.split('-').map(Number);
  return [y, m, d];
};

/** Nửa đêm (giờ Bangkok) của ngày YYYY-MM-DD, tính theo mili-giây UTC */
export function dayStartMs(ymd: string): number {
  const [y, m, d] = parseYmd(ymd);
  return Date.UTC(y, m - 1, d) - BKK_OFFSET_MS;
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Khoảng thời gian thực của một ca trên một ngày (ca qua đêm cộng thêm 24 giờ) */
export function shiftInterval(ymd: string, startTime: string, endTime: string, crossesMidnight: boolean) {
  const base = dayStartMs(ymd);
  const start = base + hhmmToMinutes(startTime) * MIN_MS;
  let end = base + hhmmToMinutes(endTime) * MIN_MS;
  if (crossesMidnight || end <= start) end += DAY_MS;
  return { start, end, hours: (end - start) / HOUR_MS };
}

/** Ca được coi là ca đêm khi có từ 2 giờ trở lên trong khoảng 22:00–06:00 (BLLĐ 2019 Điều 106) */
export function isNightWindow(startTime: string, endTime: string, crossesMidnight: boolean): boolean {
  const s = hhmmToMinutes(startTime);
  let e = hhmmToMinutes(endTime);
  if (crossesMidnight || e <= s) e += 1440;
  const overlap = (a: number, b: number, c: number, d: number) => Math.max(0, Math.min(b, d) - Math.max(a, c));
  const minutes =
    overlap(s, e, 1320, 1800) + // 22:00 → 06:00 (ngày hôm sau)
    overlap(s, e, 0, 360) + // 00:00 → 06:00 cùng ngày
    overlap(s, e, 1440, 1800); // 00:00 → 06:00 của ngày kế tiếp
  return minutes >= 120;
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = parseYmd(ymd);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 1 = Thứ 2 … 7 = Thứ 7, 8 → không dùng (Chủ nhật = 7) */
export function isoWeekday(ymd: string): number {
  const [y, m, d] = parseYmd(ymd);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** Ngày Thứ 2 của tuần chứa `ymd` */
export function weekStart(ymd: string): string {
  return addDays(ymd, -(isoWeekday(ymd) - 1));
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

export function bangkokToday(now: number = Date.now()): string {
  return new Date(now + BKK_OFFSET_MS).toISOString().slice(0, 10);
}

export const fmtDate = (ymd: string) => {
  const [y, m, d] = parseYmd(ymd);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
};
export const fmtDm = (ymd: string) => {
  const [, m, d] = parseYmd(ymd);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
};

/** Tính số tuần ISO 8601 và năm ISO của một ngày YMD */
export function isoWeekNumber(ymd: string): { year: number; week: number } {
  const [y, m, d] = parseYmd(ymd);
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
  const [, m] = parseYmd(startDate);
  return `Tuần ${week} (${fmtDm(startDate)} – ${fmtDm(endDate)}/${year}) - Tháng ${String(m).padStart(2, '0')}`;
}

/** Mốc chốt lịch mặc định: Thứ Sáu 17:00 trước ngày bắt đầu ca tuần (giờ Việt Nam +07:00) */
export function defaultLockAt(startDate: string): string {
  const dow = isoWeekday(startDate);
  // Nếu bắt đầu vào Thứ 2 (dow=1), lùi 3 ngày về Thứ Sáu tuần trước
  // Nếu ngày khác, lùi về Thứ Sáu gần nhất trước ngày bắt đầu
  const diffToFriday = dow >= 5 ? dow - 5 : dow + 2;
  const lockFriday = addDays(startDate, -diffToFriday);
  return `${lockFriday}T17:00:00+07:00`;
}

const fmtH = (h: number) => (Number.isInteger(h) ? `${h}` : h.toFixed(1));

/* ------------------------------------------------------------------ Kiểm tra ràng buộc */

export type ViolationCode =
  | 'NOT_ACTIVE'
  | 'ALREADY_IN_SLOT'
  | 'SLOT_FULL'
  | 'LOCKED'
  | 'PAST'
  | 'REGISTRATION'
  | 'TITLE'
  | 'ABSENT'
  | 'CROSS_DEPT'
  | 'OVERLAP'
  | 'REST'
  | 'SHIFTS_PER_DAY'
  | 'HOURS_PER_DAY'
  | 'HOURS_PER_WEEK'
  | 'SHIFTS_PER_PERIOD'
  | 'NIGHT_PER_PERIOD';

export interface Violation {
  code: ViolationCode;
  severity: 'ERROR' | 'WARNING';
  message: string;
}

/** Ô trực đã nạp đủ thông tin để kiểm tra */
export interface EngineSlot {
  id: number;
  periodId: number;
  dutyDate: string;
  roomId: number;
  roomCode: string;
  roomDepartmentId: number | null;
  shiftCode: string;
  isNight: boolean;
  hours: number;
  start: number;
  end: number;
  roleName: string;
  requiredTitle: string;
  requiredCount: number;
  filled: number;
}

export interface EngineUser {
  id: number;
  fullName: string;
  title: string;
  departmentId: number | null;
  active: boolean;
}

/** Một ca đã được xếp cho người này (trong cửa sổ ±7 ngày, mọi kỳ) */
export interface EngineDuty {
  slotId: number;
  dutyDate: string;
  start: number;
  end: number;
  isNight: boolean;
  hours: number;
  roomCode: string;
  shiftCode: string;
}

export interface EngineAbsence {
  startDate: string;
  endDate: string;
  reason: string;
}

export interface EvaluateInput {
  slot: EngineSlot;
  user: EngineUser;
  rules: DutyRules;
  /** Ca hiện có của người này (đã loại trừ những ca sẽ bị thay thế trong cùng thao tác) */
  duties: EngineDuty[];
  absences: EngineAbsence[];
  /** Số ca / ca đêm đã có trong kỳ, KHÔNG kể ô đang xét */
  periodShifts: number;
  periodNights: number;
  alreadyInSlot: boolean;
  now: number;
  /** Kỳ đã chốt (thủ công hoặc theo mốc) */
  locked: boolean;
  /** Lý do chặn đăng ký tự nguyện (chưa mở đăng ký, kỳ chưa công bố…) */
  registrationBlocked?: string | null;
}

export interface EvaluateResult {
  ok: boolean;
  errors: Violation[];
  warnings: Violation[];
}

const normTitle = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Kiểm tra một người có được xếp vào một ô trực hay không.
 * Quy tắc "ca liền kề" (gap = 0): hai ca ban ngày liền nhau trong cùng ngày được phép (ví dụ Sáng + Chiều);
 * nếu một trong hai là ca đêm thì bắt buộc có khoảng nghỉ.
 */
export function evaluateCandidate(i: EvaluateInput): EvaluateResult {
  const errors: Violation[] = [];
  const warnings: Violation[] = [];
  const { slot: s, user: u, rules: r } = i;
  // Không tự so với chính ô đang xét (người đã có trong ô sẽ bị ALREADY_IN_SLOT)
  const duties = i.duties.filter((d) => d.slotId !== s.id);
  const err = (code: ViolationCode, message: string) => errors.push({ code, severity: 'ERROR', message });
  const warn = (code: ViolationCode, message: string) => warnings.push({ code, severity: 'WARNING', message });
  const where = `${s.roomCode} · ${s.shiftCode} · ${fmtDate(s.dutyDate)}`;

  if (!u.active) err('NOT_ACTIVE', 'Tài khoản đã ngừng hoạt động');
  if (i.alreadyInSlot) err('ALREADY_IN_SLOT', `Đã được xếp trong ca ${where}`);
  else if (s.filled >= s.requiredCount) err('SLOT_FULL', `Ca ${where} đã đủ người (${s.filled}/${s.requiredCount})`);
  if (i.locked) err('LOCKED', 'Kỳ lịch đã chốt — chỉ thay đổi qua yêu cầu ngoại lệ gửi KHTH');
  if (s.start <= i.now) err('PAST', `Ca ${where} đã bắt đầu hoặc đã qua`);
  if (i.registrationBlocked) err('REGISTRATION', i.registrationBlocked);

  if (s.requiredTitle && normTitle(u.title) !== normTitle(s.requiredTitle)) {
    err('TITLE', `Chức danh "${u.title || 'chưa khai báo'}" không khớp vai trò ${s.roleName} (yêu cầu: ${s.requiredTitle})`);
  }

  // Absences are whole hospital days, including the second day of overnight shifts.
  const absence = i.absences.find((a) => dayStartMs(a.startDate) < s.end && s.start < dayStartMs(addDays(a.endDate, 1)));
  if (absence) err('ABSENT', `Đang nghỉ/bận ${fmtDate(absence.startDate)} → ${fmtDate(absence.endDate)}`);

  if (s.roomDepartmentId && u.departmentId !== s.roomDepartmentId) {
    const msg = `Khác khoa với phòng khám ${s.roomCode}`;
    if (r.crossDeptPolicy === 'CHAN') err('CROSS_DEPT', msg);
    else if (r.crossDeptPolicy === 'CANH_BAO') warn('CROSS_DEPT', msg);
  }

  // Trùng giờ và khoảng nghỉ giữa các ca
  const minRestMs = r.minRestHours * HOUR_MS;
  let overlapWith: EngineDuty | null = null;
  let restWith: EngineDuty | null = null;
  let restGapMs = 0;
  for (const d of duties) {
    if (d.start < s.end && s.start < d.end) {
      overlapWith ??= d;
      continue;
    }
    const gap = s.start >= d.end ? s.start - d.end : d.start - s.end;
    if (gap === 0) {
      if (s.isNight || d.isNight) {
        restWith ??= d;
        restGapMs = 0;
      }
    } else if (r.minRestHours > 0 && gap < minRestMs && !restWith) {
      restWith = d;
      restGapMs = gap;
    }
  }
  if (overlapWith) {
    err('OVERLAP', `Trùng giờ với ca ${overlapWith.shiftCode} · ${overlapWith.roomCode} ngày ${fmtDm(overlapWith.dutyDate)}`);
  }
  if (restWith) {
    const other = `${restWith.shiftCode} · ${restWith.roomCode} ngày ${fmtDm(restWith.dutyDate)}`;
    if (restGapMs === 0) err('REST', `Ca đêm liền kề ca ${other} — cần có khoảng nghỉ`);
    else err('REST', `Chỉ nghỉ ${fmtH(restGapMs / HOUR_MS)}h sau/trước ca ${other} (tối thiểu ${r.minRestHours}h)`);
  }

  // Giới hạn theo ngày, tuần, kỳ
  const sameDay = duties.filter((d) => d.dutyDate === s.dutyDate);
  if (r.maxShiftsPerDay > 0 && sameDay.length + 1 > r.maxShiftsPerDay) {
    err('SHIFTS_PER_DAY', `Vượt ${r.maxShiftsPerDay} ca trong ngày ${fmtDm(s.dutyDate)}`);
  }
  const dayHours = sameDay.reduce((a, d) => a + d.hours, 0) + s.hours;
  if (r.maxHoursPerDay > 0 && dayHours > r.maxHoursPerDay + 1e-9) {
    err('HOURS_PER_DAY', `Ngày ${fmtDm(s.dutyDate)} thành ${fmtH(dayHours)} giờ trực, tối đa ${r.maxHoursPerDay} giờ/ngày`);
  }
  const wk = weekStart(s.dutyDate);
  const weekHours = duties.filter((d) => weekStart(d.dutyDate) === wk).reduce((a, d) => a + d.hours, 0) + s.hours;
  if (r.maxHoursPerWeek > 0 && weekHours > r.maxHoursPerWeek + 1e-9) {
    err('HOURS_PER_WEEK', `Tuần ${fmtDm(wk)} thành ${fmtH(weekHours)} giờ trực, tối đa ${r.maxHoursPerWeek} giờ/tuần`);
  }
  if (r.maxShiftsPerPeriod > 0 && i.periodShifts + 1 > r.maxShiftsPerPeriod) {
    err('SHIFTS_PER_PERIOD', `Vượt ${r.maxShiftsPerPeriod} ca trong kỳ lịch`);
  }
  if (s.isNight && r.maxNightShiftsPerPeriod > 0 && i.periodNights + 1 > r.maxNightShiftsPerPeriod) {
    err('NIGHT_PER_PERIOD', `Vượt ${r.maxNightShiftsPerPeriod} ca đêm trong kỳ lịch`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Gộp thông báo lỗi thành một dòng để trả về cho người dùng */
export function violationText(res: EvaluateResult): string {
  return res.errors.map((e) => e.message).join('; ');
}

/** Hai khoảng ngày YYYY-MM-DD (hai đầu bao gồm) có giao nhau không */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
