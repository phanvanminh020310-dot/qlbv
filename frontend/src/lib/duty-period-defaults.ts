/**
 * Giá trị mặc định thuần cho hộp tạo kỳ lịch; tách riêng để kiểm thử mà không
 * phụ thuộc lớp gọi API của `duty.ts`.
 */
function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO: Thứ 2 = 1 … Chủ nhật = 7. */
function isoWeekday(ymd: string): number {
  const day = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Mốc chốt theo giờ local `YYYY-MM-DDTHH:mm`: Chủ nhật 17:00 trước tuần trực. */
export function defaultLockAtLocal(startDate: string): string {
  // Kỳ tuần chuẩn bắt đầu Thứ 2 nên đây là Chủ nhật ngay trước tuần đó.
  // Với kỳ tuỳ chỉnh, chọn Chủ nhật gần nhất vào hoặc trước ngày bắt đầu.
  const lockSunday = addDaysYmd(startDate, -(isoWeekday(startDate) % 7));
  return `${lockSunday}T17:00`;
}
