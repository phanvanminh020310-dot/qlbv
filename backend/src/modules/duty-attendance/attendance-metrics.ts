import type { DutyAttendanceCalculationRole, DutyAttendanceRestSource } from '../../db/schema';

export type AttendanceDayClass = 'WEEKDAY' | 'WEEKEND' | 'HOLIDAY';

/** Cấu hình tối thiểu của ký hiệu dùng cho tổng hợp nghiệp vụ và số dư nghỉ bù. */
export type AttendancePairingCode = {
  code: string;
  countValue: string | number;
  calculationRole: DutyAttendanceCalculationRole;
  deductsWorkday: boolean;
  restSource?: DutyAttendanceRestSource;
};
/**
 * Một ký hiệu trong dòng thời gian của một nhân viên. `current = false` là dữ liệu
 * ngoài bảng đang xem (khoa khác/tháng khác): chỉ dùng để tính số dư nghỉ bù tích lũy.
 */
export type AttendancePairingEntry = { date: string; code: string; current?: boolean };
type MetricCode = AttendancePairingCode;
type MetricEntry = AttendancePairingEntry;

export const ATTENDANCE_SYSTEM_METRICS = [
  { key: 'SYS_NGAY_CONG', label: 'Ngày công', description: 'Thứ Hai–Sáu, trừ ngày lễ và các ký hiệu được đánh dấu “trừ Ngày công”.' },
  { key: 'SYS_TRUC_NGAY_THUONG', label: 'Trực ngày thường', description: 'Ký hiệu vai trò Trực vào ngày làm việc.' },
  { key: 'SYS_TRUC_NGAY_NGHI', label: 'Trực ngày nghỉ', description: 'Ký hiệu vai trò Trực vào Thứ Bảy/Chủ nhật không phải ngày lễ.' },
  { key: 'SYS_TRUC_NGAY_LE', label: 'Trực ngày lễ', description: 'Ký hiệu vai trò Trực vào ngày lễ; ngày lễ luôn ưu tiên hơn cuối tuần.' },
  { key: 'SYS_NGHI_TRUC_NGAY_THUONG', label: 'Nghỉ trực ngày thường', description: 'Phần nghỉ bù trong tháng được trừ vào ca Trực ngày thường (trừ dần ca Trực cũ nhất chưa nghỉ).' },
  { key: 'SYS_NGHI_TRUC_NGAY_NGHI', label: 'Nghỉ trực ngày nghỉ', description: 'Phần nghỉ bù trong tháng được trừ vào ca Trực ngày nghỉ (trừ dần ca Trực cũ nhất chưa nghỉ).' },
  { key: 'SYS_NGHI_TRUC_NGAY_LE', label: 'Nghỉ trực ngày lễ', description: 'Phần nghỉ bù trong tháng được trừ vào ca Trực ngày lễ (trừ dần ca Trực cũ nhất chưa nghỉ).' },
  { key: 'SYS_TANG_CUONG_NGAY_THUONG', label: 'Tăng cường ngày thường', description: 'Ký hiệu vai trò Tăng cường vào ngày làm việc.' },
  { key: 'SYS_TANG_CUONG_NGAY_NGHI', label: 'Tăng cường ngày nghỉ', description: 'Ký hiệu vai trò Tăng cường vào ngày nghỉ.' },
  { key: 'SYS_TANG_CUONG_NGAY_LE', label: 'Tăng cường ngày lễ', description: 'Ký hiệu vai trò Tăng cường vào ngày lễ.' },
  { key: 'SYS_NGHI_TANG_CUONG_NGAY_THUONG', label: 'Nghỉ tăng cường ngày thường', description: 'Không còn phát sinh: Tăng cường không được tính để nghỉ bù. Giữ mã để công thức cũ không lỗi (luôn bằng 0).' },
  { key: 'SYS_NGHI_TANG_CUONG_NGAY_NGHI', label: 'Nghỉ tăng cường ngày nghỉ', description: 'Không còn phát sinh: Tăng cường không được tính để nghỉ bù. Giữ mã để công thức cũ không lỗi (luôn bằng 0).' },
  { key: 'SYS_NGHI_TANG_CUONG_NGAY_LE', label: 'Nghỉ tăng cường ngày lễ', description: 'Không còn phát sinh: Tăng cường không được tính để nghỉ bù. Giữ mã để công thức cũ không lỗi (luôn bằng 0).' },
  { key: 'SYS_NGHI_BU_CHUA_GAN', label: 'Nghỉ bù vượt số trực', description: 'Phần nghỉ bù trong tháng vượt quá tổng ca Trực tích lũy (thường là dữ liệu cũ); cần rà soát.' },
  { key: 'SYS_TRUC_TICH_LUY', label: 'Tổng Trực tích lũy', description: 'Tổng ca Trực (theo giá trị đếm) của nhân viên từ trước đến nay, mọi khoa/phòng.' },
  { key: 'SYS_NGHI_BU_TICH_LUY', label: 'Tổng nghỉ bù tích lũy', description: 'Tổng nghỉ bù (NB = 1, NB2 = 0,5…) của nhân viên từ trước đến nay, mọi khoa/phòng.' },
  { key: 'SYS_CON_DUOC_BU', label: 'Còn được nghỉ bù', description: 'Tổng Trực tích lũy trừ tổng nghỉ bù tích lũy. Không được lưu thay đổi làm số này âm.' },
] as const;

export const ATTENDANCE_SYSTEM_METRIC_KEYS = new Set<string>(ATTENDANCE_SYSTEM_METRICS.map((metric) => metric.key));

const rounded = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const count = (value: string | number) => {
  const number = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(number) && number >= 0 ? rounded(number) : 0;
};
const toDate = (value: string) => new Date(`${value}T00:00:00Z`);

/**
 * Ngày lễ ưu tiên hơn cuối tuần. Ngày làm bù/hoán đổi chỉ chuyển ngày cuối tuần thành
 * ngày làm việc và không được phép lấn át một ngày lễ đang tồn tại.
 */
export function attendanceDayClass(date: string, holidayDates: Set<string>, workdayDates: Set<string> = new Set()): AttendanceDayClass {
  if (holidayDates.has(date)) return 'HOLIDAY';
  if (workdayDates.has(date)) return 'WEEKDAY';
  const weekday = toDate(date).getUTCDay();
  return weekday === 0 || weekday === 6 ? 'WEEKEND' : 'WEEKDAY';
}

const metricKey = (prefix: 'SYS_TRUC' | 'SYS_NGHI_TRUC' | 'SYS_TANG_CUONG' | 'SYS_NGHI_TANG_CUONG', dayClass: AttendanceDayClass) =>
  `${prefix}_${dayClass === 'WEEKDAY' ? 'NGAY_THUONG' : dayClass === 'WEEKEND' ? 'NGAY_NGHI' : 'NGAY_LE'}`;

export type AttendanceRestBalance = { duty: number; rest: number; remaining: number };

/**
 * Số dư nghỉ bù theo số lượng: tổng giá trị đếm của ký hiệu vai trò Trực trừ tổng
 * giá trị đếm của ký hiệu vai trò Nghỉ bù. Tăng cường không được tính. Không xét ngày:
 * nghỉ bù có thể đặt ở bất kỳ ngày nào miễn tổng nghỉ không vượt tổng trực.
 * Đây là nguồn chân lý dùng chung cho bảng tổng hợp và kiểm tra trước khi lưu.
 */
export function attendanceRestBalance(input: { codes: AttendancePairingCode[]; entries: AttendancePairingEntry[] }): AttendanceRestBalance {
  const codes = new Map(input.codes.map((code) => [code.code.toUpperCase(), code]));
  let duty = 0; let rest = 0;
  for (const entry of input.entries) {
    const code = codes.get(entry.code.toUpperCase());
    if (code?.calculationRole === 'DUTY') duty += count(code.countValue);
    else if (code?.calculationRole === 'REST') rest += count(code.countValue);
  }
  return { duty: rounded(duty), rest: rounded(rest), remaining: rounded(duty - rest) };
}

/**
 * Phân bổ nghỉ bù vào ca Trực chỉ để phân loại báo cáo (nghỉ trực ngày thường/nghỉ/lễ):
 * nghỉ bù theo thứ tự ngày lần lượt trừ dần ca Trực cũ nhất còn dư, cho phép tách lẻ
 * 0,5. Phần không còn ca Trực để trừ được trả về `unallocated`.
 */
export function allocateAttendanceRest(input: { codes: AttendancePairingCode[]; entries: AttendancePairingEntry[] }) {
  const codes = new Map(input.codes.map((code) => [code.code.toUpperCase(), code]));
  const timeline = input.entries
    .map((entry, index) => ({ entry, index, code: codes.get(entry.code.toUpperCase()) }))
    .filter((item): item is { entry: AttendancePairingEntry; index: number; code: AttendancePairingCode } => !!item.code)
    .sort((left, right) => left.entry.date.localeCompare(right.entry.date) || left.index - right.index);
  const duties = timeline.filter((item) => item.code.calculationRole === 'DUTY').map((item) => ({ entry: item.entry, left: count(item.code.countValue) }));
  let cursor = 0;
  const allocations: Array<{ rest: AttendancePairingEntry; value: number; sources: Array<{ entry: AttendancePairingEntry; value: number }>; unallocated: number }> = [];
  for (const item of timeline) {
    if (item.code.calculationRole !== 'REST') continue;
    const value = count(item.code.countValue);
    let need = value;
    const sources: Array<{ entry: AttendancePairingEntry; value: number }> = [];
    while (need > 1e-9 && cursor < duties.length) {
      const duty = duties[cursor]!;
      const used = Math.min(need, duty.left);
      if (used > 0) { sources.push({ entry: duty.entry, value: rounded(used) }); duty.left = rounded(duty.left - used); need = rounded(need - used); }
      if (duty.left <= 1e-9) cursor += 1;
    }
    allocations.push({ rest: item.entry, value, sources, unallocated: rounded(Math.max(0, need)) });
  }
  return { allocations };
}

const formatNumber = (value: number) => String(rounded(value)).replace('.', ',');

/**
 * Tính các biến nghiệp vụ theo từng người/tháng. Hàm thuần để có thể kiểm thử kế toán độc lập với CSDL/UI.
 * Một ngày lễ trùng cuối tuần được xếp HOLIDAY trước, đúng nguyên tắc thanh toán ngày lễ.
 */
export function calculateAttendanceMetrics(input: {
  monthDates: string[];
  holidayDates: Iterable<string>;
  /** Ngày được quyết định là làm việc bù/hoán đổi, kể cả khi rơi vào cuối tuần. */
  workdayDates?: Iterable<string>;
  codes: MetricCode[];
  /** Toàn bộ ký hiệu của nhân viên (mọi tháng, mọi khoa) để tính số dư nghỉ bù tích lũy. */
  entries: MetricEntry[];
}) {
  const holidaySet = new Set(input.holidayDates);
  const workdaySet = new Set(input.workdayDates ?? []);
  const values: Record<string, number> = Object.fromEntries(ATTENDANCE_SYSTEM_METRICS.map((metric) => [metric.key, 0]));
  const warnings: string[] = [];
  const codes = new Map(input.codes.map((code) => [code.code.toUpperCase(), code]));
  const currentDates = new Set(input.monthDates);
  const currentEntries = input.entries.filter((entry) => entry.current !== false && currentDates.has(entry.date));

  for (const date of input.monthDates) {
    const kind = attendanceDayClass(date, holidaySet, workdaySet);
    if (kind === 'WEEKDAY') values.SYS_NGAY_CONG += 1;
    // Một ngày có thể có nhiều ký hiệu; từng ký hiệu vẫn được tính theo cấu hình riêng.
    for (const entry of currentEntries.filter((item) => item.date === date)) {
      const code = codes.get(entry.code.toUpperCase());
      if (!code) continue;
      const value = count(code.countValue);
      if (kind === 'WEEKDAY' && code.deductsWorkday) values.SYS_NGAY_CONG -= value;
      if (code.calculationRole === 'DUTY') values[metricKey('SYS_TRUC', kind)] += value;
      if (code.calculationRole === 'REINFORCEMENT') values[metricKey('SYS_TANG_CUONG', kind)] += value;
    }
  }
  values.SYS_NGAY_CONG = Math.max(0, values.SYS_NGAY_CONG);

  const balance = attendanceRestBalance({ codes: input.codes, entries: input.entries });
  values.SYS_TRUC_TICH_LUY = balance.duty;
  values.SYS_NGHI_BU_TICH_LUY = balance.rest;
  values.SYS_CON_DUOC_BU = balance.remaining;
  for (const { rest, sources, unallocated } of allocateAttendanceRest({ codes: input.codes, entries: input.entries }).allocations) {
    if (rest.current === false || !currentDates.has(rest.date)) continue;
    values.SYS_NGHI_BU_CHUA_GAN += unallocated;
    for (const source of sources) values[metricKey('SYS_NGHI_TRUC', attendanceDayClass(source.entry.date, holidaySet, workdaySet))] += source.value;
  }
  if (balance.remaining < 0) warnings.push(`Tổng nghỉ bù tích lũy (${formatNumber(balance.rest)}) đang vượt tổng ca Trực tích lũy (${formatNumber(balance.duty)}); cần bỏ bớt ${formatNumber(-balance.remaining)} ngày nghỉ bù`);

  for (const key of Object.keys(values)) values[key] = rounded(values[key]);
  return { values, warnings };
}
