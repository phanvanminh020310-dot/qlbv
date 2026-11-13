import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { AccessContext } from '../src/common/types/access-context';
import { DbService } from '../src/db/db.service';
import * as schema from '../src/db/schema';
import { UsersService } from '../src/modules/users/users.service';

const migration = (file: string) => readFileSync(resolve(__dirname, '..', 'drizzle', file), 'utf8');
const actor: AccessContext = { id: 99, username: 'manager', fullName: 'Quản lý', title: '', departmentId: 10, departmentName: 'Khoa A', roles: ['SUPER_ADMIN'], permissions: [], dataScope: 'ALL', departmentIds: [], isSuperAdmin: true, sessionId: 'test' };

test('đổi khoa người dùng ghi thêm mốc hiệu lực, không ghi đè mốc cùng ngày khác khoa', async (t) => {
  const pg = await PGlite.create(); t.after(() => pg.close());
  for (const file of ['0000_init_khoi_tao.sql', '0005_them_danh_muc_chuc_danh.sql', '0013_telegram_link.sql', '0034_ma_nhan_vien_lien_thong.sql', '0035_lich_su_chuyen_khoa_cham_cong.sql', '0036_tach_chuc_danh_chuyen_mon_va_chuc_vu.sql']) await pg.exec(migration(file));
  await pg.exec(`
    INSERT INTO departments (id, code, name, active) VALUES (10, 'A', 'Khoa A', true), (11, 'B', 'Khoa B', true), (12, 'C', 'Khoa C', true);
    INSERT INTO users (id, username, password_hash, full_name, department_id, active) VALUES (99, 'manager', 'hash', 'Quản lý', 10, true);
  `);
  const db = drizzle(pg, { schema });
  const service = new UsersService(
    { db, transaction: db.transaction.bind(db) } as unknown as DbService,
    { hashPassword: async () => 'hash', invalidateUserCache: async () => undefined, revokeAllSessions: async () => undefined } as never,
    {} as never,
    { passwordMinLength: async () => 1 } as never,
  );
  const created = await service.create({ manv: 'NV01', username: 'nv001', fullName: 'Nhân viên', departmentId: 10, departmentEffectiveFrom: '2026-10-01' }, actor);
  await service.update(created.id, { departmentId: 11, departmentEffectiveFrom: '2026-10-11' }, actor);
  await service.update(created.id, { departmentId: 12, departmentEffectiveFrom: '2026-10-21' }, actor);
  const history = await pg.query<{ department_id: number; effective_from: string }>(`SELECT department_id, effective_from::text FROM duty_attendance_department_assignments WHERE user_id = ${created.id} ORDER BY effective_from`);
  assert.deepEqual(history.rows, [
    { department_id: 10, effective_from: '2026-10-01' },
    { department_id: 11, effective_from: '2026-10-11' },
    { department_id: 12, effective_from: '2026-10-21' },
  ]);
  await assert.rejects(service.update(created.id, { departmentId: 11, departmentEffectiveFrom: '2026-10-21' }, actor), /không thể ghi đè lịch sử/);
  const user = await pg.query<{ department_id: number }>(`SELECT department_id FROM users WHERE id = ${created.id}`);
  assert.equal(user.rows[0]?.department_id, 12, 'xung đột mốc lịch sử phải rollback cả cập nhật users.department_id');
});
