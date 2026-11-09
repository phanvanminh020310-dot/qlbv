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

const actor = (): AccessContext => ({
  id: 99, username: 'manager', fullName: 'Quản lý', title: '', departmentId: 10, departmentName: 'Khoa A', roles: ['NHAP_CHAM_CONG_TRUC_KHOA'],
  permissions: ['duty-attendance.view', 'duty-attendance.update', 'duty-attendance.catalog.manage'], dataScope: 'DEPT', departmentIds: [10], isSuperAdmin: false, sessionId: 'test',
});

async function setup() {
  const pg = await PGlite.create();
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0000_init_khoi_tao.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0025_bang_cham_cong_truc.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0029_cau_hinh_bo_cuc_bang_cham_cong.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0030_nhom_ky_hieu_cham_cong.sql'), 'utf8'));
  await pg.exec(`
    INSERT INTO departments (id, code, name, active) VALUES (10, 'A', 'Khoa A', true);
    INSERT INTO users (id, username, password_hash, full_name, title, department_id, active) VALUES
      (1, 'nv001', 'hash', 'Nhân viên Một', 'Điều dưỡng', 10, true),
      (99, 'manager', 'hash', 'Quản lý', 'Trưởng khoa', 10, true);
  `);
  const db = drizzle(pg, { schema });
  return { pg, service: new DutyAttendanceService({ db, transaction: db.transaction.bind(db) } as unknown as DbService) };
}

test('bố cục chấm công có 4 phần mặc định, MANV, tổng ký hiệu, công thức và tự nhập theo tháng', async (t) => {
  const { pg, service } = await setup(); t.after(() => pg.close()); const user = actor(); const today = bangkokToday(); const month = today.slice(0, 7);
  const tCode = (await service.codes()).find((code) => code.code === 'T'); assert.ok(tCode);
  await service.updateCode(tCode.id, { countValue: '6' });
  const initial = await service.layout();
  assert.deepEqual(initial.sections.map((section) => section.code), ['ADMIN', 'DAYS', 'SYMBOLS', 'REPORT']);
  const report = initial.sections.find((section) => section.code === 'REPORT'); assert.ok(report);
  const a = await service.createColumn({ sectionId: report.id, key: 'CONG_A', name: 'Công A', columnType: 'MANUAL', dataType: 'NUMBER', placeholder: 'Tự nhập', sortOrder: 10, active: true });
  const b = await service.createColumn({ sectionId: report.id, key: 'CONG_B', name: 'Công B', columnType: 'MANUAL', dataType: 'NUMBER', placeholder: 'Tự nhập', sortOrder: 20, active: true });
  const c = await service.createColumn({ sectionId: report.id, key: 'CONG_C', name: 'Công C', columnType: 'MANUAL', dataType: 'NUMBER', placeholder: 'Tự nhập', sortOrder: 30, active: true });
  const formula = await service.createColumn({ sectionId: report.id, key: 'CONG_HANH_CHINH', name: 'Công hành chính', columnType: 'FORMULA', dataType: 'NUMBER', formula: '[T]', sortOrder: 40, active: true });
  await service.save(user, { departmentId: 10, entries: [{ userId: 1, workDate: today, code: 'T' }] });
  await service.saveManualValues(user, { departmentId: 10, month, values: [{ userId: 1, columnId: a.id, value: '1' }, { userId: 1, columnId: b.id, value: '2' }, { userId: 1, columnId: c.id, value: '3' }] });
  await service.createValidation({ name: 'Tổng công A/B/C', expression: '[CONG_A] + [CONG_B] + [CONG_C] == [CONG_HANH_CHINH]', message: 'Tổng ba cột công phải bằng công hành chính', sortOrder: 10, active: true });
  const board = await service.month(user, { departmentId: 10, month });
  assert.equal(board.staff[0]?.username, 'nv001', 'MANV lấy từ tên đăng nhập');
  assert.equal(board.rowValues['1']?.T, 6, 'ký hiệu dùng giá trị đếm đã khai báo');
  assert.equal(board.rowValues['1']?.CONG_HANH_CHINH, 6, 'công thức được tính từ cột ký hiệu');
  assert.equal(board.manualValues['1:' + a.id], '1', 'chỉ cột tự nhập được lưu');
  await assert.rejects(
    service.saveManualValues(user, { departmentId: 10, month, values: [{ userId: 1, columnId: a.id, value: '2' }] }),
    /Tổng ba cột công phải bằng công hành chính/,
  );
  await assert.rejects(
    service.saveManualValues(user, { departmentId: 10, month, values: [{ userId: 1, columnId: a.id, value: 'không phải số' }] }),
    /chỉ nhận số/,
  );
  await assert.rejects(
    service.createColumn({ sectionId: report.id, key: 'SAI', name: 'Sai', columnType: 'FORMULA', dataType: 'NUMBER', formula: '[KHONG_CO]', sortOrder: 50, active: true }),
    /chưa được khai báo/,
  );
  assert.equal(formula.columnType, 'FORMULA');
});
