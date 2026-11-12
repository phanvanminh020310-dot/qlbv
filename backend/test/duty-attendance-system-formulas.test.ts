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
import { DutyAttendanceService } from '../src/modules/duty-attendance/duty-attendance.service';

const actor: AccessContext = {
  id: 99, username: 'manager', fullName: 'Quản lý', title: '', departmentId: 10, departmentName: 'Khoa A', roles: ['NHAP_CHAM_CONG_TRUC_KHOA'],
  permissions: ['duty-attendance.view', 'duty-attendance.update', 'duty-attendance.catalog.manage'], dataScope: 'DEPT', departmentIds: [10], isSuperAdmin: false, sessionId: 'test',
};

async function fixture() {
  const pg = await PGlite.create();
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0000_init_khoi_tao.sql'), 'utf8'));
  for (const file of ['0025_bang_cham_cong_truc.sql', '0029_cau_hinh_bo_cuc_bang_cham_cong.sql', '0030_nhom_ky_hieu_cham_cong.sql', '0031_cong_thuc_nghiep_vu_cham_cong.sql', '0032_lich_nghi_le_nha_nuoc_theo_nam.sql', '0033_ngay_lam_bu_va_dieu_chinh_lich_le.sql', '0034_ma_nhan_vien_lien_thong.sql', '0035_lich_su_chuyen_khoa_cham_cong.sql']) {
    await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', file), 'utf8'));
  }
  await pg.exec(`
    INSERT INTO departments (id, code, name, active) VALUES (10, 'A', 'Khoa A', true);
    INSERT INTO users (id, username, password_hash, full_name, title, department_id, active) VALUES
      (1, 'nv001', 'hash', 'Nhân viên Một', 'Điều dưỡng', 10, true),
      (99, 'manager', 'hash', 'Quản lý', 'Trưởng khoa', 10, true);
  `);
  const db = drizzle(pg, { schema });
  const settings = { get: async (key: string, fallback: unknown) => key === 'dutyAttendance.lockPolicy' ? 'YEARLY' : fallback };
  return { pg, service: new DutyAttendanceService({ db, transaction: db.transaction.bind(db) } as unknown as DbService, settings as any) };
}

test('cột công thức nghiệp vụ mặc định và công thức cũ cùng chạy; mã trực ngừng dùng vẫn phân loại lịch sử', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-10T04:00:00+07:00'));
  const { pg, service } = await fixture();
  t.after(() => pg.close());

  const report = (await service.layout()).sections.find((section) => section.code === 'REPORT');
  assert.ok(report);
  assert.equal((await service.layout()).columns.find((column) => column.key === 'NGAY_CONG')?.formula, '[SYS_NGAY_CONG]');
  assert.ok((await service.layout()).systemMetrics.some((metric) => metric.key === 'SYS_NGHI_TANG_CUONG_NGAY_THUONG'));

  const rest = await service.createCode({ code: 'N', name: 'Nghỉ bù', group: 'OTHER', countValue: '1', calculationRole: 'REST', deductsWorkday: true, restSource: 'ANY_DUTY', sortOrder: 75, active: true });
  const oldFormula = await service.createColumn({ sectionId: report.id, key: 'CONG_CU', name: 'Công thức cũ', columnType: 'FORMULA', dataType: 'NUMBER', formula: '[T] + [TC]', sortOrder: 200, active: true });
  const derivedFormula = await service.createColumn({ sectionId: report.id, key: 'TONG_NGHIEP_VU', name: 'Tổng nghiệp vụ', columnType: 'FORMULA', dataType: 'NUMBER', formula: '[SYS_TRUC_NGAY_LE] + [SYS_NGHI_TRUC_NGAY_LE] + [SYS_TANG_CUONG_NGAY_THUONG] + [SYS_NGHI_TANG_CUONG_NGAY_THUONG]', sortOrder: 210, active: true });
  await service.saveHoliday(actor, { holidayDate: '2026-10-11', name: 'Lễ trùng Chủ nhật' });
  await service.save(actor, { departmentId: 10, entries: [
    { userId: 1, workDate: '2026-10-11', code: 'T' },
    { userId: 1, workDate: '2026-10-12', code: 'N' },
    { userId: 1, workDate: '2026-10-13', code: 'TC' },
    { userId: 1, workDate: '2026-10-14', code: 'N' },
  ] });

  const beforeRetiringT = await service.month(actor, { departmentId: 10, month: '2026-10' });
  assert.equal(beforeRetiringT.rowValues['1']?.SYS_NGAY_CONG, 20, '22 ngày làm việc trong tháng, trừ hai ngày nghỉ bù');
  assert.equal(beforeRetiringT.rowValues['1']?.NGAY_CONG, 20, 'cột Ngày công mặc định dùng biến SYS_NGAY_CONG');
  assert.equal(beforeRetiringT.rowValues['1']?.SYS_TRUC_NGAY_LE, 1, 'lễ trùng Chủ nhật ưu tiên phân loại ngày lễ');
  assert.equal(beforeRetiringT.rowValues['1']?.SYS_NGHI_TRUC_NGAY_LE, 1, 'nghỉ bù lấy loại của ca trực trước đó');
  assert.equal(beforeRetiringT.rowValues['1']?.SYS_TANG_CUONG_NGAY_THUONG, 1);
  assert.equal(beforeRetiringT.rowValues['1']?.SYS_NGHI_TANG_CUONG_NGAY_THUONG, 1);
  assert.equal(beforeRetiringT.rowValues['1']?.[oldFormula.key], 2, 'công thức cũ theo mã ký hiệu tiếp tục hoạt động');
  assert.equal(beforeRetiringT.rowValues['1']?.[derivedFormula.key], 4, 'công thức mới có thể kết hợp các biến hệ thống');
  assert.deepEqual(beforeRetiringT.calculationWarnings, {});
  const exported = await service.exportExcel(actor, '2026-10', 10); const workbook = new ExcelJS.Workbook();
  const bytes = exported.buffer.buffer.slice(exported.buffer.byteOffset, exported.buffer.byteOffset + exported.buffer.byteLength) as ArrayBuffer; await workbook.xlsx.load(bytes);
  const sheet = workbook.getWorksheet('Cham cong'); assert.ok(sheet);
  let workdayColumn = 0; sheet.getRow(5).eachCell((cell, index) => { if (cell.value === 'Ngày công') workdayColumn = index; });
  assert.ok(workdayColumn > 0, 'Excel giữ cột công thức nghiệp vụ mặc định');
  assert.equal(sheet.getRow(7).getCell(workdayColumn).value, 20, 'Excel nhận đúng Ngày công đã tự tính');

  const directDuty = (await service.codes()).find((code) => code.code === 'T');
  assert.ok(directDuty);
  await service.updateCode(directDuty.id, { active: false });
  const afterRetiringT = await service.month(actor, { departmentId: 10, month: '2026-10' });
  assert.equal(afterRetiringT.codes.some((code) => code.code === 'T'), false, 'mã ngừng dùng không còn là lựa chọn nhập mới');
  assert.equal(afterRetiringT.entries['1:2026-10-11']?.code, 'T', 'ký hiệu lịch sử không bị ghi đè hay xóa');
  assert.equal(afterRetiringT.rowValues['1']?.SYS_NGHI_TRUC_NGAY_LE, 1, 'nghỉ bù vẫn dò được ca trực lịch sử đã ngừng dùng');
  assert.equal(rest.calculationRole, 'REST');
});
