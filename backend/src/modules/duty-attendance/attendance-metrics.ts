import type { DutyAttendanceCalculationRole, DutyAttendanceRestSource } from '../../db/schema';

export type AttendanceDayClass = 'WEEKDAY' | 'WEEKEND' | 'HOLIDAY';

/** Cấu hình tối thiểu cần dùng chung cho ghép ca trực với nghỉ bù. */
export type AttendancePairingCode = {
  code: string;
  countValue: string | number;
  calculationRole: DutyAttendanceCalculationRole;
  deductsWorkday: boolean;
  restSource: DutyAttendanceRestSource;
};
/** Một ký hiệu trong dòng thời gian của một nhân viên. */
export type AttendancePairingEntry = { date: string; code: string };
type MetricCode = AttendancePairingCode;
type MetricEntry = AttendancePairingEntry;

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

const calendarGap = (later: string, earlier: string) => Math.round((toDate(later).getTime() - toDate(earlier).getTime()) / 86_400_000);
type DutyRole = 'DUTY' | 'REINFORCEMENT';
type PairingCandidate = { entry: AttendancePairingEntry; index: number; role: DutyRole };

/**
 * Ghép nghỉ bù theo dòng thời gian của một nhân viên.
 *
 * Mỗi loại ca chỉ giữ một nguồn chờ: một ca mới cùng loại thay thế ca cũ chưa được nghỉ
 * bù. Khi nghỉ bù nguồn ANY_DUTY lấy ca mới nhất, mọi nguồn cũ hơn cũng hết hiệu lực.
 * Vì vậy T thứ Hai, T thứ Ba, NB thứ Sáu chỉ tiêu thụ T thứ Ba; NB tiếp theo không
 * được quay lại dùng T thứ Hai. Hàm này là nguồn chân lý dùng đồng thời cho hiển thị
 * tổng hợp và kiểm tra trước khi lưu, để hai nơi không thể ghép khác nhau.
 */
export function pairAttendanceRestEntries(input: {
  codes: AttendancePairingCode[];
  entries: AttendancePairingEntry[];
  restPairLookbackDays: number;
}) {
  const codes = new Map(input.codes.map((code) => [code.code.toUpperCase(), code]));
  const pairLimit = Math.max(1, Math.min(62, Math.floor(input.restPairLookbackDays)));
  const timeline = input.entries
    .map((entry, index) => ({ entry, index, code: codes.get(entry.code.toUpperCase()) }))
    .filter((item): item is { entry: AttendancePairingEntry; index: number; code: AttendancePairingCode } => !!item.code)
    .sort((left, right) => left.entry.date.localeCompare(right.entry.date) || left.index - right.index);
  const available: Partial<Record<DutyRole, PairingCandidate>> = {};
  const pairs: Array<{ rest: AttendancePairingEntry; source?: AttendancePairingEntry }> = [];

  for (let start = 0; start < timeline.length;) {
    const date = timeline[start]!.entry.date;
    let end = start + 1;
    while (end < timeline.length && timeline[end]!.entry.date === date) end += 1;
    const dayEntries = timeline.slice(start, end);

    // Xử lý nghỉ trước rồi mới đưa ca của ngày này vào nguồn chờ, nên không thể ghép
    // nghỉ bù với Trực/Tăng cường của chính ngày đó, bất kể thứ tự tick các ký hiệu.
    for (const item of dayEntries) {
      if (item.code.calculationRole !== 'REST') continue;
      const candidates = (['DUTY', 'REINFORCEMENT'] as const)
        .map((role) => available[role])
        .filter((candidate): candidate is PairingCandidate => !!candidate)
        .filter((candidate) => isMatchedDuty(candidate.role, item.code.restSource))
        .filter((candidate) => calendarGap(item.entry.date, candidate.entry.date) <= pairLimit)
        .sort((left, right) => right.entry.date.localeCompare(left.entry.date) || right.index - left.index);
      const matched = candidates[0];
      if (!matched) {
        pairs.push({ rest: item.entry });
        continue;
      }
      pairs.push({ rest: item.entry, source: matched.entry });
      delete available[matched.role];
      // Nghỉ bù ANY_DUTY đã chốt tại nguồn gần nhất thì các nguồn cũ hơn không còn
      // là lựa chọn dự phòng cho một ngày nghỉ bù tiếp theo.
      if (item.code.restSource === 'ANY_DUTY') {
        for (const role of ['DUTY', 'REINFORCEMENT'] as const) {
          const candidate = available[role];
          if (candidate && candidate.entry.date <= matched.entry.date) delete available[role];
        }
      }
    }

    for (const item of dayEntries) {
      if (item.code.calculationRole !== 'DUTY' && item.code.calculationRole !== 'REINFORCEMENT') continue;
      // Một ca mới cùng loại thay thế nguồn cũ: không tích lũy rồi quay lại lấy ca xa hơn.
      available[item.code.calculationRole] = { entry: item.entry, index: item.index, role: item.code.calculationRole };
    }
    start = end;
  }
  return { pairs, pairLimit };
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
  const currentEntries = input.entries.filter((entry) => currentDates.has(entry.date));

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

  const { pairs, pairLimit } = pairAttendanceRestEntries({ codes: input.codes, entries: input.entries, restPairLookbackDays: input.restPairLookbackDays });
  for (const { rest, source } of pairs) {
    if (!currentDates.has(rest.date)) continue;
    const restCode = codes.get(rest.code.toUpperCase());
    if (!restCode) continue;
    const value = count(restCode.countValue);
    if (!source) {
      values.SYS_NGHI_BU_CHUA_GAN += value;
      warnings.push(`${restCode.code} ngày ${formatDate(rest.date)} chưa tìm được ca trực phù hợp trong ${pairLimit} ngày trước`);
      continue;
    }
    const dutyCode = codes.get(source.code.toUpperCase())!;
    const kind = attendanceDayClass(source.date, holidaySet, workdaySet);
    values[metricKey(dutyCode.calculationRole === 'DUTY' ? 'SYS_NGHI_TRUC' : 'SYS_NGHI_TANG_CUONG', kind)] += value;
  }

  for (const key of Object.keys(values)) values[key] = rounded(values[key]);
  return { values, warnings };
}
