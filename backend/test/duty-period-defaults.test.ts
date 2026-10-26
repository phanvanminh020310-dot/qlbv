/** Regression: biểu mẫu tạo kỳ lịch phải mặc định mốc chốt chiều Chủ nhật. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultLockAtLocal } from '../../frontend/src/lib/duty-period-defaults';

test('giao diện tạo kỳ tuần mặc định chốt 17:00 Chủ nhật ngay trước tuần trực', () => {
  assert.equal(defaultLockAtLocal('2026-10-19'), '2026-10-18T17:00');
  assert.equal(defaultLockAtLocal('2027-01-04'), '2027-01-03T17:00');
});

test('kỳ tuỳ chỉnh bắt đầu Chủ nhật vẫn dùng đúng chiều Chủ nhật đó', () => {
  assert.equal(defaultLockAtLocal('2026-10-18'), '2026-10-18T17:00');
});
