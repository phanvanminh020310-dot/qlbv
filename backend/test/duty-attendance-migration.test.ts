import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('migration bảng chấm công tạo danh mục ký hiệu cấu hình được và không nhân bản dữ liệu', async (t) => {
  const pg = await PGlite.create();
  t.after(() => pg.close());
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0000_init_khoi_tao.sql'), 'utf8'));
  const migration = readFileSync(resolve(__dirname, '..', 'drizzle', '0025_bang_cham_cong_truc.sql'), 'utf8');
  await pg.exec(migration);
  await pg.exec(migration);
  const codes = await pg.query<{ code: string; counts_as_duty: boolean; show_summary: boolean }>(`
    SELECT code, counts_as_duty, show_summary FROM duty_attendance_codes ORDER BY sort_order
  `);
  assert.deepEqual(codes.rows, [
    { code: 'T', counts_as_duty: true, show_summary: false },
    { code: 'P', counts_as_duty: false, show_summary: true },
    { code: 'CT', counts_as_duty: false, show_summary: true },
    { code: 'H', counts_as_duty: false, show_summary: true },
    { code: 'O', counts_as_duty: false, show_summary: true },
    { code: 'TC', counts_as_duty: false, show_summary: false },
    { code: 'K', counts_as_duty: false, show_summary: true },
  ]);
  await assert.rejects(
    pg.exec(`INSERT INTO duty_attendance_holidays (holiday_date, name) VALUES ('2026-01-01', 'Tết'); INSERT INTO duty_attendance_holidays (holiday_date, name) VALUES ('2026-01-01', 'Trùng')`),
  );
});
