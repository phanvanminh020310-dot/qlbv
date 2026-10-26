/**
 * Chọn kỳ lịch khi mở trang lịch trực.
 *
 * Lịch thường được lập theo tuần Thứ 2–Thứ 7 nên không thể chỉ dựa vào việc
 * `today` nằm trong startDate/endDate (đặc biệt vào Chủ nhật). Ưu tiên bất kỳ
 * kỳ nào giao với tuần ISO hiện tại, gồm cả bản nháp mà API đã cho phép người
 * quản lý nhìn thấy. Vì vậy tuần mới không bị rơi về kỳ đã công bố của tuần cũ.
 */
export type DutyPeriodChoice = {
  id: number;
  startDate: string;
  endDate: string;
  status: string;
};

function addDaysYmd(ymd: string, days: number): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoWeekStartYmd(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  const weekday = date.getUTCDay() || 7;
  return addDaysYmd(ymd, 1 - weekday);
}

/** Kỳ có giao với tuần lịch Thứ 2–Chủ nhật chứa `today` hay không. */
function intersectsCurrentWeek(period: DutyPeriodChoice, today: string): boolean {
  const start = isoWeekStartYmd(today);
  const end = addDaysYmd(start, 6);
  return period.startDate <= end && period.endDate >= start;
}

/**
 * Ưu tiên tuần ISO hiện tại kể cả khi đang là NHAP. Fallback duy trì hành vi
 * cũ: kỳ chứa hôm nay → kỳ công bố sắp tới gần nhất → kỳ mới nhất.
 */
export function pickDefaultDutyPeriod(
  periods: DutyPeriodChoice[],
  today: string,
): number | null {
  if (!periods.length) return null;

  const inThisWeek = periods.filter((period) => intersectsCurrentWeek(period, today));
  const currentWeek = inThisWeek.sort(
    (a, b) =>
      Number(b.startDate <= today && b.endDate >= today) - Number(a.startDate <= today && a.endDate >= today) ||
      a.startDate.localeCompare(b.startDate),
  );
  if (currentWeek[0]) return currentWeek[0].id;

  const visible = periods.filter((period) => period.status !== 'NHAP');
  const pool = visible.length ? visible : periods;
  const current = pool.find((period) => period.startDate <= today && period.endDate >= today);
  if (current) return current.id;

  const upcoming = [...pool]
    .filter((period) => period.startDate > today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  return (upcoming ?? [...pool].sort((a, b) => b.startDate.localeCompare(a.startDate))[0]).id;
}
