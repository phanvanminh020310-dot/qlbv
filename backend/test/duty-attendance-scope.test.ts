import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { AccessContext } from '../src/common/types/access-context';
import { DbService } from '../src/db/db.service';
import * as schema from '../src/db/schema';
import { ROLES } from '../src/db/seed-data';
import { DutyAttendanceService } from '../src/modules/duty-attendance/duty-attendance.service';
import { bangkokToday } from '../src/modules/duty/duty-rules';

const user = (
  departmentId: number | null,
  options: { isSuperAdmin?: boolean; dataScope?: 'DEPT' | 'ALL'; role?: string } = {},
): AccessContext => {
  const isSuperAdmin = options.isSuperAdmin ?? false;
  const dataScope = options.dataScope ?? (isSuperAdmin ? 'ALL' : 'DEPT');
  return {
    id: 99, username: 'test', fullName: 'Test', title: '', departmentId, departmentName: '',
    roles: isSuperAdmin ? ['SUPER_ADMIN'] : [options.role ?? 'NHAP_CHAM_CONG_TRUC_KHOA'],
    permissions: ['duty-attendance.view', 'duty-attendance.update'], dataScope,
    departmentIds: departmentId ? [departmentId] : [], isSuperAdmin, sessionId: 'test',
  };
};

test('vai trò Điều phối chấm công KHTH có phạm vi toàn viện nhưng chỉ các quyền chấm công cần thiết', () => {
  const coordinator = ROLES.find((role) => role.code === 'DIEU_PHOI_CHAM_CONG');
  assert.ok(coordinator, 'phải có vai trò hệ thống Điều phối chấm công (KHTH)');
  assert.equal(coordinator.dataScope, 'ALL');
  assert.deepEqual(coordinator.permissions, ['duty-attendance.view', 'duty-attendance.update', 'duty-attendance.export']);
});

test('chấm công khóa cứng vai trò phạm vi khoa; SUPER_ADMIN và Điều phối chấm công toàn viện phải chọn khoa rõ ràng', async (t) => {
  const pg = await PGlite.create();
  t.after(() => pg.close());
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0000_init_khoi_tao.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0025_bang_cham_cong_truc.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0029_cau_hinh_bo_cuc_bang_cham_cong.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0031_cong_thuc_nghiep_vu_cham_cong.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0032_lich_nghi_le_nha_nuoc_theo_nam.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0033_ngay_lam_bu_va_dieu_chinh_lich_le.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0034_ma_nhan_vien_lien_thong.sql'), 'utf8'));
  await pg.exec(`
    INSERT INTO departments (id, code, name, active) VALUES (10, 'A', 'Khoa A', true), (11, 'B', 'Khoa B', true);
    INSERT INTO users (id, username, password_hash, full_name, department_id, active) VALUES
      (99, 'attendance_coordinator', 'hash', 'Điều phối chấm công', 10, true),
      (101, 'staff_b', 'hash', 'Nhân viên khoa B', 11, true);
  `);
  const db = drizzle(pg, { schema });
  const service = new DutyAttendanceService({ db, transaction: db.transaction.bind(db) } as unknown as DbService);

  const own = user(10);
  const ownSheet = await service.month(own, { month: '2026-10', departmentId: 10 });
  assert.equal(ownSheet.department.id, 10);
  await assert.rejects(service.month(own, { month: '2026-10', departmentId: 11 }), /chỉ được xem và chấm công/);

  const admin = user(null, { isSuperAdmin: true });
  const options = await service.availableDepartments(admin);
  assert.equal(options.canSelect, true);
  assert.deepEqual(options.items.map((x) => x.id), [10, 11]);
  await assert.rejects(service.month(admin, { month: '2026-10' }), /Vui lòng chọn khoa/);
  const adminSheet = await service.month(admin, { month: '2026-10', departmentId: 11 });
  assert.equal(adminSheet.department.id, 11);

  // KHTH is not a super-admin. Its ALL data scope, paired with attendance
  // permissions, must nevertheless expose the explicit all-department picker.
  const coordinator = user(10, { dataScope: 'ALL', role: 'DIEU_PHOI_CHAM_CONG' });
  const coordinatorOptions = await service.availableDepartments(coordinator);
  assert.equal(coordinatorOptions.canSelect, true);
  assert.deepEqual(coordinatorOptions.items.map((x) => x.id), [10, 11]);
  await assert.rejects(service.month(coordinator, { month: '2026-10' }), /Vui lòng chọn khoa/);
  const coordinatorSheet = await service.month(coordinator, { month: '2026-10', departmentId: 11 });
  assert.equal(coordinatorSheet.department.id, 11, 'KHTH can select and view a department other than its own');

  const today = bangkokToday();
  await service.save(coordinator, { departmentId: 11, entries: [{ userId: 101, workDate: today, code: 'T' }] });
  const updatedSheet = await service.month(coordinator, { month: today.slice(0, 7), departmentId: 11 });
  assert.equal(updatedSheet.entries[`101:${today}`]?.code, 'T', 'KHTH can update an allowed all-hospital department without changing staff ownership');
});


test('ngày cuối tuần được đánh dấu riêng; ngày đã qua khóa ở server và ký hiệu chỉ xóa khi chưa dùng', async (t) => {
  const pg = await PGlite.create();
  t.after(() => pg.close());
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0000_init_khoi_tao.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0025_bang_cham_cong_truc.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0029_cau_hinh_bo_cuc_bang_cham_cong.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0031_cong_thuc_nghiep_vu_cham_cong.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0032_lich_nghi_le_nha_nuoc_theo_nam.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0033_ngay_lam_bu_va_dieu_chinh_lich_le.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0034_ma_nhan_vien_lien_thong.sql'), 'utf8'));
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
