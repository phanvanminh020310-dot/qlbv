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
import { bangkokToday } from '../src/modules/duty/duty-rules';

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
  const db = drizzle(pg, { schema });
  const service = new DutyAttendanceService({ db, transaction: db.transaction.bind(db) } as unknown as DbService);

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


test('ngày cuối tuần được đánh dấu riêng; ngày đã qua khóa ở server và ký hiệu chỉ xóa khi chưa dùng', async (t) => {
  const pg = await PGlite.create();
  t.after(() => pg.close());
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0000_init_khoi_tao.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0025_bang_cham_cong_truc.sql'), 'utf8'));
  await pg.exec(`
    INSERT INTO departments (id, code, name, active) VALUES (10, 'A', 'Khoa A', true);
    INSERT INTO users (id, username, password_hash, full_name, department_id, active) VALUES
      (1, 'staff', 'hash', 'Nhân viên A', 10, true),
      (99, 'manager', 'hash', 'Quản lý A', 10, true);
  `);
  const db = drizzle(pg, { schema });
  const service = new DutyAttendanceService({ db, transaction: db.transaction.bind(db) } as unknown as DbService);
  const own = user(10);

  const june = await service.month(own, { month: '2026-06', departmentId: 10 });
  assert.equal(june.dates.find((d) => d.date === '2026-06-06')?.isWeekend, true, 'Thứ Bảy phải được đánh dấu');
  assert.equal(june.dates.find((d) => d.date === '2026-06-07')?.isWeekend, true, 'Chủ nhật phải được đánh dấu');
  assert.equal(june.dates.find((d) => d.date === '2026-06-08')?.isWeekend, false, 'Thứ Hai không phải cuối tuần');

  await assert.rejects(
    service.save(own, { departmentId: 10, entries: [{ userId: 1, workDate: '2000-01-01', code: 'T' }] }),
    /Không được sửa chấm công ngày/,
  );
  await service.save(own, { departmentId: 10, entries: [{ userId: 1, workDate: bangkokToday(), code: 'T' }] });
  const activeCodes = await service.codes();
  const duty = activeCodes.find((code) => code.code === 'T');
  const unused = activeCodes.find((code) => code.code === 'K');
  assert.ok(duty && unused);
  await assert.rejects(service.deleteCode(duty.id), /đã được dùng/);
  assert.deepEqual(await service.deleteCode(unused.id), { deleted: true });
});
