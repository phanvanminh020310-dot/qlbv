import type { DutyAttendanceCalculationRole, DutyAttendanceRestSource } from '../../db/schema';

export type AttendanceDayClass = 'WEEKDAY' | 'WEEKEND' | 'HOLIDAY';

type MetricCode = {
  code: string;
  countValue: string | number;
  calculationRole: DutyAttendanceCalculationRole;
  deductsWorkday: boolean;
  restSource: DutyAttendanceRestSource;
};
type MetricEntry = { date: string; code: string };

export const ATTENDANCE_SYSTEM_METRICS = [
  { key: 'SYS_NGAY_CONG', label: 'Ngày công', description: 'Thứ Hai–Sáu, trừ ngày lễ và các ký hiệu được đánh dấu “trừ Ngày công”.' },
  { key: 'SYS_TRUC_NGAY_THUONG', label: 'Trực ngày thường', description: 'Ký hiệu vai trò Trực vào ngày làm việc.' },
  { key: 'SYS_TRUC_NGAY_NGHI', label: 'Trực ngày nghỉ', description: 'Ký hiệu vai trò Trực vào Thứ Bảy/Chủ nhật không phải ngày lễ.' },
  { key: 'SYS_TRUC_NGAY_LE', label: 'Trực ngày lễ', description: 'Ký hiệu vai trò Trực vào ngày lễ; ngày lễ luôn ưu tiên hơn cuối tuần.' },
  { key: 'SYS_NGHI_TRUC_NGAY_THUONG', label: 'Nghỉ trực ngày thường', description: 'Nghỉ bù được ghép với ca Trực gần nhất trước đó vào ngày thường.' },
  { key: 'SYS_NGHI_TRUC_NGAY_NGHI', label: 'Nghỉ trực ngày nghỉ', description: 'Nghỉ bù được ghép với ca Trực gần nhất trước đó vào ngày nghỉ.' },
  { key: 'SYS_NGHI_TRUC_NGAY_LE', label: 'Nghỉ trực ngày lễ', description: 'Nghỉ bù được ghép với ca Trực gần nhất trước đó vào ngày lễ.' },
  { key: 'SYS_TANG_CUONG_NGAY_THUONG', label: 'Tăng cường ngày thường', description: 'Ký hiệu vai trò Tăng cường vào ngày làm việc.' },
  { key: 'SYS_TANG_CUONG_NGAY_NGHI', label: 'Tăng cường ngày nghỉ', description: 'Ký hiệu vai trò Tăng cường vào ngày nghỉ.' },
  { key: 'SYS_TANG_CUONG_NGAY_LE', label: 'Tăng cường ngày lễ', description: 'Ký hiệu vai trò Tăng cường vào ngày lễ.' },
  { key: 'SYS_NGHI_TANG_CUONG_NGAY_THUONG', label: 'Nghỉ tăng cường ngày thường', description: 'Nghỉ bù được ghép với ca Tăng cường gần nhất trước đó vào ngày thường.' },
  { key: 'SYS_NGHI_TANG_CUONG_NGAY_NGHI', label: 'Nghỉ tăng cường ngày nghỉ', description: 'Nghỉ bù được ghép với ca Tăng cường gần nhất trước đó vào ngày nghỉ.' },
  { key: 'SYS_NGHI_TANG_CUONG_NGAY_LE', label: 'Nghỉ tăng cường ngày lễ', description: 'Nghỉ bù được ghép với ca Tăng cường gần nhất trước đó vào ngày lễ.' },
  { key: 'SYS_NGHI_BU_CHUA_GAN', label: 'Nghỉ bù chưa ghép ca', description: 'Ký hiệu nghỉ bù không tìm thấy ca phù hợp trong khoảng dò đã cấu hình; cần kiểm tra lại dữ liệu.' },
] as const;

export const ATTENDANCE_SYSTEM_METRIC_KEYS = new Set<string>(ATTENDANCE_SYSTEM_METRICS.map((metric) => metric.key));

const rounded = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const count = (value: string | number) => {
  const number = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(number) && number >= 0 ? rounded(number) : 0;
};
const toDate = (value: string) => new Date(`${value}T00:00:00Z`);
const formatDate = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)}`;

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

function isMatchedDuty(role: DutyAttendanceCalculationRole, source: DutyAttendanceRestSource) {
  return role === 'DUTY' || role === 'REINFORCEMENT'
    ? source === 'ANY_DUTY' || source === role
    : false;
}

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
  entries: MetricEntry[];
  restPairLookbackDays: number;
}) {
  const holidaySet = new Set(input.holidayDates);
  const workdaySet = new Set(input.workdayDates ?? []);
  const values: Record<string, number> = Object.fromEntries(ATTENDANCE_SYSTEM_METRICS.map((metric) => [metric.key, 0]));
  const warnings: string[] = [];
  const codes = new Map(input.codes.map((code) => [code.code.toUpperCase(), code]));
  const currentDates = new Set(input.monthDates);
  const currentEntries = new Map(input.entries.filter((entry) => currentDates.has(entry.date)).map((entry) => [entry.date, entry]));

  for (const date of input.monthDates) {
    const kind = attendanceDayClass(date, holidaySet, workdaySet);
    if (kind === 'WEEKDAY') values.SYS_NGAY_CONG += 1;
    const entry = currentEntries.get(date);
    const code = entry ? codes.get(entry.code.toUpperCase()) : undefined;
    if (!code) continue;
    const value = count(code.countValue);
    if (kind === 'WEEKDAY' && code.deductsWorkday) values.SYS_NGAY_CONG -= value;
    if (code.calculationRole === 'DUTY') values[metricKey('SYS_TRUC', kind)] += value;
    if (code.calculationRole === 'REINFORCEMENT') values[metricKey('SYS_TANG_CUONG', kind)] += value;
  }
  values.SYS_NGAY_CONG = Math.max(0, values.SYS_NGAY_CONG);

  const timeline = [...input.entries]
    .filter((entry) => codes.has(entry.code.toUpperCase()))
    .sort((left, right) => left.date.localeCompare(right.date));
  const pairLimit = Math.max(1, Math.min(62, Math.floor(input.restPairLookbackDays)));
  for (let index = 0; index < timeline.length; index += 1) {
    const rest = timeline[index];
    if (!currentDates.has(rest.date)) continue;
    const restCode = codes.get(rest.code.toUpperCase());
    if (!restCode || restCode.calculationRole !== 'REST') continue;
    let matched: MetricEntry | undefined;
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      const candidate = timeline[previous];
      const gap = Math.round((toDate(rest.date).getTime() - toDate(candidate.date).getTime()) / 86_400_000);
      if (gap > pairLimit) break;
      const dutyCode = codes.get(candidate.code.toUpperCase());
      if (dutyCode && isMatchedDuty(dutyCode.calculationRole, restCode.restSource)) { matched = candidate; break; }
    }
    const value = count(restCode.countValue);
    if (!matched) {
      values.SYS_NGHI_BU_CHUA_GAN += value;
      warnings.push(`${restCode.code} ngày ${formatDate(rest.date)} chưa tìm được ca trực phù hợp trong ${pairLimit} ngày trước`);
      continue;
    }
    const dutyCode = codes.get(matched.code.toUpperCase())!;
    const kind = attendanceDayClass(matched.date, holidaySet, workdaySet);
    values[metricKey(dutyCode.calculationRole === 'DUTY' ? 'SYS_NGHI_TRUC' : 'SYS_NGHI_TANG_CUONG', kind)] += value;
  }

  for (const key of Object.keys(values)) values[key] = rounded(values[key]);
  return { values, warnings };
}
