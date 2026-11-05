import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { AccessContext } from '../src/common/types/access-context';
import { DbService } from '../src/db/db.service';
import * as schema from '../src/db/schema';
import { DutyAttendanceService } from '../src/modules/duty-attendance/duty-attendance.service';

const user = (departmentId: number | null, isSuperAdmin = false): AccessContext => ({
  id: 99, username: 'test', fullName: 'Test', title: '', departmentId, departmentName: '',
  roles: isSuperAdmin ? ['SUPER_ADMIN'] : ['NHAP_CHAM_CONG_TRUC_KHOA'],
  permissions: ['duty-attendance.view', 'duty-attendance.update'], dataScope: isSuperAdmin ? 'ALL' : 'DEPT',
  departmentIds: departmentId ? [departmentId] : [], isSuperAdmin, sessionId: 'test',
});

test('chấm công khóa cứng khoa của Hành chính trưởng/Chủ nhiệm khoa; SUPER_ADMIN phải chọn khoa rõ ràng', async (t) => {
  const pg = await PGlite.create();
  t.after(() => pg.close());
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0000_init_khoi_tao.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0025_bang_cham_cong_truc.sql'), 'utf8'));
  await pg.exec(`INSERT INTO departments (id, code, name, active) VALUES (10, 'A', 'Khoa A', true), (11, 'B', 'Khoa B', true)`);
  const service = new DutyAttendanceService({ db: drizzle(pg, { schema }) } as unknown as DbService);

  const own = user(10);
  const ownSheet = await service.month(own, { month: '2026-10', departmentId: 10 });
  assert.equal(ownSheet.department.id, 10);
  await assert.rejects(service.month(own, { month: '2026-10', departmentId: 11 }), /chỉ được xem và chấm công/);

  const admin = user(null, true);
  const options = await service.availableDepartments(admin);
  assert.equal(options.canSelect, true);
  assert.deepEqual(options.items.map((x) => x.id), [10, 11]);
  await assert.rejects(service.month(admin, { month: '2026-10' }), /Vui lòng chọn khoa/);
  const adminSheet = await service.month(admin, { month: '2026-10', departmentId: 11 });
  assert.equal(adminSheet.department.id, 11);
});
