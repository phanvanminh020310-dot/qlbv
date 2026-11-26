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

const actor: AccessContext = {
  id: 99, username: 'manager', fullName: 'Quản lý', title: '', departmentId: 10, departmentName: 'Khoa A',
  roles: ['NHAP_CHAM_CONG_TRUC_KHOA'], permissions: ['duty-attendance.view', 'duty-attendance.update'],
  dataScope: 'DEPT', departmentIds: [10], isSuperAdmin: false, sessionId: 'test',
};
const actorB: AccessContext = { ...actor, id: 98, username: 'manager-b', departmentId: 20, departmentName: 'Khoa B', departmentIds: [20] };

async function fixture() {
  const pg = await PGlite.create();
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0000_init_khoi_tao.sql'), 'utf8'));
  for (const file of ['0005_them_danh_muc_chuc_danh.sql', '0025_bang_cham_cong_truc.sql', '0029_cau_hinh_bo_cuc_bang_cham_cong.sql', '0030_nhom_ky_hieu_cham_cong.sql', '0031_cong_thuc_nghiep_vu_cham_cong.sql', '0032_lich_nghi_le_nha_nuoc_theo_nam.sql', '0033_ngay_lam_bu_va_dieu_chinh_lich_le.sql', '0034_ma_nhan_vien_lien_thong.sql', '0035_lich_su_chuyen_khoa_cham_cong.sql', '0037_danh_muc_chuc_vu_va_thu_tu_cham_cong.sql', '0039_ghi_chu_cham_cong_theo_ngay.sql', '0040_nhieu_ky_hieu_cham_cong_trong_ngay.sql', '0047_nhom_tieu_de_cot_cham_cong.sql', '0047_nhom_tieu_de_cot_cham_cong.sql']) {
    await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', file), 'utf8'));
  }
  await pg.exec(`
    INSERT INTO departments (id, code, name, active) VALUES (10, 'A', 'Khoa A', true), (20, 'B', 'Khoa B', true);
    INSERT INTO users (id, username, password_hash, full_name, department_id, active) VALUES
      (1, 'nv001', 'hash', 'Nhân viên Một', 20, true),
      (98, 'manager-b', 'hash', 'Quản lý B', 20, true),
      (99, 'manager', 'hash', 'Quản lý', 10, true);
    -- Nhân viên 1 làm ở Khoa A đến hết tháng 2/2098 rồi chuyển sang Khoa B.
    INSERT INTO duty_attendance_department_assignments (user_id, department_id, effective_from) VALUES
      (1, 10, DATE '1900-01-01'), (1, 20, DATE '2098-03-01');
  `);
  const db = drizzle(pg, { schema });
  return { pg, service: new DutyAttendanceService({ db, transaction: db.transaction.bind(db) } as unknown as DbService) };
}

async function withRestCodes(service: DutyAttendanceService) {
  await service.createCode({ code: 'NB', name: 'Nghỉ bù', group: 'OTHER', countValue: '1', calculationRole: 'REST', deductsWorkday: true, restSource: 'ANY_DUTY', sortOrder: 80, active: true });
  await service.createCode({ code: 'NB2', name: 'Nghỉ bù nửa ngày', group: 'OTHER', countValue: '0.5', calculationRole: 'REST', deductsWorkday: true, restSource: 'ANY_DUTY', sortOrder: 81, active: true });
}

test('nghỉ bù theo số lượng tích lũy: ngày bất kỳ, tổng nghỉ ≤ tổng Trực, Tăng cường không được tính', async (t) => {
  const { pg, service } = await fixture();
  t.after(() => pg.close());
  await withRestCodes(service);

  await service.save(actor, { departmentId: 10, entries: [
    { userId: 1, workDate: '2098-01-05', code: 'T' },
    { userId: 1, workDate: '2098-01-06', code: 'T' },
    { userId: 1, workDate: '2098-01-07', code: 'TC' },
  ] });
  // Nghỉ cách ca Trực rất xa và cả trước ca Trực đều hợp lệ, miễn không vượt tổng.
  await service.save(actor, { departmentId: 10, entries: [{ userId: 1, workDate: '2098-02-27', code: 'NB' }] });
  await service.save(actor, { departmentId: 10, entries: [{ userId: 1, workDate: '2098-01-02', code: 'NB2' }] });
  let board = await service.month(actor, { departmentId: 10, month: '2098-02' });
  assert.equal(board.rowValues['1']?.SYS_CON_DUOC_BU, 0.5);
  assert.equal(board.rowValues['1']?.SYS_TRUC_TICH_LUY, 2, 'TC không được cộng vào số Trực');
  assert.equal(board.rowValues['1']?.SYS_NGHI_BU_TICH_LUY, 1.5);

  // Thêm NB đủ 1 ngày sẽ làm tổng nghỉ 2,5 > 2 → chặn và không ghi gì.
  await assert.rejects(
    service.save(actor, { departmentId: 10, entries: [{ userId: 1, workDate: '2098-02-26', code: 'NB' }] }),
    /tổng nghỉ bù tích lũy \(2,5\) sẽ vượt tổng ca Trực tích lũy \(2\).*còn được nghỉ bù 0,5 ngày/,
  );
  board = await service.month(actor, { departmentId: 10, month: '2098-02' });
  assert.equal(board.entries['1:2098-02-26'], undefined, 'yêu cầu bị chặn không được lưu một phần');
  // Đúng bằng số Trực (≤) vẫn được lưu.
  await service.save(actor, { departmentId: 10, entries: [{ userId: 1, workDate: '2098-02-26', code: 'NB2' }] });
  board = await service.month(actor, { departmentId: 10, month: '2098-02' });
  assert.equal(board.rowValues['1']?.SYS_CON_DUOC_BU, 0);
  assert.deepEqual(board.calculationWarnings, {});

  // Ca Trực và nghỉ bù trong cùng một yêu cầu được xét theo trạng thái sau khi áp dụng.
  await service.save(actor, { departmentId: 10, entries: [
    { userId: 1, workDate: '2098-02-10', codes: ['T'] },
    { userId: 1, workDate: '2098-02-11', codes: ['NB'] },
  ] });
  board = await service.month(actor, { departmentId: 10, month: '2098-02' });
  assert.equal(board.entries['1:2098-02-11']?.code, 'NB');
  assert.equal(board.rowValues['1']?.SYS_CON_DUOC_BU, 0);
});

test('xóa/sửa ca Trực cũ làm nghỉ bù vượt Trực bị chặn; bỏ nghỉ bù trước thì được', async (t) => {
  const { pg, service } = await fixture();
  t.after(() => pg.close());
  await withRestCodes(service);
  await service.save(actor, { departmentId: 10, entries: [
    { userId: 1, workDate: '2098-01-05', code: 'T' },
    { userId: 1, workDate: '2098-01-08', code: 'NB' },
  ] });

  await assert.rejects(service.save(actor, { departmentId: 10, entries: [{ userId: 1, workDate: '2098-01-05', codes: [] }] }), /vượt tổng ca Trực tích lũy/);
  await assert.rejects(service.save(actor, { departmentId: 10, entries: [{ userId: 1, workDate: '2098-01-05', codes: ['TC'] }] }), /vượt tổng ca Trực tích lũy/, 'đổi Trực thành Tăng cường cũng làm giảm số Trực');
  // Sửa ô Trực mà vẫn giữ T (thêm ký hiệu khác) không ảnh hưởng số dư.
  await service.save(actor, { departmentId: 10, entries: [{ userId: 1, workDate: '2098-01-05', codes: ['T', 'TC'] }] });

  await service.save(actor, { departmentId: 10, entries: [{ userId: 1, workDate: '2098-01-08', codes: [] }] });
  await service.save(actor, { departmentId: 10, entries: [{ userId: 1, workDate: '2098-01-05', codes: [] }] });
  const board = await service.month(actor, { departmentId: 10, month: '2098-01' });
  assert.equal(board.entries['1:2098-01-05'], undefined);
  assert.equal(board.rowValues['1']?.SYS_CON_DUOC_BU, 0);
});

test('số dư nghỉ bù đi theo nhân viên khi chuyển khoa', async (t) => {
  const { pg, service } = await fixture();
  t.after(() => pg.close());
  await withRestCodes(service);
  await service.save(actor, { departmentId: 10, entries: [
    { userId: 1, workDate: '2098-02-20', code: 'T' },
    { userId: 1, workDate: '2098-02-21', code: 'T' },
  ] });

  // Sang Khoa B vẫn được nghỉ bù theo số Trực đã làm ở Khoa A.
  await service.save(actorB, { departmentId: 20, entries: [
    { userId: 1, workDate: '2098-03-03', code: 'NB' },
    { userId: 1, workDate: '2098-03-04', code: 'NB2' },
  ] });
  const boardB = await service.month(actorB, { departmentId: 20, month: '2098-03' });
  assert.equal(boardB.rowValues['1']?.SYS_TRUC_NGAY_THUONG, 0, 'số liệu tháng của Khoa B không cộng ca ở Khoa A');
  assert.equal(boardB.rowValues['1']?.SYS_NGHI_TRUC_NGAY_THUONG, 1.5, 'nghỉ bù ở Khoa B được phân loại theo ca Trực ngày thường ở Khoa A');
  assert.equal(boardB.rowValues['1']?.SYS_CON_DUOC_BU, 0.5);
  await assert.rejects(service.save(actorB, { departmentId: 20, entries: [{ userId: 1, workDate: '2098-03-05', code: 'NB' }] }), /vượt tổng ca Trực tích lũy/);

  // Khoa A cũng không thể xóa ca Trực cũ khi nghỉ bù ở Khoa B đang dựa vào nó.
  await assert.rejects(service.save(actor, { departmentId: 10, entries: [{ userId: 1, workDate: '2098-02-21', codes: [] }] }), /vượt tổng ca Trực tích lũy/);
  const boardA = await service.month(actor, { departmentId: 10, month: '2098-02' });
  assert.equal(boardA.rowValues['1']?.SYS_CON_DUOC_BU, 0.5, 'bảng Khoa A hiển thị cùng một số dư theo người');
});
