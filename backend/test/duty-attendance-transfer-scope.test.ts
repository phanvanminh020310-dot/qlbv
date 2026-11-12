import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as ExcelJS from 'exceljs';
import type { AccessContext } from '../src/common/types/access-context';
import { DbService } from '../src/db/db.service';
import * as schema from '../src/db/schema';
import { DutyAttendanceService } from '../src/modules/duty-attendance/duty-attendance.service';
import { AttendanceMonthQueryDto } from '../src/modules/duty-attendance/duty-attendance.dto';

const migration = (file: string) => readFileSync(resolve(__dirname, '..', 'drizzle', file), 'utf8');
const coordinator: AccessContext = {
  id: 99, username: 'coordinator', fullName: 'Điều phối', title: '', departmentId: 10, departmentName: 'Khoa A',
  roles: ['DIEU_PHOI_CHAM_CONG'], permissions: ['duty-attendance.view', 'duty-attendance.update', 'duty-attendance.export'],
  dataScope: 'ALL', departmentIds: [10], isSuperAdmin: false, sessionId: 'test',
};

test('query phạm vi khoa nhận đúng một hoặc nhiều departmentIds từ URL', async () => {
  const one = plainToInstance(AttendanceMonthQueryDto, { month: '2026-10', departmentIds: '10' });
  const many = plainToInstance(AttendanceMonthQueryDto, { month: '2026-10', departmentIds: ['10', '11'] });
  assert.deepEqual(one.departmentIds, [10]);
  assert.deepEqual(many.departmentIds, [10, 11]);
  assert.equal((await validate(one)).length, 0);
  assert.equal((await validate(many)).length, 0);
});

async function setup() {
  const pg = await PGlite.create();
  for (const file of ['0000_init_khoi_tao.sql', '0025_bang_cham_cong_truc.sql', '0029_cau_hinh_bo_cuc_bang_cham_cong.sql', '0030_nhom_ky_hieu_cham_cong.sql', '0031_cong_thuc_nghiep_vu_cham_cong.sql', '0032_lich_nghi_le_nha_nuoc_theo_nam.sql', '0033_ngay_lam_bu_va_dieu_chinh_lich_le.sql', '0034_ma_nhan_vien_lien_thong.sql', '0035_lich_su_chuyen_khoa_cham_cong.sql']) await pg.exec(migration(file));
  await pg.exec(`
    INSERT INTO departments (id, code, name, active) VALUES (10, 'A', 'Khoa A', true), (11, 'B', 'Khoa B', true), (12, 'C', 'Khoa C', true);
    INSERT INTO users (id, username, password_hash, full_name, department_id, active) VALUES
      (1, 'nv001', 'hash', 'Nhân viên chuyển khoa', 11, true),
      (2, 'nv002', 'hash', 'Nhân viên thứ hai', 11, true),
      (99, 'coordinator', 'hash', 'Điều phối', 10, true);
    -- Mốc nền 1900 được migration tạo tự động chỉ cho người đã có trước migration;
    -- fixture này tạo người sau migration nên khai báo đầy đủ lịch sử thật.
    INSERT INTO duty_attendance_department_assignments (user_id, department_id, effective_from, created_by) VALUES
      (1, 10, '2026-10-01', 99),
      (1, 11, '2026-10-11', 99),
      (1, 12, '2026-10-21', 99),
      (1, 11, '2026-10-26', 99),
      (2, 11, '2026-10-01', 99),
      (99, 10, '2026-10-01', 99);
    INSERT INTO duty_attendance_entries (department_id, user_id, work_date, code_id, updated_by) VALUES
      (10, 1, '2026-10-10', (SELECT id FROM duty_attendance_codes WHERE code = 'T'), 99),
      (11, 1, '2026-10-11', (SELECT id FROM duty_attendance_codes WHERE code = 'T'), 99),
      (12, 1, '2026-10-21', (SELECT id FROM duty_attendance_codes WHERE code = 'TC'), 99),
      (11, 1, '2026-10-26', (SELECT id FROM duty_attendance_codes WHERE code = 'T'), 99);
  `);
  const db = drizzle(pg, { schema });
  return { pg, service: new DutyAttendanceService({ db, transaction: db.transaction.bind(db) } as unknown as DbService) };
}

test('chuyển khoa nhiều lần giữ dòng cũ, hiện đúng từng khoa và không cho upsert đổi khoa lịch sử', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-01T04:00:00+07:00'));
  const { pg, service } = await setup(); t.after(() => pg.close());

  const a = await service.month(coordinator, { month: '2026-10', departmentId: 10 });
  const b = await service.month(coordinator, { month: '2026-10', departmentId: 11 });
  const c = await service.month(coordinator, { month: '2026-10', departmentId: 12 });
  assert.deepEqual(a.staff.map((person) => person.id), [1, 99], 'khoa cũ vẫn có nhân viên vì có mốc/lịch sử tháng đó; bảng sắp xếp users.id tăng dần');
  assert.deepEqual(b.staff.map((person) => person.id), [1, 2], 'nhân viên xuất hiện ở khoa mới sau mốc chuyển');
  assert.deepEqual(c.staff.map((person) => person.id), [1], 'mốc chuyển thứ hai trong cùng tháng không làm mất đoạn giữa');
  assert.equal(a.entries['1:2026-10-10']?.code, 'T');
  assert.equal(b.entries['1:2026-10-11']?.code, 'T');
  assert.equal(c.entries['1:2026-10-21']?.code, 'TC');

  await service.save(coordinator, { departmentId: 10, entries: [{ userId: 1, workDate: '2026-10-10', code: 'TC' }] });
  const oldRow = await pg.query<{ department_id: number; code: string }>(`SELECT entry.department_id, code.code FROM duty_attendance_entries entry JOIN duty_attendance_codes code ON code.id = entry.code_id WHERE entry.user_id = 1 AND entry.work_date = '2026-10-10'`);
  assert.deepEqual(oldRow.rows, [{ department_id: 10, code: 'TC' }], 'sửa ô lịch sử không thay department_id');
  await assert.rejects(service.save(coordinator, { departmentId: 11, entries: [{ userId: 1, workDate: '2026-10-10', code: 'T' }] }), /đã thuộc khoa\/phòng khác/);
  await assert.rejects(service.save(coordinator, { departmentId: 11, entries: [{ userId: 1, workDate: '2026-10-05', code: 'T' }] }), /không thuộc khoa\/phòng này/);
});

test('phạm vi nhiều/toàn bộ khoa xuất một dòng cho mỗi nhân viên-khoa và có cột khoa/phòng', async (t) => {
  const { pg, service } = await setup(); t.after(() => pg.close());
  const data = await service.month(coordinator, { month: '2026-10', departmentIds: [10, 11, 12] });
  const transferred = data.staff.filter((person) => person.id === 1);
  assert.deepEqual(transferred.map((person) => person.departmentId), [10, 11, 12]);
  assert.deepEqual(transferred.map((person) => person.key), ['10:1', '11:1', '12:1']);
  assert.equal(data.entries['10:1:2026-10-10']?.code, 'T');
  assert.equal(data.entries['12:1:2026-10-21']?.code, 'TC');

  const xlsx = await service.exportExcel(coordinator, '2026-10', undefined, [10, 11, 12]);
  const workbook = new ExcelJS.Workbook();
  const bytes = xlsx.buffer.buffer.slice(xlsx.buffer.byteOffset, xlsx.buffer.byteOffset + xlsx.buffer.byteLength) as ArrayBuffer;
  await workbook.xlsx.load(bytes);
  const sheet = workbook.getWorksheet('Cham cong'); assert.ok(sheet);
  const values = sheet.getRow(5).values; const headings = (Array.isArray(values) ? values : []).map(String);
  assert.ok(headings.includes('Khoa/Phòng'), 'Excel tổng hợp phải có cột tên khoa/phòng');
  const exportedDepartments = new Set<string>();
  sheet.eachRow((row, index) => { if (index >= 7) row.eachCell((cell, column) => { if (headings[column] === 'Khoa/Phòng') exportedDepartments.add(String(cell.value)); }); });
  assert.deepEqual([...exportedDepartments].sort(), ['Khoa A', 'Khoa B', 'Khoa C']);

  const word = await service.exportWord(coordinator, '2026-10', undefined, [10, 11, 12]);
  const pdf = await service.exportPdf(coordinator, '2026-10', undefined, [10, 11, 12]);
  assert.ok(word.buffer.length > 500, 'Word dùng đúng phạm vi nhiều khoa');
  assert.ok(pdf.buffer.length > 500, 'PDF dùng đúng phạm vi nhiều khoa');
});
