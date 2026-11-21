import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as ExcelJS from 'exceljs';
import { PERMISSIONS_KEY } from '../src/common/decorators';
import type { AccessContext } from '../src/common/types/access-context';
import { DbService } from '../src/db/db.service';
import * as schema from '../src/db/schema';
import { StaffLearningController } from '../src/modules/staff-learning/staff-learning.controller';
import { StaffLearningService } from '../src/modules/staff-learning/staff-learning.service';

const migration = (file: string) => readFileSync(resolve(__dirname, '..', 'drizzle', file), 'utf8');
const VIEW = 'staff-learning.view';
const REGISTER = 'staff-learning.register';
const EXPORT = 'staff-learning.export';

const context = (
  id: number,
  departmentId: number | null,
  dataScope: 'OWN' | 'DEPT' | 'ALL' = 'DEPT',
  permissions: string[] = [VIEW, REGISTER, EXPORT],
  roles: string[] = ['DANG_KY_LICH_HOC_CAN_BO_NHAN_VIEN'],
): AccessContext => ({
  id, username: `u${id}`, fullName: `User ${id}`, title: '', departmentId, departmentName: '', roles, permissions, dataScope,
  departmentIds: departmentId ? [departmentId] : [], isSuperAdmin: false, sessionId: `test-${id}`,
});

async function setup() {
  const pg = await PGlite.create();
  await pg.exec(migration('0000_init_khoi_tao.sql'));
  await pg.exec(migration('0034_ma_nhan_vien_lien_thong.sql'));
  await pg.exec(migration('0041_lich_hoc_can_bo_nhan_vien.sql'));
  await pg.exec(migration('0042_vai_tro_dang_ky_lich_hoc_can_bo.sql'));
  await pg.exec(migration('0043_ghi_chu_lich_hoc_can_bo_nhan_vien.sql'));
  await pg.exec(`
    INSERT INTO departments (id, code, name, short_name, sort_order, active) VALUES
      (10, 'A1', 'Khoa A1', 'A1', 10, true),
      (11, 'B1', 'Khoa B1', 'B1', 20, true);
    INSERT INTO users (id, manv, username, password_hash, full_name, title, department_id, active) VALUES
      (1, 'NV01', 'nv001', 'hash', 'Nguyễn An', 'Bác sĩ', 10, true),
      (2, 'NV02', 'nv002', 'hash', 'Trần Bình', 'Điều dưỡng', 10, true),
      (3, 'NV03', 'nv003', 'hash', 'Lê Chi', 'Kỹ thuật viên', 11, true),
      (99, 'AD99', 'admin', 'hash', 'Điều phối', 'Bác sĩ', 10, true);
  `);
  const db = drizzle(pg, { schema });
  return { pg, service: new StaffLearningService({ db, transaction: db.transaction.bind(db) } as unknown as DbService) };
}

test('API lịch học yêu cầu đúng các quyền staff-learning độc lập với lịch trực', () => {
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, StaffLearningController.prototype.week), [VIEW]);
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, StaffLearningController.prototype.register), [REGISTER]);
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, StaffLearningController.prototype.updateNote), [REGISTER]);
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, StaffLearningController.prototype.remove), [REGISTER]);
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, StaffLearningController.prototype.exportExcel), [EXPORT]);
});

test('vai trò đăng ký lịch học chỉ nhập nhân viên thuộc khoa được gán; điều phối chỉ xem toàn viện', async (t) => {
  const { pg, service } = await setup(); t.after(() => pg.close());
  const registrarA = context(1, 10);
  const registrarB = context(3, 11);
  const viewerA = context(2, 10, 'DEPT', [VIEW], []);
  const coordinator = context(99, 10, 'ALL', [VIEW, EXPORT], ['DIEU_PHOI_TRUC']);

  const initial = await service.week(registrarA, { weekStart: '2026-11-16' });
  assert.deepEqual(initial.days.map((day) => day.date), ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'], 'bảng tuần phải hiển thị đến Thứ 7 và Chủ nhật');
  assert.deepEqual(initial.departments.map((department) => department.id), [10]);
  assert.deepEqual(initial.staff.map((person) => person.userId), [1, 2, 99]);
  assert.equal(initial.viewer.canRegister, true);
  assert.equal(initial.viewer.seesAllDepartments, false);

  await assert.rejects(service.week(context(2, 10, 'DEPT', [], []), { weekStart: '2026-11-16' }), /staff-learning\.view/);
  await assert.rejects(service.register(viewerA, { userId: 2, studyDate: '2026-11-16' }), /staff-learning\.register/);
  await assert.rejects(service.register(registrarA, { userId: 3, studyDate: '2026-11-16' }), /không thuộc khoa\/phòng/i);

  assert.deepEqual(await service.register(registrarA, { userId: 2, studyDate: '2026-11-16' }), { registered: true, alreadyRegistered: false });
  assert.deepEqual(await service.register(registrarA, { userId: 2, studyDate: '2026-11-16' }), { registered: true, alreadyRegistered: true }, 'mỗi nhân viên/ngày duy nhất');
  await service.register(registrarA, { userId: 1, studyDate: '2026-11-17' });
  await service.register(registrarA, { userId: 2, studyDate: '2026-11-21', note: 'Chỉ học buổi sáng' }); // Thứ 7
  await service.register(registrarA, { userId: 1, studyDate: '2026-11-22', note: 'Học buổi chiều' }); // Chủ nhật
  await service.register(registrarB, { userId: 3, studyDate: '2026-11-16' });

  const scoped = await service.week(registrarA, { weekStart: '2026-11-16' });
  assert.deepEqual(scoped.entries['10:2026-11-16']?.map((person) => person.fullName), ['Trần Bình']);
  assert.deepEqual(scoped.entries['10:2026-11-21']?.map((person) => person.fullName), ['Trần Bình'], 'Thứ 7 được đăng ký và trả về đúng tuần');
  assert.equal(scoped.entries['10:2026-11-21']?.[0]?.note, 'Chỉ học buổi sáng', 'ghi chú được trả về cùng lượt học');
  assert.deepEqual(scoped.entries['10:2026-11-22']?.map((person) => person.fullName), ['Nguyễn An'], 'Chủ nhật được đăng ký và trả về đúng tuần');
  assert.equal(scoped.entries['10:2026-11-22']?.[0]?.note, 'Học buổi chiều');
  assert.equal(scoped.entries['11:2026-11-16'], undefined, 'vai trò khoa không lộ dữ liệu khoa ngoài phạm vi');
  assert.equal(scoped.summary.registrations, 4);
  assert.deepEqual(await service.updateNote(registrarA, 2, '2026-11-21', { note: 'Học buổi chiều' }), { updated: true });
  assert.equal((await service.week(registrarA, { weekStart: '2026-11-16' })).entries['10:2026-11-21']?.[0]?.note, 'Học buổi chiều', 'có thể sửa ghi chú mà không xóa lượt học');
  await assert.rejects(service.updateNote(viewerA, 2, '2026-11-21', { note: 'Không có quyền' }), /staff-learning\.register/);

  const all = await service.week(coordinator, { weekStart: '2026-11-16' });
  assert.deepEqual(all.departments.map((department) => department.code), ['A1', 'B1']);
  assert.deepEqual(all.staff, [], 'điều phối chỉ xem/xuất nên không có danh sách nhân viên để nhập lịch');
  assert.deepEqual(all.entries['11:2026-11-16']?.map((person) => person.fullName), ['Lê Chi']);
  assert.equal(all.viewer.canRegister, false, 'điều phối chỉ xem/xuất, không tự động có quyền nhập lịch');
  assert.equal(all.viewer.seesAllDepartments, true);
  await assert.rejects(service.register(coordinator, { userId: 3, studyDate: '2026-11-17' }), /staff-learning\.register/);
  const registrarWithAllView = context(1, 10, 'ALL', [VIEW, REGISTER, EXPORT], ['DANG_KY_LICH_HOC_CAN_BO_NHAN_VIEN', 'DIEU_PHOI_TRUC']);
  await assert.rejects(service.register(registrarWithAllView, { userId: 3, studyDate: '2026-11-17' }), /không thuộc khoa\/phòng/i, 'quyền xem ALL không được mở rộng phạm vi nhập lịch của vai trò khoa');
  await assert.rejects(service.exportExcel(viewerA, { weekStart: '2026-11-16' }), /staff-learning\.export/);

  assert.deepEqual(await service.remove(registrarA, 2, '2026-11-16'), { removed: true });
  assert.equal((await service.week(registrarA, { weekStart: '2026-11-16' })).entries['10:2026-11-16'], undefined, 'gỡ đúng nhân viên/ngày');

  // Khoa được chụp tại lúc nhập: nhân viên chuyển khoa vẫn có thể được người phụ trách khoa cũ gỡ dòng lịch sử.
  await service.register(registrarA, { userId: 2, studyDate: '2026-11-18' });
  await pg.exec('UPDATE users SET department_id = 11 WHERE id = 2');
  assert.deepEqual(await service.remove(registrarA, 2, '2026-11-18'), { removed: true });
  await assert.rejects(service.register(registrarA, { userId: 2, studyDate: '2026-11-19' }), /không thuộc khoa\/phòng/i);

  await assert.rejects(service.register(registrarA, { userId: 1, studyDate: '2026-11-31' }), /Ngày học không hợp lệ/);
});

test('xuất Excel có cột khoa/đơn vị và đủ bảy cột ngày từ Thứ 2 đến Chủ nhật', async (t) => {
  const { pg, service } = await setup(); t.after(() => pg.close());
  const registrarA = context(1, 10);
  await service.register(registrarA, { userId: 2, studyDate: '2026-11-16' });
  await service.register(registrarA, { userId: 2, studyDate: '2026-11-21', note: 'Chỉ học buổi sáng' });
  await service.register(registrarA, { userId: 1, studyDate: '2026-11-22', note: 'Học buổi chiều' });
  const exported = await service.exportExcel(registrarA, { weekStart: '2026-11-16' });
  assert.match(exported.fileName, /^LICH_HOC_CAN_BO_NHAN_VIEN_2026-11-16\.xlsx$/);
  assert.equal(exported.buffer.subarray(0, 2).toString('utf8'), 'PK', 'Excel XLSX phải là gói ZIP hợp lệ');
  const workbook = new ExcelJS.Workbook();
  const xlsxBytes = exported.buffer.buffer.slice(exported.buffer.byteOffset, exported.buffer.byteOffset + exported.buffer.byteLength) as ArrayBuffer;
  await workbook.xlsx.load(xlsxBytes);
  const sheet = workbook.getWorksheet('Lịch học');
  assert.ok(sheet, 'phải có sheet Lịch học');
  assert.equal(sheet.getCell('B3').value, 'Khoa / Đơn vị');
  assert.equal(sheet.getCell('C3').value, 'Thứ 2\n16/11');
  assert.equal(sheet.getCell('G3').value, 'Thứ 6\n20/11');
  assert.equal(sheet.getCell('H3').value, 'Thứ 7\n21/11');
  assert.equal(sheet.getCell('I3').value, 'Chủ nhật\n22/11');
  assert.equal(sheet.getCell('B5').value, 'A1');
  assert.equal(sheet.getCell('C5').value, 'Trần Bình', 'ô khoa/ngày phải ghi đúng nhân viên đã đăng ký');
  assert.equal(sheet.getCell('H5').value, 'Trần Bình\nGhi chú: Chỉ học buổi sáng', 'Excel phải kèm ghi chú Thứ 7');
  assert.equal(sheet.getCell('I5').value, 'Nguyễn An\nGhi chú: Học buổi chiều', 'Excel phải kèm ghi chú Chủ nhật');
});

test('migration lịch học chạy lặp an toàn, chặn trùng nhân viên-ngày và tạo vai trò/phân quyền mới', async (t) => {
  const pg = await PGlite.create(); t.after(() => pg.close());
  await pg.exec(migration('0000_init_khoi_tao.sql'));
  await pg.exec(migration('0034_ma_nhan_vien_lien_thong.sql'));
  await pg.exec(`
    INSERT INTO roles (code, name, data_scope, is_system, priority, color) VALUES
      ('DIEU_PHOI_TRUC', 'Điều phối trực', 'ALL', true, 25, '#0891b2'),
      ('DIEU_PHOI_CHAM_CONG', 'Điều phối chấm công', 'ALL', true, 30, '#7c3aed');
  `);
  const learningSql = migration('0041_lich_hoc_can_bo_nhan_vien.sql');
  const rbacSql = migration('0042_vai_tro_dang_ky_lich_hoc_can_bo.sql');
  await pg.exec(learningSql); await pg.exec(rbacSql); await pg.exec(learningSql); await pg.exec(rbacSql);
  await pg.exec(`INSERT INTO departments (id, code, name, active) VALUES (10, 'A1', 'Khoa A1', true); INSERT INTO users (id, manv, username, password_hash, full_name, department_id, active) VALUES (1, 'NV01', 'nv001', 'hash', 'Nhân viên', 10, true); INSERT INTO staff_learning_registrations (department_id, user_id, study_date) VALUES (10, 1, '2026-11-16');`);
  await assert.rejects(pg.exec(`INSERT INTO staff_learning_registrations (department_id, user_id, study_date) VALUES (10, 1, '2026-11-16')`), /unique|duplicate/i);
  const noteSql = migration('0043_ghi_chu_lich_hoc_can_bo_nhan_vien.sql');
  await pg.exec(noteSql); await pg.exec(noteSql);
  const historic = await pg.query<{ user_id: number; study_date: string; note: string }>(`SELECT user_id, study_date::text AS study_date, note FROM staff_learning_registrations`);
  assert.deepEqual(historic.rows, [{ user_id: 1, study_date: '2026-11-16', note: '' }], 'đăng ký cũ được giữ nguyên với ghi chú rỗng');
  await assert.rejects(pg.exec(`UPDATE staff_learning_registrations SET note = NULL`), /null/i);

  const role = await pg.query<{ code: string; data_scope: string }>(`SELECT code, data_scope FROM roles WHERE code = 'DANG_KY_LICH_HOC_CAN_BO_NHAN_VIEN'`);
  assert.deepEqual(role.rows, [{ code: 'DANG_KY_LICH_HOC_CAN_BO_NHAN_VIEN', data_scope: 'DEPT' }]);
  const rolePermissions = await pg.query<{ code: string }>(`
    SELECT p.code FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE r.code = 'DANG_KY_LICH_HOC_CAN_BO_NHAN_VIEN'
    ORDER BY p.code
  `);
  assert.deepEqual(rolePermissions.rows.map((row) => row.code), [EXPORT, REGISTER, VIEW]);
  const coordinatorPermissions = await pg.query<{ role_code: string; permission_code: string }>(`
    SELECT r.code AS role_code, p.code AS permission_code FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE r.code IN ('DIEU_PHOI_TRUC', 'DIEU_PHOI_CHAM_CONG') AND p.code LIKE 'staff-learning.%'
    ORDER BY r.code, p.code
  `);
  assert.deepEqual(coordinatorPermissions.rows, [
    { role_code: 'DIEU_PHOI_TRUC', permission_code: EXPORT },
    { role_code: 'DIEU_PHOI_TRUC', permission_code: VIEW },
  ]);
});
