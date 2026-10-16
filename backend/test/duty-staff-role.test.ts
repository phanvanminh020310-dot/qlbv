import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { DUTY_STAFF_ROLE_CODE, isDoctorTitle } from '../src/modules/users/duty-staff-role';

test('nhận diện chức danh Bác sĩ/Bác Sỹ không phụ thuộc dấu, hoa thường và khoảng trắng', () => {
  for (const title of ['Bác sĩ', 'Bác Sỹ', '  BÁC SĨ  ', 'bac sy']) {
    assert.equal(isDoctorTitle(title), true, `${title} phải được nhận diện là bác sĩ`);
  }
  for (const title of ['', 'Bác sĩ CKI', 'Điều dưỡng', 'Dược sĩ']) {
    assert.equal(isDoctorTitle(title), false, `${title || 'rỗng'} không được gán nhầm vai trò trực`);
  }
});

test('migration bổ sung đúng một vai trò Nhân viên trực khám cho bác sĩ hiện hữu', async (t) => {
  const pg = await PGlite.create();
  t.after(() => pg.close());
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0000_init_khoi_tao.sql'), 'utf8'));
  await pg.exec(`
    INSERT INTO roles (code, name) VALUES
      ('NHAN_VIEN_TRUC', 'Nhân viên trực khám'),
      ('NHAP_LIEU', 'Nhập liệu');
    INSERT INTO users (id, username, password_hash, full_name, title, active, deleted_at) VALUES
      (1, 'doctor_si', 'fixture', 'Bác sĩ Một', 'Bác sĩ', true, NULL),
      (2, 'doctor_sy', 'fixture', 'Bác Sỹ Hai', 'Bác Sỹ', true, NULL),
      (3, 'nurse', 'fixture', 'Điều dưỡng Ba', 'Điều dưỡng', true, NULL),
      (4, 'former_doctor', 'fixture', 'Bác sĩ Cũ', 'Bác sĩ', false, now());
    INSERT INTO user_roles (user_id, role_id)
    SELECT 1, id FROM roles WHERE code = 'NHAN_VIEN_TRUC';
  `);

  const migration = readFileSync(resolve(__dirname, '..', 'drizzle', '0023_gan_vai_tro_truc_cho_bac_si.sql'), 'utf8');
  await pg.exec(migration);
  await pg.exec(migration);

  const assigned = await pg.query<{ username: string; count: number }>(`
    SELECT u.username, count(*)::int AS count
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id AND r.code = '${DUTY_STAFF_ROLE_CODE}'
    GROUP BY u.username
    ORDER BY u.username
  `);
  assert.deepEqual(assigned.rows, [
    { username: 'doctor_si', count: 1 },
    { username: 'doctor_sy', count: 1 },
  ]);
});
