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

async function fixture() {
  const pg = await PGlite.create();
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0000_init_khoi_tao.sql'), 'utf8'));
  for (const file of ['0005_them_danh_muc_chuc_danh.sql', '0025_bang_cham_cong_truc.sql', '0029_cau_hinh_bo_cuc_bang_cham_cong.sql', '0030_nhom_ky_hieu_cham_cong.sql', '0031_cong_thuc_nghiep_vu_cham_cong.sql', '0032_lich_nghi_le_nha_nuoc_theo_nam.sql', '0033_ngay_lam_bu_va_dieu_chinh_lich_le.sql', '0034_ma_nhan_vien_lien_thong.sql', '0035_lich_su_chuyen_khoa_cham_cong.sql', '0037_danh_muc_chuc_vu_va_thu_tu_cham_cong.sql', '0039_ghi_chu_cham_cong_theo_ngay.sql', '0040_nhieu_ky_hieu_cham_cong_trong_ngay.sql']) {
    await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', file), 'utf8'));
  }
  await pg.exec(`
    INSERT INTO departments (id, code, name, active) VALUES (10, 'A', 'Khoa A', true);
    INSERT INTO users (id, username, password_hash, full_name, department_id, active) VALUES
      (1, 'nv001', 'hash', 'Nhân viên Một', 10, true),
      (99, 'manager', 'hash', 'Quản lý', 10, true);
  `);
  const db = drizzle(pg, { schema });
  return { pg, service: new DutyAttendanceService({ db, transaction: db.transaction.bind(db) } as unknown as DbService) };
}

test('nghỉ bù phải tiêu thụ đúng một ca nguồn mới nhất, chặn lưu nguồn đã hết và vẫn dò qua tháng', async (t) => {
  const { pg, service } = await fixture();
  t.after(() => pg.close());
  await service.createCode({ code: 'NB', name: 'Nghỉ bù', group: 'OTHER', countValue: '1', calculationRole: 'REST', deductsWorkday: true, restSource: 'ANY_DUTY', sortOrder: 80, active: true });

  // Hai ca liên tiếp: NB đầu tiên phải lấy T 31/01, không để T 30/01 thành dự phòng cho NB sau.
  await service.save(actor, { departmentId: 10, entries: [
    { userId: 1, workDate: '2098-01-30', code: 'T' },
    { userId: 1, workDate: '2098-01-31', code: 'T' },
  ] });
  await service.save(actor, { departmentId: 10, entries: [{ userId: 1, workDate: '2098-02-02', code: 'NB' }] });
  const afterCrossMonthRest = await service.month(actor, { departmentId: 10, month: '2098-02' });
  assert.equal(afterCrossMonthRest.entries['1:2098-02-02']?.code, 'NB');
  assert.equal(afterCrossMonthRest.rowValues['1']?.SYS_NGHI_BU_CHUA_GAN, 0, 'NB tháng 2 phải ghép được ca cuối tháng 1');

  await assert.rejects(
    service.save(actor, { departmentId: 10, entries: [{ userId: 1, workDate: '2098-02-03', code: 'NB' }] }),
    /chưa có ca Trực\/Tăng cường hợp lệ chưa dùng.*không thể lưu/,
  );
  const afterRejectedRest = await service.month(actor, { departmentId: 10, month: '2098-02' });
  assert.equal(afterRejectedRest.entries['1:2098-02-03'], undefined, 'NB không hợp lệ phải bị từ chối trước khi ghi dữ liệu');

  // Ca nguồn và NB cùng một yêu cầu vẫn phải được xét theo trạng thái sau khi áp dụng yêu cầu.
  await service.save(actor, { departmentId: 10, entries: [
    { userId: 1, workDate: '2098-02-10', code: 'T' },
    { userId: 1, workDate: '2098-02-11', code: 'NB' },
  ] });
  const afterSameRequest = await service.month(actor, { departmentId: 10, month: '2098-02' });
  assert.equal(afterSameRequest.entries['1:2098-02-11']?.code, 'NB');
  assert.equal(afterSameRequest.rowValues['1']?.SYS_NGHI_BU_CHUA_GAN, 0);
});
