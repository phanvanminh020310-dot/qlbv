import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateAttendanceMetrics } from '../src/modules/duty-attendance/attendance-metrics';

const codes = [
  { code: 'T', countValue: '1', calculationRole: 'DUTY' as const, deductsWorkday: false, restSource: 'ANY_DUTY' as const },
  { code: 'TC', countValue: '1', calculationRole: 'REINFORCEMENT' as const, deductsWorkday: false, restSource: 'ANY_DUTY' as const },
  { code: 'N', countValue: '1', calculationRole: 'REST' as const, deductsWorkday: true, restSource: 'ANY_DUTY' as const },
  { code: 'N2', countValue: '0.5', calculationRole: 'REST' as const, deductsWorkday: true, restSource: 'ANY_DUTY' as const },
  { code: 'ND', countValue: '1', calculationRole: 'REST' as const, deductsWorkday: true, restSource: 'DUTY' as const },
  { code: 'NTC', countValue: '1', calculationRole: 'REST' as const, deductsWorkday: true, restSource: 'REINFORCEMENT' as const },
  { code: 'P', countValue: '1', calculationRole: 'NONE' as const, deductsWorkday: true, restSource: 'ANY_DUTY' as const },
  { code: 'H2', countValue: '0.5', calculationRole: 'NONE' as const, deductsWorkday: true, restSource: 'ANY_DUTY' as const },
];

const weekdayWeek = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10', '2026-08-11'];

test('biến nghiệp vụ tính Ngày công theo ngày làm việc, lễ ưu tiên hơn cuối tuần và trừ ký hiệu theo countValue', () => {
  const result = calculateAttendanceMetrics({
    monthDates: weekdayWeek,
    // 08/08 là Thứ Bảy nhưng vẫn phải là ngày lễ, không phải ngày nghỉ thường.
    holidayDates: ['2026-08-08'],
    codes,
    restPairLookbackDays: 14,
    entries: [
      { date: '2026-08-03', code: 'P' },
      { date: '2026-08-04', code: 'H2' },
      { date: '2026-08-05', code: 'T' },
      { date: '2026-08-08', code: 'T' },
      { date: '2026-08-09', code: 'TC' },
    ],
  });
  // 7 ngày Thứ Hai–Sáu trong dữ liệu (03–07,10–11), trừ P 1 và H2 0.5.
  assert.equal(result.values.SYS_NGAY_CONG, 5.5);
  assert.equal(result.values.SYS_TRUC_NGAY_THUONG, 1);
  assert.equal(result.values.SYS_TRUC_NGAY_LE, 1, 'ngày lễ trùng Thứ Bảy phải tính trực ngày lễ');
  assert.equal(result.values.SYS_TRUC_NGAY_NGHI, 0);
  assert.equal(result.values.SYS_TANG_CUONG_NGAY_NGHI, 1);
});

test('nghỉ bù lấy loại ngày của ca gần nhất trước đó; trực và tăng cường được tách riêng', () => {
  const result = calculateAttendanceMetrics({
    monthDates: ['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'],
    holidayDates: [],
    codes,
    restPairLookbackDays: 14,
    entries: [
      { date: '2026-08-02', code: 'T' }, // Chủ nhật
      { date: '2026-08-04', code: 'N' }, // nghỉ bù cho trực Chủ nhật, không dựa vào thứ của ngày 04
      { date: '2026-08-05', code: 'TC' },
      { date: '2026-08-06', code: 'N2' }, // nghỉ bù cho tăng cường ngày thường
    ],
  });
  assert.equal(result.values.SYS_NGHI_TRUC_NGAY_NGHI, 1);
  assert.equal(result.values.SYS_NGHI_TANG_CUONG_NGAY_THUONG, 0.5);
  assert.equal(result.values.SYS_NGHI_TRUC_NGAY_THUONG, 0);
  assert.equal(result.values.SYS_NGHI_BU_CHUA_GAN, 0);
  assert.deepEqual(result.warnings, []);
});

test('nghỉ bù có thể ghép ca ở tháng trước, nhưng không ghép nhầm khi vượt khoảng dò cấu hình', () => {
  const matchingPreviousMonth = calculateAttendanceMetrics({
    monthDates: ['2026-08-01', '2026-08-02'],
    holidayDates: [],
    codes,
    restPairLookbackDays: 14,
    entries: [{ date: '2026-07-31', code: 'T' }, { date: '2026-08-02', code: 'N' }],
  });
  assert.equal(matchingPreviousMonth.values.SYS_NGHI_TRUC_NGAY_THUONG, 1);

  const stalePreviousMonth = calculateAttendanceMetrics({
    monthDates: ['2026-08-20'],
    holidayDates: [],
    codes,
    restPairLookbackDays: 7,
    entries: [{ date: '2026-08-01', code: 'T' }, { date: '2026-08-20', code: 'N' }],
  });
  assert.equal(stalePreviousMonth.values.SYS_NGHI_BU_CHUA_GAN, 1);
  assert.match(stalePreviousMonth.warnings[0] ?? '', /chưa tìm được ca trực phù hợp/);
});

test('lọc nguồn nghỉ bù chỉ chọn đúng loại ca và vẫn lấy ca cùng nguồn gần nhất', () => {
  const result = calculateAttendanceMetrics({
    monthDates: ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'],
    holidayDates: [],
    codes,
    restPairLookbackDays: 14,
    entries: [
      { date: '2026-08-03', code: 'T' },
      { date: '2026-08-04', code: 'TC' },
      { date: '2026-08-05', code: 'ND' }, // Bỏ qua TC gần hơn để tìm Trực.
      { date: '2026-08-06', code: 'NTC' }, // Chỉ ghép Tăng cường.
    ],
  });
  assert.equal(result.values.SYS_NGHI_TRUC_NGAY_THUONG, 1);
  assert.equal(result.values.SYS_NGHI_TANG_CUONG_NGAY_THUONG, 1);
  assert.equal(result.values.SYS_NGHI_BU_CHUA_GAN, 0);
});

test('nhiều nghỉ bù liên tiếp cùng quy về ca phù hợp gần nhất và ca thiếu nguồn tạo cảnh báo', () => {
  const result = calculateAttendanceMetrics({
    monthDates: ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06'],
    holidayDates: [],
    codes,
    restPairLookbackDays: 14,
    entries: [
      { date: '2026-08-03', code: 'T' },
      { date: '2026-08-04', code: 'N2' },
      { date: '2026-08-05', code: 'N' },
      { date: '2026-08-06', code: 'NTC' },
    ],
  });
  assert.equal(result.values.SYS_NGHI_TRUC_NGAY_THUONG, 1.5, 'N2 và N đều dựa theo ca trực gần nhất');
  assert.equal(result.values.SYS_NGHI_BU_CHUA_GAN, 1, 'nghỉ chỉ ghép Tăng cường không được ghép nhầm với Trực');
  assert.equal(result.warnings.length, 1);
});
