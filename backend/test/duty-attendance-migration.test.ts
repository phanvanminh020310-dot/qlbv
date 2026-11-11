import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migrationPath = (...parts: string[]) => resolve(__dirname, '..', 'drizzle', ...parts);

test('migration bảng chấm công tạo danh mục ký hiệu cấu hình được và không nhân bản dữ liệu', async (t) => {
  const pg = await PGlite.create();
  t.after(() => pg.close());
  await pg.exec(readFileSync(migrationPath('0000_init_khoi_tao.sql'), 'utf8'));
  const migration = readFileSync(migrationPath('0025_bang_cham_cong_truc.sql'), 'utf8');
  await pg.exec(migration);
  await pg.exec(migration);
  const layoutMigration = readFileSync(migrationPath('0029_cau_hinh_bo_cuc_bang_cham_cong.sql'), 'utf8');
  await pg.exec(layoutMigration);
  await pg.exec(layoutMigration);
  const codeGroupMigration = readFileSync(migrationPath('0030_nhom_ky_hieu_cham_cong.sql'), 'utf8');
  await pg.exec(codeGroupMigration);
  await pg.exec(codeGroupMigration);
  const calculationMigration = readFileSync(migrationPath('0031_cong_thuc_nghiep_vu_cham_cong.sql'), 'utf8');
  await pg.exec(calculationMigration);
  await pg.exec(calculationMigration);
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
  const sections = await pg.query<{ code: string; kind: string }>('SELECT code, kind FROM duty_attendance_sections ORDER BY sort_order');
  assert.deepEqual(sections.rows, [
    { code: 'ADMIN', kind: 'ADMIN' }, { code: 'DAYS', kind: 'DAYS' }, { code: 'SYMBOLS', kind: 'SYMBOLS' }, { code: 'REPORT', kind: 'REPORT' },
  ]);
  const groups = await pg.query<{ code: string; name: string }>("SELECT code, name FROM duty_attendance_code_groups WHERE code IN ('DUTY', 'OTHER') ORDER BY code");
  assert.deepEqual(groups.rows, [{ code: 'DUTY', name: 'Trực' }, { code: 'OTHER', name: 'Khác' }]);
  const counted = await pg.query<{ count_value: string; calculation_role: string; deducts_workday: boolean }>("SELECT count_value::text, calculation_role, deducts_workday FROM duty_attendance_codes WHERE code = 'T'");
  assert.deepEqual(counted.rows[0], { count_value: '1.00', calculation_role: 'DUTY', deducts_workday: false }, 'mã T cũ được gán nghĩa Trực mà không sửa dữ liệu ngày');
  const leave = await pg.query<{ calculation_role: string; deducts_workday: boolean }>("SELECT calculation_role, deducts_workday FROM duty_attendance_codes WHERE code = 'P'");
  assert.deepEqual(leave.rows[0], { calculation_role: 'NONE', deducts_workday: true }, 'phép cũ được cấu hình trừ Ngày công nhưng giữ nguyên dữ liệu lịch sử');
  const workdayColumn = await pg.query<{ key: string; formula: string }>("SELECT key, formula FROM duty_attendance_columns WHERE key = 'NGAY_CONG'");
  assert.deepEqual(workdayColumn.rows, [{ key: 'NGAY_CONG', formula: '[SYS_NGAY_CONG]' }], 'cột Ngày công dùng biến nghiệp vụ thay vì công thức cộng trừ thủ công');
  const defaultReports = await pg.query<{ count: string }>("SELECT count(*)::text AS count FROM duty_attendance_columns WHERE key LIKE '%NGAY_%' OR key = 'NGAY_CONG' OR key = 'NGHI_BU_CHUA_GAN'");
  assert.equal(defaultReports.rows[0]?.count, '14', 'báo cáo mặc định có đủ cột phân loại trực, nghỉ bù và tăng cường');
  await assert.rejects(
    pg.exec(`INSERT INTO duty_attendance_holidays (holiday_date, name) VALUES ('2026-01-01', 'Tết'); INSERT INTO duty_attendance_holidays (holiday_date, name) VALUES ('2026-01-01', 'Trùng')`),
  );
});

test('migration công thức nghiệp vụ không ghi đè cột Ngày công/công thức lịch sử đã có', async (t) => {
  const pg = await PGlite.create();
  t.after(() => pg.close());
  await pg.exec(readFileSync(migrationPath('0000_init_khoi_tao.sql'), 'utf8'));
  for (const file of ['0025_bang_cham_cong_truc.sql', '0029_cau_hinh_bo_cuc_bang_cham_cong.sql', '0030_nhom_ky_hieu_cham_cong.sql']) {
    await pg.exec(readFileSync(migrationPath(file), 'utf8'));
  }
  await pg.exec(`
    INSERT INTO duty_attendance_columns (section_id, key, name, column_type, data_type, formula, placeholder, sort_order, active)
    SELECT id, 'NGAY_CONG_CU', 'Ngày công', 'FORMULA', 'NUMBER', '[T] + [P]', '', 99, true
    FROM duty_attendance_sections WHERE code = 'REPORT';
  `);
  await pg.exec(readFileSync(migrationPath('0031_cong_thuc_nghiep_vu_cham_cong.sql'), 'utf8'));
  const historic = await pg.query<{ key: string; name: string; formula: string }>("SELECT key, name, formula FROM duty_attendance_columns WHERE name = 'Ngày công'");
  assert.deepEqual(historic.rows, [{ key: 'NGAY_CONG_CU', name: 'Ngày công', formula: '[T] + [P]' }]);
  const systemDuplicate = await pg.query<{ count: string }>("SELECT count(*)::text AS count FROM duty_attendance_columns WHERE key = 'NGAY_CONG'");
  assert.equal(systemDuplicate.rows[0]?.count, '0', 'không tự thay hoặc nhân đôi công thức lịch sử cùng tên');
});
