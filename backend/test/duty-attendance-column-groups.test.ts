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
import { buildHeaderCells, orderColumnsByTree, replaceFormulaReferences } from '../src/modules/duty-attendance/attendance-layout';
import { DutyAttendanceService } from '../src/modules/duty-attendance/duty-attendance.service';

const actor: AccessContext = {
  id: 99, username: 'manager', fullName: 'Quản lý', title: '', departmentId: 10, departmentName: 'Khoa A', roles: ['NHAP_CHAM_CONG_TRUC_KHOA'],
  permissions: ['duty-attendance.view', 'duty-attendance.update', 'duty-attendance.catalog.manage'], dataScope: 'DEPT', departmentIds: [10], isSuperAdmin: false, sessionId: 'test',
};

async function fixture() {
  const pg = await PGlite.create();
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0000_init_khoi_tao.sql'), 'utf8'));
  for (const file of ['0005_them_danh_muc_chuc_danh.sql', '0025_bang_cham_cong_truc.sql', '0029_cau_hinh_bo_cuc_bang_cham_cong.sql', '0030_nhom_ky_hieu_cham_cong.sql', '0031_cong_thuc_nghiep_vu_cham_cong.sql', '0032_lich_nghi_le_nha_nuoc_theo_nam.sql', '0033_ngay_lam_bu_va_dieu_chinh_lich_le.sql', '0034_ma_nhan_vien_lien_thong.sql', '0035_lich_su_chuyen_khoa_cham_cong.sql', '0037_danh_muc_chuc_vu_va_thu_tu_cham_cong.sql', '0039_ghi_chu_cham_cong_theo_ngay.sql', '0040_nhieu_ky_hieu_cham_cong_trong_ngay.sql', '0047_nhom_tieu_de_cot_cham_cong.sql']) {
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

test('thứ tự cột theo cây nhóm và lưới tiêu đề gộp ô đúng nhiều tầng', () => {
  const groups = [
    { id: 1, sectionId: 5, parentId: null, name: 'Trực theo quy định', color: '', sortOrder: 10, active: true },
    { id: 2, sectionId: 5, parentId: 1, name: 'Ngày lễ', color: '', sortOrder: 10, active: true },
    { id: 3, sectionId: 5, parentId: 1, name: 'Ngày nghỉ', color: '', sortOrder: 20, active: true },
  ];
  const columns = [
    { id: 10, sectionId: 5, groupId: 3, sortOrder: 1, name: 'Trực' },
    { id: 11, sectionId: 5, groupId: 2, sortOrder: 2, name: 'Nghỉ trực' },
    { id: 12, sectionId: 5, groupId: 2, sortOrder: 1, name: 'Trực' },
    { id: 13, sectionId: 5, groupId: null, sortOrder: 5, name: 'Ngày công' },
  ];
  const ordered = orderColumnsByTree([5], groups, columns);
  assert.deepEqual(ordered.map((column) => column.id), [13, 12, 11, 10], 'Ngày công (5) trước nhóm (10); trong nhóm theo thứ tự cây');
  const byId = new Map(groups.map((group) => [group.id, group]));
  const header = buildHeaderCells(ordered.map((column) => {
    const path = column.groupId ? [byId.get(byId.get(column.groupId)!.parentId!)!, byId.get(column.groupId)!] : [];
    return { sectionId: 5, sectionName: 'Báo cáo', sectionColor: '#7c3aed', name: column.name, path };
  }));
  assert.equal(header.depth, 2);
  assert.equal(header.rows, 4);
  assert.deepEqual(header.cells.filter((cell) => cell.kind === 'GROUP').map((cell) => [cell.text, cell.row, cell.col, cell.colSpan]), [['Trực theo quy định', 1, 1, 3], ['Ngày lễ', 2, 1, 2], ['Ngày nghỉ', 2, 3, 1]]);
  const ngayCong = header.cells.find((cell) => cell.kind === 'LEAF' && cell.col === 0)!;
  assert.deepEqual([ngayCong.row, ngayCong.rowSpan], [1, 3], 'cột không thuộc nhóm kéo dài qua mọi tầng nhóm');
  assert.equal(replaceFormulaReferences('[SYS_TRUC_NGAY_LE] * 0.5 + [QD_LE_TRUC]', [{ from: 'NGAY_LE', to: 'NGAY_NGHI' }, { from: '_LE_', to: '_NGHI_' }]), '[SYS_TRUC_NGAY_NGHI] * 0.5 + [QD_NGHI_TRUC]');
});

test('khai báo nhóm tiêu đề, nhân bản nhóm để sinh cột, xuất Excel nhiều tầng và xóa nhóm không mất cột', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-10T04:00:00+07:00'));
  const { pg, service } = await fixture();
  t.after(() => pg.close());

  const section = await service.createSection({ code: 'BINH_XET', name: 'Tổng hợp bình xét', color: '#7c3aed', sortOrder: 500, active: true });
  const report = (await service.layout()).sections.find((item) => item.code === 'REPORT')!;
  const quyDinh = await service.createColumnGroup({ sectionId: section.id, name: 'Trực theo quy định', sortOrder: 10 });
  const ngayLe = await service.createColumnGroup({ sectionId: section.id, parentId: quyDinh.id, name: 'Ngày lễ', sortOrder: 10 });
  await service.createColumn({ sectionId: section.id, groupId: ngayLe.id, key: 'QD_LE_TRUC', name: 'Trực', columnType: 'FORMULA', formula: '[SYS_TRUC_NGAY_LE]', sortOrder: 1, active: true });
  await service.createColumn({ sectionId: section.id, groupId: ngayLe.id, key: 'QD_LE_NGHI', name: 'Nghỉ trực', columnType: 'FORMULA', formula: '[SYS_NGHI_TRUC_NGAY_LE]', sortOrder: 2, active: true });
  await service.createColumn({ sectionId: section.id, groupId: ngayLe.id, key: 'QD_LE_LAM_THEM', name: 'Làm thêm', columnType: 'FORMULA', formula: '[QD_LE_TRUC] * 0.5', sortOrder: 3, active: true });

  await assert.rejects(service.createColumnGroup({ sectionId: report.id, parentId: quyDinh.id, name: 'Sai phần' }), /cùng phần/);
  await assert.rejects(service.updateColumnGroup(quyDinh.id, { parentId: ngayLe.id }), /chính nó hoặc nhóm con/);
  await assert.rejects(service.createColumn({ sectionId: report.id, groupId: ngayLe.id, key: 'SAI_NHOM', name: 'Sai', columnType: 'MANUAL', active: true }), /cùng phần/);

  // Sinh nhanh “Ngày nghỉ” từ “Ngày lễ”: mã cột và tham chiếu công thức được thay theo quy tắc.
  const nghi = await service.duplicateColumnGroup(ngayLe.id, { name: 'Ngày nghỉ', sortOrder: 20, replacements: [{ from: 'NGAY_LE', to: 'NGAY_NGHI' }, { from: '_LE_', to: '_NGHI_' }] });
  assert.deepEqual(nghi.keys.sort(), ['QD_NGHI_LAM_THEM', 'QD_NGHI_NGHI', 'QD_NGHI_TRUC']);
  // Thiếu quy tắc thay thế → trùng mã, không tạo gì.
  await assert.rejects(service.duplicateColumnGroup(ngayLe.id, { name: 'Trùng' }), /đã tồn tại/);
  // Nhân bản cả nhánh cấp 1 thành “Trực tăng cường”.
  const tangCuong = await service.duplicateColumnGroup(quyDinh.id, { name: 'Trực tăng cường', sortOrder: 30, replacements: [{ from: 'QD_', to: 'TC_' }, { from: 'SYS_TRUC', to: 'SYS_TANG_CUONG' }, { from: 'SYS_NGHI_TRUC', to: 'SYS_NGHI_TANG_CUONG' }] });
  assert.equal(tangCuong.groups, 3); assert.equal(tangCuong.columns, 6);
  const layout = await service.layout();
  assert.equal(layout.columns.find((column) => column.key === 'TC_NGHI_TRUC')?.formula, '[SYS_TANG_CUONG_NGAY_NGHI]');
  assert.equal(layout.columns.find((column) => column.key === 'TC_LE_LAM_THEM')?.formula, '[TC_LE_TRUC] * 0.5');
  // Cột đặt trực tiếp dưới nhóm cấp 1 (VD: Vị trí trực), cùng tầng với các nhóm con.
  await service.createColumn({ sectionId: section.id, groupId: tangCuong.group.id, key: 'VI_TRI_TRUC', name: 'Vị trí trực', columnType: 'MANUAL', dataType: 'TEXT', sortOrder: 1, active: true });

  const order = layout.columns.filter((column) => column.sectionId === section.id).map((column) => column.key);
  assert.deepEqual(order, ['QD_LE_TRUC', 'QD_LE_NGHI', 'QD_LE_LAM_THEM', 'QD_NGHI_TRUC', 'QD_NGHI_NGHI', 'QD_NGHI_LAM_THEM', 'TC_LE_TRUC', 'TC_LE_NGHI', 'TC_LE_LAM_THEM', 'TC_NGHI_TRUC', 'TC_NGHI_NGHI', 'TC_NGHI_LAM_THEM']);

  await service.saveHoliday(actor, { holidayDate: '2026-10-11', name: 'Lễ' });
  await service.save(actor, { departmentId: 10, entries: [{ userId: 1, workDate: '2026-10-11', code: 'T' }] });
  const board = await service.month(actor, { departmentId: 10, month: '2026-10' });
  assert.equal(board.columnGroups.length, 6);
  assert.equal(board.rowValues['1']?.QD_LE_TRUC, 1); assert.equal(board.rowValues['1']?.QD_LE_LAM_THEM, 0.5);
  assert.equal(board.columns.filter((column) => column.sectionId === section.id)[6]?.key, 'VI_TRI_TRUC');

  const exported = await service.exportExcel(actor, '2026-10', 10); const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(exported.buffer.buffer.slice(exported.buffer.byteOffset, exported.buffer.byteOffset + exported.buffer.byteLength) as ArrayBuffer);
  const sheet = workbook.getWorksheet('Cham cong')!;
  const find = (row: number, text: string) => { let found = 0; sheet.getRow(row).eachCell((cell, col) => { if (!found && cell.value === text) found = col; }); return found; };
  const quyDinhCol = find(5, 'Trực theo quy định'); const tcCol = find(5, 'Trực tăng cường');
  assert.ok(quyDinhCol > 0 && tcCol === quyDinhCol + 6, 'tầng 1: hai nhóm lớn, mỗi nhóm 6 cột');
  assert.equal(find(6, 'Ngày lễ'), quyDinhCol); assert.equal(find(6, 'Ngày nghỉ'), quyDinhCol + 3);
  assert.equal(sheet.getCell(7, quyDinhCol).value, 'Trực'); assert.equal(sheet.getCell(7, quyDinhCol + 2).value, 'Làm thêm');
  assert.equal(sheet.getCell(6, tcCol).value, 'Vị trí trực', 'cột trực tiếp dưới nhóm cấp 1 gộp dọc qua tầng nhóm con');
  assert.equal(sheet.getCell(7, tcCol).isMerged, true);
  const ngayCongCol = find(5, 'Ngày công');
  assert.ok(ngayCongCol > 0, 'cột không nhóm của phần Báo cáo hiển thị ngay dưới phần và gộp dọc');
  assert.equal(sheet.getCell(9, quyDinhCol).value, 1, 'dữ liệu bắt đầu sau hàng tiêu đề + hàng thứ');

  const word = await service.exportWord(actor, '2026-10', 10);
  assert.ok(word.buffer.length > 1000, 'Word dựng được bảng có ô gộp ngang/dọc');

  // Ẩn nhóm thì ẩn cả nhánh; xóa nhóm thì cột được đưa lên nhóm cha.
  await service.updateColumnGroup(tangCuong.group.id, { active: false });
  assert.equal((await service.month(actor, { departmentId: 10, month: '2026-10' })).columns.some((column) => column.key === 'TC_LE_TRUC'), false);
  await service.deleteColumnGroup(ngayLe.id);
  const afterDelete = await service.layout();
  assert.equal(afterDelete.columns.find((column) => column.key === 'QD_LE_TRUC')?.groupId, quyDinh.id);
  // Gán lại cột bằng danh sách columnIds.
  const ids = afterDelete.columns.filter((column) => column.key.startsWith('QD_LE_')).map((column) => column.id);
  const regrouped = await service.createColumnGroup({ sectionId: section.id, parentId: quyDinh.id, name: 'Ngày lễ', sortOrder: 5, columnIds: ids });
  assert.deepEqual((await service.layout()).columns.filter((column) => column.groupId === regrouped.id).map((column) => column.key), ['QD_LE_TRUC', 'QD_LE_NGHI', 'QD_LE_LAM_THEM']);
});
