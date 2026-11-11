import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { DbService } from '../src/db/db.service';
import * as schema from '../src/db/schema';
import { DutyAttendanceService } from '../src/modules/duty-attendance/duty-attendance.service';

test('nhóm ký hiệu có mã/tên Việt, bảo toàn nhóm cũ và chỉ cho ký hiệu chọn nhóm đang dùng', async (t) => {
  const pg = await PGlite.create(); t.after(() => pg.close());
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0000_init_khoi_tao.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0025_bang_cham_cong_truc.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0029_cau_hinh_bo_cuc_bang_cham_cong.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0030_nhom_ky_hieu_cham_cong.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0031_cong_thuc_nghiep_vu_cham_cong.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0032_lich_nghi_le_nha_nuoc_theo_nam.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0033_ngay_lam_bu_va_dieu_chinh_lich_le.sql'), 'utf8'));
  const db = drizzle(pg, { schema }); const service = new DutyAttendanceService({ db, transaction: db.transaction.bind(db) } as unknown as DbService);

  const initial = await service.codeGroups();
  assert.equal(initial.find((group) => group.code === 'DUTY')?.name, 'Trực');
  assert.equal(initial.find((group) => group.code === 'OTHER')?.name, 'Khác');
  const extra = await service.createCodeGroup({ code: 'BO_SUNG', name: 'Bổ sung', sortOrder: 80, active: true });
  const code = await service.createCode({ code: 'BS', name: 'Bổ sung', group: 'BO_SUNG', countValue: '0.5', sortOrder: 80, active: true });
  assert.equal(code.group, 'BO_SUNG');
  await assert.rejects(service.deleteCodeGroup(extra.id), /đang được sử dụng/);
  await assert.rejects(service.createCode({ code: 'SAI', name: 'Sai', group: 'KHONG_CO', countValue: '1', sortOrder: 90, active: true }), /không tồn tại/);
  await assert.rejects(service.createCode({ code: 'SYS_NGAY_CONG', name: 'Trùng biến hệ thống', group: 'OTHER', countValue: '1', sortOrder: 90, active: true }), /dành cho biến công thức nghiệp vụ/);
});
