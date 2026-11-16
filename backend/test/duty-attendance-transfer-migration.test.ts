import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = (file: string) => readFileSync(resolve(__dirname, '..', 'drizzle', file), 'utf8');

test('migration lịch sử chuyển khoa chỉ thêm mốc nền và không sửa dữ liệu chấm công cũ', async (t) => {
  const pg = await PGlite.create(); t.after(() => pg.close());
  await pg.exec(migration('0000_init_khoi_tao.sql'));
  await pg.exec(migration('0025_bang_cham_cong_truc.sql'));
  await pg.exec(`
    INSERT INTO departments (id, code, name, active) VALUES (10, 'A', 'Khoa A', true), (11, 'B', 'Khoa B', true);
    INSERT INTO users (id, username, password_hash, full_name, department_id, active) VALUES (1, 'nv001', 'hash', 'Nhân viên', 11, true);
    INSERT INTO duty_attendance_entries (department_id, user_id, work_date, code_id, note) VALUES (10, 1, '2026-10-01', (SELECT id FROM duty_attendance_codes WHERE code = 'T'), 'dữ liệu cũ');
  `);
  const transfer = migration('0035_lich_su_chuyen_khoa_cham_cong.sql');
  await pg.exec(transfer); await pg.exec(transfer);
  await pg.exec(migration('0039_ghi_chu_cham_cong_theo_ngay.sql'));
  const multiCodeMigration = migration('0040_nhieu_ky_hieu_cham_cong_trong_ngay.sql');
  await pg.exec(multiCodeMigration); await pg.exec(multiCodeMigration);
  const assignments = await pg.query<{ user_id: number; department_id: number; effective_from: string }>('SELECT user_id, department_id, effective_from::text FROM duty_attendance_department_assignments ORDER BY user_id, effective_from');
  assert.deepEqual(assignments.rows, [{ user_id: 1, department_id: 11, effective_from: '1900-01-01' }]);
  const entry = await pg.query<{ department_id: number; note: string }>('SELECT department_id, note FROM duty_attendance_entries WHERE user_id = 1 AND work_date = \'2026-10-01\'');
  assert.deepEqual(entry.rows, [{ department_id: 10, note: 'dữ liệu cũ' }], 'migration không đổi khoa/nội dung dòng chấm công lịch sử');
  const dailyNote = await pg.query<{ department_id: number; note: string }>('SELECT department_id, note FROM duty_attendance_daily_notes WHERE user_id = 1 AND work_date = \'2026-10-01\'');
  assert.deepEqual(dailyNote.rows, [{ department_id: 10, note: 'dữ liệu cũ' }], 'migration sao chép ghi chú cũ sang dữ liệu ghi chú theo ngày, không làm mất lịch sử');
  const copiedCodes = await pg.query<{ code: string }>(`SELECT c.code FROM duty_attendance_entry_codes ec JOIN duty_attendance_codes c ON c.id = ec.code_id WHERE ec.user_id = 1 AND ec.work_date = '2026-10-01' ORDER BY c.code`);
  assert.deepEqual(copiedCodes.rows, [{ code: 'T' }], '0040 sao chép một lần ký hiệu lịch sử sang bảng nhiều ký hiệu');
  await pg.exec(`INSERT INTO duty_attendance_entry_codes (department_id, user_id, work_date, code_id) VALUES (10, 1, '2026-10-01', (SELECT id FROM duty_attendance_codes WHERE code = 'P'))`);
  const multipleCodes = await pg.query<{ code: string }>(`SELECT c.code FROM duty_attendance_entry_codes ec JOIN duty_attendance_codes c ON c.id = ec.code_id WHERE ec.user_id = 1 AND ec.work_date = '2026-10-01' ORDER BY c.code`);
  assert.deepEqual(multipleCodes.rows, [{ code: 'P' }, { code: 'T' }], 'bảng mới cho phép hai ký hiệu cùng nhân viên/ngày');
  await assert.rejects(pg.exec(`INSERT INTO duty_attendance_entry_codes (department_id, user_id, work_date, code_id) VALUES (10, 1, '2026-10-01', (SELECT id FROM duty_attendance_codes WHERE code = 'P'))`), /unique|duplicate/i, 'mỗi ký hiệu chỉ xuất hiện một lần trong ngày');
  await assert.rejects(pg.exec(`INSERT INTO duty_attendance_entries (department_id, user_id, work_date, code_id) VALUES (11, 1, '2026-10-01', (SELECT id FROM duty_attendance_codes WHERE code = 'T'))`), /unique|duplicate/i, 'giữ nguyên dòng tương thích một nhân viên-một ngày, không nhân đôi dữ liệu qua khoa');
});
