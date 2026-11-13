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
import { bangkokToday } from '../src/modules/duty/duty-rules';
import { defaultSettings } from '../src/modules/settings/settings.service';

const actor = (): AccessContext => ({
  id: 99, username: 'manager', fullName: 'Quản lý', title: '', departmentId: 10, departmentName: 'Khoa A', roles: ['NHAP_CHAM_CONG_TRUC_KHOA'],
  permissions: ['duty-attendance.view', 'duty-attendance.update', 'duty-attendance.catalog.manage'], dataScope: 'DEPT', departmentIds: [10], isSuperAdmin: false, sessionId: 'test',
});

async function setup(lockPolicy?: string) {
  const pg = await PGlite.create();
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0000_init_khoi_tao.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0005_them_danh_muc_chuc_danh.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0025_bang_cham_cong_truc.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0029_cau_hinh_bo_cuc_bang_cham_cong.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0030_nhom_ky_hieu_cham_cong.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0031_cong_thuc_nghiep_vu_cham_cong.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0032_lich_nghi_le_nha_nuoc_theo_nam.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0033_ngay_lam_bu_va_dieu_chinh_lich_le.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0034_ma_nhan_vien_lien_thong.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0035_lich_su_chuyen_khoa_cham_cong.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0037_danh_muc_chuc_vu_va_thu_tu_cham_cong.sql'), 'utf8'));
  await pg.exec(`
    INSERT INTO departments (id, code, name, active) VALUES (10, 'A', 'Khoa A', true);
    INSERT INTO users (id, manv, username, password_hash, full_name, title, department_id, active) VALUES
      (1, 'NV01', 'nv001', 'hash', 'Nhân viên Một', 'Điều dưỡng', 10, true),
      (99, 'MGR1', 'manager', 'hash', 'Quản lý', 'Trưởng khoa', 10, true);
  `);
  const db = drizzle(pg, { schema });
  const dbService = { db, transaction: db.transaction.bind(db) } as unknown as DbService;
  const settings = lockPolicy ? { get: async () => lockPolicy } : undefined;
  return { pg, dbService, service: new DutyAttendanceService(dbService, settings as any) };
}

test('cấu hình mặc định có chế độ khóa bảng chấm công an toàn', () => {
  const lockPolicy = defaultSettings().find((item) => item.key === 'dutyAttendance.lockPolicy');
  assert.deepEqual(lockPolicy, {
    key: 'dutyAttendance.lockPolicy',
    value: 'DAILY',
    group: 'attendance',
    label: 'Chế độ khóa bảng chấm công',
    description: 'Chọn thời điểm dữ liệu chấm công không còn được sửa: qua ngày, hết tuần, hết tháng hoặc hết năm. Số liệu tự nhập theo tháng được khóa khi tháng/kỳ năm đã qua.',
    valueType: 'attendance-lock-policy',
  });
  assert.deepEqual(defaultSettings().find((item) => item.key === 'dutyAttendance.staffOrderMode'), {
    key: 'dutyAttendance.staffOrderMode',
    value: 'PROFESSIONAL',
    group: 'attendance',
    label: 'Thứ tự nhân sự bảng chấm công',
    description: 'Chọn ưu tiên chức danh chuyên môn hoặc chức vụ quản lý/kiêm nhiệm trước chức danh chuyên môn. Mọi thứ tự đều lấy từ cột Thứ tự của danh mục; dữ liệu cũ chưa có danh mục xếp sau.',
    valueType: 'attendance-staff-order',
  });
});

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
  assert.equal(board.staff[0]?.manv, 'NV01', 'bảng chấm công lấy MANV liên thông thay vì tên đăng nhập');
  assert.equal(board.staff[0]?.username, 'nv001', 'tên đăng nhập vẫn được giữ riêng cho các chức năng cũ');
  assert.equal(board.rowValues['1']?.T, 6, 'ký hiệu dùng giá trị đếm đã khai báo');
  assert.equal(board.rowValues['1']?.CONG_HANH_CHINH, 6, 'công thức được tính từ cột ký hiệu');
  assert.equal(board.manualValues['1:' + a.id], '1', 'chỉ cột tự nhập được lưu');
  // Giá trị NUMBER hợp lệ được lưu từng ô, kể cả khi ràng buộc giữa các cột chưa đúng.
  assert.equal((await service.saveManualValues(user, { departmentId: 10, month, values: [{ userId: 1, columnId: a.id, value: '2' }] })).saved, 1);
  const invalidAfterSingleSave = await service.month(user, { departmentId: 10, month });
  assert.equal(invalidAfterSingleSave.manualValues[`1:${a.id}`], '2');
  assert.ok(invalidAfterSingleSave.manualViolations[`1:${a.id}`]?.[0]?.includes('Tổng ba cột công'));
  assert.ok(invalidAfterSingleSave.manualViolations[`1:${b.id}`]?.[0]?.includes('Tổng ba cột công'));
  assert.ok(invalidAfterSingleSave.manualViolations[`1:${c.id}`]?.[0]?.includes('Tổng ba cột công'));

  assert.equal((await service.saveManualValues(user, { departmentId: 10, month, values: [{ userId: 1, columnId: a.id, value: '2' }, { userId: 1, columnId: b.id, value: '2' }, { userId: 1, columnId: c.id, value: '2' }] })).saved, 3);
  const afterValidSave = await service.month(user, { departmentId: 10, month });
  assert.equal(afterValidSave.manualValues[`1:${a.id}`], '2'); assert.equal(afterValidSave.manualValues[`1:${b.id}`], '2'); assert.equal(afterValidSave.manualValues[`1:${c.id}`], '2');
  assert.deepEqual(afterValidSave.manualViolations, {}, 'khi đủ tổng, các ô trở về màu bình thường');

  await service.saveManualValues(user, { departmentId: 10, month, values: [{ userId: 1, columnId: a.id, value: '' }, { userId: 1, columnId: b.id, value: '' }, { userId: 1, columnId: c.id, value: '' }] });
  await assert.rejects(
    service.saveManualValues(user, { departmentId: 10, month, values: [{ userId: 1, columnId: a.id, value: '-1' }] }),
    /không được nhập số âm/,
  );
  await assert.rejects(
    service.saveManualValues(user, { departmentId: 10, month, values: [{ userId: 1, columnId: a.id, value: 'không phải số' }] }),
    /chỉ nhận số/,
  );

  // Ràng buộc chỉ cảnh báo: A=7 được lưu, sau đó cả ba ô liên quan được đánh dấu vi phạm.
  await service.saveManualValues(user, { departmentId: 10, month, values: [{ userId: 1, columnId: a.id, value: '7' }] });
  const invalidAfterManualSave = await service.month(user, { departmentId: 10, month });
  assert.equal(invalidAfterManualSave.manualValues[`1:${a.id}`], '7');
  assert.ok(invalidAfterManualSave.manualViolations[`1:${a.id}`]?.length);
  assert.ok(invalidAfterManualSave.manualViolations[`1:${b.id}`]?.length);
  assert.ok(invalidAfterManualSave.manualViolations[`1:${c.id}`]?.length);

  // Khi sửa đủ bộ số hợp lệ, đánh dấu vi phạm biến mất; dữ liệu phải sống qua lần đọc lại.
  await service.saveManualValues(user, { departmentId: 10, month, values: [{ userId: 1, columnId: a.id, value: '1' }, { userId: 1, columnId: b.id, value: '2' }, { userId: 1, columnId: c.id, value: '3' }] });
  assert.deepEqual((await service.month(user, { departmentId: 10, month })).manualViolations, {});

  // Đổi ký hiệu không tự cân, không xóa và không từ chối số liệu tự nhập cũ; chỉ báo đỏ để người dùng tự sửa.
  await service.save(user, { departmentId: 10, entries: [{ userId: 1, workDate: today, code: '' }] });
  const invalidAfterCodeSave = await service.month(user, { departmentId: 10, month });
  assert.equal(invalidAfterCodeSave.entries[`1:${today}`], undefined);
  assert.equal(invalidAfterCodeSave.manualValues[`1:${c.id}`], '3');
  assert.ok(invalidAfterCodeSave.manualViolations[`1:${a.id}`]?.length);
  await service.save(user, { departmentId: 10, entries: [{ userId: 1, workDate: today, code: 'T' }] });
  await service.updateCode(tCode.id, { countValue: '7' });
  await service.save(user, { departmentId: 10, entries: [{ userId: 1, workDate: today, code: 'T' }] });
  const invalidAfterCountChange = await service.month(user, { departmentId: 10, month });
  assert.equal(invalidAfterCountChange.manualValues[`1:${c.id}`], '3', 'hệ thống không tự thay số người dùng đã nhập');
  assert.ok(invalidAfterCountChange.manualViolations[`1:${c.id}`]?.length);
  await service.updateCode(tCode.id, { countValue: '6' });
  await service.save(user, { departmentId: 10, entries: [{ userId: 1, workDate: today, code: 'T' }] });

  const ghiChu = await service.createColumn({ sectionId: report.id, key: 'GHI_CHU', name: 'Ghi chú trực', columnType: 'MANUAL', dataType: 'TEXT', placeholder: 'Nhập ghi chú', sortOrder: 45, active: true });
  await service.saveManualValues(user, { departmentId: 10, month, values: [{ userId: 1, columnId: ghiChu.id, value: 'Dòng một,\n  Dòng hai ' }] });
  const exported = await service.exportExcel(user, month, 10); const workbook = new ExcelJS.Workbook(); const workbookBytes = exported.buffer.buffer.slice(exported.buffer.byteOffset, exported.buffer.byteOffset + exported.buffer.byteLength) as ArrayBuffer; await workbook.xlsx.load(workbookBytes); const sheet = workbook.getWorksheet('Cham cong'); assert.ok(sheet);
  const header = sheet.getRow(5); const columnByTitle = (title: string) => { let index = 0; header.eachCell((cell, cellIndex) => { if (cell.value === title) index = cellIndex; }); return index; }; const numericIndex = columnByTitle('Công A'); const textIndex = columnByTitle('Ghi chú trực'); assert.ok(numericIndex > 0); assert.ok(textIndex > 0);
  assert.equal(typeof sheet.getRow(7).getCell(numericIndex).value, 'number', 'cột NUMBER tự nhập phải là số thực trong Excel');
  assert.equal(sheet.getRow(7).getCell(numericIndex).value, 1);
  assert.equal(sheet.getRow(7).getCell(textIndex).value, 'Dòng một,\n  Dòng hai ', 'cột TEXT tự nhập giữ nguyên dấu phẩy, khoảng trắng và xuống dòng');
  await assert.rejects(
    service.createColumn({ sectionId: report.id, key: 'SAI', name: 'Sai', columnType: 'FORMULA', dataType: 'NUMBER', formula: '[KHONG_CO]', sortOrder: 50, active: true }),
    /chưa được khai báo/,
  );
  assert.equal(formula.columnType, 'FORMULA');
});

test('bảng một khoa xếp theo job_titles.sort_order, không theo ID chức danh và vẫn giữ dữ liệu title cũ', async (t) => {
  const { pg, service, dbService } = await setup(); t.after(() => pg.close());
  // ID danh mục được tạo theo thứ tự ngược với thứ tự cần hiển thị để chặn hồi quy sắp xếp theo job_titles.id.
  await pg.exec(`
    INSERT INTO job_titles (code, name, sort_order) VALUES
      ('CD_HIGH_ID_LOW', 'Điều dưỡng xếp sau', 90),
      ('CD_LOW_ID_HIGH', 'Bac si xep truoc', 5);
    INSERT INTO users (id, manv, username, password_hash, full_name, title, department_id, active) VALUES
      (2, 'NV02', 'sort_high', 'hash', 'Nhân viên chức danh sau', 'Điều dưỡng xếp sau', 10, true),
      (3, 'NV03', 'legacy_first', 'hash', 'Nhân viên title cũ A', 'Chức danh cũ chưa khai báo', 10, true),
      (4, 'NV04', 'sort_low', 'hash', 'Nhân viên chức danh trước', '  BAC SI XEP TRUOC  ', 10, true),
      (5, 'NV05', 'legacy_second', 'hash', 'Nhân viên title cũ B', 'Chức danh cũ chưa khai báo', 10, true);
    INSERT INTO management_positions (code, name, sort_order) VALUES ('CNK', 'Chủ nhiệm khoa', 1);
    INSERT INTO user_management_positions (user_id, management_position_id) VALUES (2, (SELECT id FROM management_positions WHERE code = 'CNK'));
  `);
  const titleRows = await pg.query<{ id: number; sort_order: number }>("SELECT id, sort_order FROM job_titles WHERE code IN ('CD_HIGH_ID_LOW', 'CD_LOW_ID_HIGH') ORDER BY id");
  assert.deepEqual(titleRows.rows.map((row) => row.sort_order), [90, 5], 'ID danh mục nhỏ có sort_order lớn hơn để chứng minh không dùng ID');

  const board = await service.month(actor(), { departmentId: 10, month: '2026-10' });
  const added = board.staff.filter((person) => [2, 3, 4, 5].includes(person.id));
  assert.deepEqual(added.map((person) => person.id), [4, 2, 3, 5]);
  assert.deepEqual(added.map((person) => person.titleSortOrder), [5, 90, null, null]);
  assert.equal(added.find((person) => person.id === 2)?.managementPosition, 'Chủ nhiệm khoa');
  assert.ok(board.staff.some((person) => person.id === 1 && person.titleSortOrder === null), 'nhân viên dữ liệu cũ không có danh mục chức danh vẫn được giữ trên bảng');

  const managementFirst = new DutyAttendanceService(dbService, {
    get: async (key: string, fallback: unknown) => key === 'dutyAttendance.staffOrderMode' ? 'MANAGEMENT_THEN_PROFESSIONAL' : fallback,
  } as any);
  const managementFirstBoard = await managementFirst.month(actor(), { departmentId: 10, month: '2026-10' });
  const managementFirstAdded = managementFirstBoard.staff.filter((person) => [2, 3, 4, 5].includes(person.id));
  assert.equal(managementFirstBoard.staffOrderMode, 'MANAGEMENT_THEN_PROFESSIONAL');
  assert.deepEqual(managementFirstAdded.map((person) => person.id), [2, 4, 3, 5], 'khi cấu hình ưu tiên chức vụ, management_positions.sort_order đứng trước job_titles.sort_order');
});

test('chế độ khóa bảng chấm công áp dụng đúng cho ngày và số liệu tự nhập theo kỳ', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-15T04:00:00+07:00'));
  const fixture = await setup(); t.after(() => fixture.pg.close()); const user = actor();
  const withPolicy = (lockPolicy: string) => new DutyAttendanceService(fixture.dbService, { get: async () => lockPolicy } as any);

  const daily = withPolicy('DAILY');
  const dailyBoard = await daily.month(user, { departmentId: 10, month: '2026-10' });
  assert.equal(dailyBoard.lockPolicy, 'DAILY');
  assert.equal(dailyBoard.dates.find((date) => date.date === '2026-10-14')?.isLocked, true);
  assert.equal(dailyBoard.dates.find((date) => date.date === '2026-10-15')?.isLocked, false);
  await assert.rejects(daily.save(user, { departmentId: 10, entries: [{ userId: 1, workDate: '2026-10-14', code: 'T' }] }), /chế độ khóa bảng/);

  const weekly = withPolicy('WEEKLY');
  const weeklyBoard = await weekly.month(user, { departmentId: 10, month: '2026-10' });
  assert.equal(weeklyBoard.dates.find((date) => date.date === '2026-10-11')?.isLocked, true, 'tuần trước phải khóa');
  assert.equal(weeklyBoard.dates.find((date) => date.date === '2026-10-14')?.isLocked, false, 'ngày trong tuần hiện tại còn mở');

  const monthly = withPolicy('MONTHLY');
  const monthlyBoard = await monthly.month(user, { departmentId: 10, month: '2026-10' });
  assert.equal(monthlyBoard.dates.find((date) => date.date === '2026-10-01')?.isLocked, false, 'tháng hiện tại còn mở');
  const previousMonthBoard = await monthly.month(user, { departmentId: 10, month: '2026-09' });
  assert.equal(previousMonthBoard.dates.find((date) => date.date === '2026-09-30')?.isLocked, true);

  const layout = await monthly.layout(); const report = layout.sections.find((section) => section.code === 'REPORT'); assert.ok(report);
  const manual = await monthly.createColumn({ sectionId: report.id, key: 'GHI', name: 'Ghi', columnType: 'MANUAL', dataType: 'TEXT', active: true });
  await assert.rejects(monthly.saveManualValues(user, { departmentId: 10, month: '2026-09', values: [{ userId: 1, columnId: manual.id, value: 'đã khóa' }] }), /chế độ khóa bảng/);

  const yearly = withPolicy('YEARLY');
  const yearlyBoard = await yearly.month(user, { departmentId: 10, month: '2026-10' });
  assert.equal(yearlyBoard.dates.find((date) => date.date === '2026-10-01')?.isLocked, false);
  const oldYearBoard = await yearly.month(user, { departmentId: 10, month: '2025-12' });
  assert.equal(oldYearBoard.dates.find((date) => date.date === '2025-12-31')?.isLocked, true);
  await yearly.saveManualValues(user, { departmentId: 10, month: '2026-01', values: [{ userId: 1, columnId: manual.id, value: 'vẫn mở trong năm' }] });
});
