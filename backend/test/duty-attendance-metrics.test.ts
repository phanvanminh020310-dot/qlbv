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

test('nhiều ký hiệu cùng ngày đều được cộng; nghỉ bù trừ vào số Trực tích lũy, kể cả cùng ngày', () => {
  const result = calculateAttendanceMetrics({
    monthDates: ['2026-08-03', '2026-08-04'],
    holidayDates: [],
    codes,
    entries: [
      // Cùng ngày vừa Trực, vừa Tăng cường và nghỉ phép: cả ba phải tính độc lập.
      { date: '2026-08-03', code: 'T' },
      { date: '2026-08-03', code: 'TC' },
      { date: '2026-08-03', code: 'P' },
      { date: '2026-08-04', code: 'N2' },
    ],
  });
  assert.equal(result.values.SYS_TRUC_NGAY_THUONG, 1);
  assert.equal(result.values.SYS_TANG_CUONG_NGAY_THUONG, 1);
  assert.equal(result.values.SYS_NGHI_TRUC_NGAY_THUONG, 0.5);
  assert.equal(result.values.SYS_TRUC_TICH_LUY, 1, 'TC không được tính vào số Trực để nghỉ bù');
  assert.equal(result.values.SYS_NGHI_BU_TICH_LUY, 0.5);
  assert.equal(result.values.SYS_CON_DUOC_BU, 0.5);
  assert.deepEqual(result.warnings, []);
});

test('nghỉ bù có thể đặt bất kỳ ngày nào, kể cả trước ca Trực, miễn tổng nghỉ ≤ tổng Trực', () => {
  const result = calculateAttendanceMetrics({
    monthDates: ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'],
    holidayDates: [],
    codes,
    entries: [
      { date: '2026-08-03', code: 'N' }, // trước ca Trực
      { date: '2026-08-02', code: 'T' }, // Chủ nhật
      { date: '2026-08-06', code: 'T' }, // Thứ Năm
      { date: '2026-08-07', code: 'N2' },
    ],
  });
  // Trừ dần ca Trực cũ nhất: N lấy T Chủ nhật, N2 lấy nửa T Thứ Năm.
  assert.equal(result.values.SYS_NGHI_TRUC_NGAY_NGHI, 1);
  assert.equal(result.values.SYS_NGHI_TRUC_NGAY_THUONG, 0.5);
  assert.equal(result.values.SYS_NGHI_BU_CHUA_GAN, 0);
  assert.equal(result.values.SYS_CON_DUOC_BU, 0.5);
  assert.deepEqual(result.warnings, []);
});

test('ca Trực rất xa trong quá khứ (khoa khác/tháng khác) vẫn được cộng vào số dư nhưng không vào số liệu tháng', () => {
  const result = calculateAttendanceMetrics({
    monthDates: ['2026-08-20'],
    holidayDates: ['2025-09-02'],
    codes,
    entries: [
      { date: '2025-09-02', code: 'T', current: false }, // ngày lễ năm trước, ở khoa khác
      { date: '2026-08-20', code: 'N' },
      { date: '2026-08-20', code: 'T', current: false }, // ngày khác khoa không tính vào tháng của khoa này
    ],
  });
  assert.equal(result.values.SYS_TRUC_NGAY_THUONG, 0);
  assert.equal(result.values.SYS_NGHI_TRUC_NGAY_LE, 1);
  assert.equal(result.values.SYS_TRUC_TICH_LUY, 2);
  assert.equal(result.values.SYS_CON_DUOC_BU, 1);
});

test('Tăng cường không phát sinh nghỉ bù; nghỉ vượt số Trực được cảnh báo và đưa vào cột vượt', () => {
  const result = calculateAttendanceMetrics({
    monthDates: ['2026-08-03', '2026-08-04', '2026-08-05'],
    holidayDates: [],
    codes,
    entries: [
      { date: '2026-08-03', code: 'TC' },
      { date: '2026-08-04', code: 'T' },
      { date: '2026-08-05', code: 'N' },
      { date: '2026-08-05', code: 'N2' },
    ],
  });
  assert.equal(result.values.SYS_NGHI_TANG_CUONG_NGAY_THUONG, 0);
  assert.equal(result.values.SYS_NGHI_TRUC_NGAY_THUONG, 1);
  assert.equal(result.values.SYS_NGHI_BU_CHUA_GAN, 0.5);
  assert.equal(result.values.SYS_CON_DUOC_BU, -0.5);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0] ?? '', /vượt tổng ca Trực tích lũy/);
});

test('ngày làm bù cuối tuần được tính như ngày thường nhưng ngày lễ vẫn ưu tiên để không sai phân loại', () => {
  const result = calculateAttendanceMetrics({
    monthDates: ['2026-08-08', '2026-08-09'],
    holidayDates: ['2026-08-09'],
    workdayDates: ['2026-08-08', '2026-08-09'],
    codes,
    entries: [{ date: '2026-08-08', code: 'T' }, { date: '2026-08-09', code: 'TC' }],
  });
  assert.equal(result.values.SYS_NGAY_CONG, 1, 'Thứ Bảy làm bù tăng một Ngày công');
  assert.equal(result.values.SYS_TRUC_NGAY_THUONG, 1, 'Trực ngày làm bù là trực ngày thường');
  assert.equal(result.values.SYS_TANG_CUONG_NGAY_LE, 1, 'Ngày lễ trùng ngày làm bù vẫn ưu tiên là ngày lễ');
});
