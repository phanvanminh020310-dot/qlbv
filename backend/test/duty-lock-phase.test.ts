/** Regression: mốc chốt được áp dụng tức thời cho kỳ đã công bố, không cần cron. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DutyCoreService } from '../src/modules/duty/duty-core.service';

const core = new DutyCoreService({} as never, {} as never, {} as never);
const lockAt = new Date('2026-10-18T17:00:00+07:00');

test('kỳ đã công bố tự chốt đúng tại mốc; trước đó vẫn mở', () => {
  assert.deepEqual(
    core.phaseOf({ status: 'CONG_BO', lockAt }, lockAt.getTime() - 1),
    { phase: 'MO', locked: false },
  );
  assert.deepEqual(
    core.phaseOf({ status: 'CONG_BO', lockAt }, lockAt.getTime()),
    { phase: 'CHOT', locked: true },
  );
});

test('bản nháp vẫn là nháp sau mốc chốt cho đến khi được công bố', () => {
  assert.deepEqual(
    core.phaseOf({ status: 'NHAP', lockAt }, lockAt.getTime() + 1),
    { phase: 'NHAP', locked: false },
  );
});
