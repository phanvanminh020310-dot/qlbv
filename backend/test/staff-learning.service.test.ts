import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as ExcelJS from 'exceljs';
import type { AccessContext } from '../src/common/types/access-context';
import { DbService } from '../src/db/db.service';
import * as schema from '../src/db/schema';
import { StaffLearningService } from '../src/modules/staff-learning/staff-learning.service';

const migration = (file: string) => readFileSync(resolve(__dirname, '..', 'drizzle', file), 'utf8');
const context = (id: number, departmentId: number | null, dataScope: 'OWN' | 'DEPT' | 'ALL' = 'OWN'): AccessContext => ({
  id, username: `u${id}`, fullName: `User ${id}`, title: '', departmentId, departmentName: '', roles: [], permissions: ['duty.view'], dataScope,
  departmentIds: departmentId ? [departmentId] : [], isSuperAdmin: false, sessionId: `test-${id}`,
});

async function setup() {
  const pg = await PGlite.create();
  await pg.exec(migration('0000_init_khoi_tao.sql'));
  await pg.exec(migration('0034_ma_nhan_vien_lien_thong.sql'));
  await pg.exec(migration('0041_lich_hoc_can_bo_nhan_vien.sql'));
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

test('cán bộ tự đăng ký lịch học tuần, danh sách được nhóm theo khoa và không lộ khoa ngoài phạm vi', async (t) => {
  const { pg, service } = await setup(); t.after(() => pg.close());
  const a1 = context(1, 10);
  const a2 = context(2, 10);
  const b1 = context(3, 11);

  const initial = await service.week(a1, { weekStart: '2026-11-16' });
  assert.deepEqual(initial.days.map((day) => day.date), ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']);
  assert.deepEqual(initial.departments.map((department) => department.id), [10]);
  assert.deepEqual(initial.myDates, []);

  assert.deepEqual(await service.register(a1, { studyDate: '2026-11-16' }), { registered: true, alreadyRegistered: false });
  assert.deepEqual(await service.register(a1, { studyDate: '2026-11-16' }), { registered: true, alreadyRegistered: true }, 'mỗi người/ngày duy nhất, bấm lại không tạo dữ liệu trùng');
  await service.register(a2, { studyDate: '2026-11-16' });
  await service.register(a1, { studyDate: '2026-11-17' });
  await service.register(b1, { studyDate: '2026-11-16' });

  const scoped = await service.week(a1, { weekStart: '2026-11-16' });
  assert.deepEqual(scoped.myDates, ['2026-11-16', '2026-11-17']);
  assert.deepEqual(scoped.entries['10:2026-11-16']?.map((person) => person.fullName), ['Nguyễn An', 'Trần Bình']);
  assert.equal(scoped.entries['11:2026-11-16'], undefined, 'phạm vi khoa chỉ thấy khoa được gán');
  assert.equal(scoped.summary.registrations, 3);

  const all = await service.week(context(99, 10, 'ALL'), { weekStart: '2026-11-16' });
  assert.deepEqual(all.departments.map((department) => department.code), ['A1', 'B1']);
  assert.deepEqual(all.entries['11:2026-11-16']?.map((person) => person.fullName), ['Lê Chi']);

  await assert.rejects(service.register(a1, { studyDate: '2026-11-21' }), /Thứ 2 đến Thứ 6/);
  assert.deepEqual(await service.remove(a1, '2026-11-16'), { removed: true });
  const afterRemove = await service.week(a1, { weekStart: '2026-11-16' });
  assert.deepEqual(afterRemove.entries['10:2026-11-16']?.map((person) => person.fullName), ['Trần Bình'], 'gỡ chỉ ảnh hưởng đăng ký của chính người dùng');

  // Đổi khoa sau khi đăng ký không làm mất khả năng tự gỡ dòng lịch sử của cán bộ.
  await pg.exec(`UPDATE users SET department_id = 11 WHERE id = 1`);
  const moved = context(1, 11);
  const afterTransfer = await service.week(moved, { weekStart: '2026-11-16' });
  assert.deepEqual(afterTransfer.myDates, ['2026-11-17'], 'đăng ký lịch sử ở khoa cũ vẫn hiện trong lịch cá nhân để tự gỡ');
  assert.deepEqual(await service.remove(moved, '2026-11-17'), { removed: true });
});

test('xuất Excel có cột khoa/đơn vị và đủ năm cột ngày làm việc trong tuần', async (t) => {
  const { pg, service } = await setup(); t.after(() => pg.close());
  const a1 = context(1, 10);
  await service.register(a1, { studyDate: '2026-11-16' });
  const exported = await service.exportExcel(a1, { weekStart: '2026-11-16' });
  assert.match(exported.fileName, /^LICH_HOC_CAN_BO_NHAN_VIEN_2026-11-16\.xlsx$/);
  assert.equal(exported.buffer.subarray(0, 2).toString('utf8'), 'PK', 'Excel XLSX phải là gói ZIP hợp lệ');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(exported.buffer);
  const sheet = workbook.getWorksheet('Lịch học');
  assert.ok(sheet, 'phải có sheet Lịch học');
  assert.equal(sheet.getCell('B3').value, 'Khoa / Đơn vị');
  assert.equal(sheet.getCell('C3').value, 'Thứ 2\n16/11');
  assert.equal(sheet.getCell('G3').value, 'Thứ 6\n20/11');
  assert.equal(sheet.getCell('B5').value, 'A1');
  assert.equal(sheet.getCell('C5').value, 'Nguyễn An', 'ô khoa/ngày phải ghi đúng danh sách người đã đăng ký');
});

test('migration lịch học chạy lặp an toàn và chặn trùng nhân viên-ngày', async (t) => {
  const pg = await PGlite.create(); t.after(() => pg.close());
  await pg.exec(migration('0000_init_khoi_tao.sql'));
  await pg.exec(migration('0034_ma_nhan_vien_lien_thong.sql'));
  const sql = migration('0041_lich_hoc_can_bo_nhan_vien.sql'); await pg.exec(sql); await pg.exec(sql);
  await pg.exec(`INSERT INTO departments (id, code, name, active) VALUES (10, 'A1', 'Khoa A1', true); INSERT INTO users (id, manv, username, password_hash, full_name, department_id, active) VALUES (1, 'NV01', 'nv001', 'hash', 'Nhân viên', 10, true); INSERT INTO staff_learning_registrations (department_id, user_id, study_date) VALUES (10, 1, '2026-11-16');`);
  await assert.rejects(pg.exec(`INSERT INTO staff_learning_registrations (department_id, user_id, study_date) VALUES (10, 1, '2026-11-16')`), /unique|duplicate/i);
});
