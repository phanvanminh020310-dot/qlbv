/** Regression: trang Lịch trực phải chọn tuần ISO hiện tại, kể cả kỳ NHAP. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDefaultDutyPeriod } from '../../frontend/src/lib/duty-period-selection';

const period = (id: number, startDate: string, endDate: string, status: string) => ({
  id,
  startDate,
  endDate,
  status,
});

test('lịch trực mặc định chọn kỳ của tuần hiện tại thay vì kỳ công bố tuần trước', () => {
  const periods = [
    period(11, '2026-10-19', '2026-10-25', 'CONG_BO'),
    period(12, '2026-10-26', '2026-10-31', 'NHAP'),
  ];
  assert.equal(pickDefaultDutyPeriod(periods, '2026-10-26'), 12);
  assert.equal(pickDefaultDutyPeriod(periods, '2026-10-29'), 12);
});

test('Chủ nhật vẫn giữ kỳ thuộc tuần ISO hiện tại, không nhảy sớm sang tuần kế', () => {
  const periods = [
    period(21, '2026-10-19', '2026-10-24', 'CONG_BO'),
    period(22, '2026-10-26', '2026-10-31', 'NHAP'),
  ];
  assert.equal(pickDefaultDutyPeriod(periods, '2026-10-25'), 21);
});

test('fallback vẫn ưu tiên kỳ công bố gần nhất khi không có kỳ nào của tuần hiện tại', () => {
  const periods = [
    period(31, '2026-10-12', '2026-10-17', 'CONG_BO'),
    period(32, '2026-11-02', '2026-11-07', 'CONG_BO'),
    period(33, '2026-10-26', '2026-10-31', 'NHAP'),
  ];
  // Người xem thường không nhận kỳ NHAP từ API; trường hợp này bảo toàn fallback cũ
  // khi danh sách chỉ có kỳ đã công bố.
  assert.equal(
    pickDefaultDutyPeriod(periods.filter((item) => item.status !== 'NHAP'), '2026-10-28'),
    32,
  );
});
