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

const user: AccessContext = {
  id: 99, username: 'manager', fullName: 'Quản lý', title: '', departmentId: 10, departmentName: 'Khoa A', roles: ['NHAP_CHAM_CONG_TRUC_KHOA'],
  permissions: ['duty-attendance.view', 'duty-attendance.update', 'duty-attendance.catalog.manage'], dataScope: 'DEPT', departmentIds: [10], isSuperAdmin: false, sessionId: 'test',
};

async function setup() {
  const pg = await PGlite.create();
  for (const file of ['0000_init_khoi_tao.sql', '0025_bang_cham_cong_truc.sql', '0029_cau_hinh_bo_cuc_bang_cham_cong.sql', '0030_nhom_ky_hieu_cham_cong.sql', '0031_cong_thuc_nghiep_vu_cham_cong.sql', '0032_lich_nghi_le_nha_nuoc_theo_nam.sql', '0033_ngay_lam_bu_va_dieu_chinh_lich_le.sql']) {
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

const plan2026 = { year: 2026, tetStartOffset: -2, tetDayCount: 5, nationalDayAdjacent: 'AFTER' as const, compensateWeeklyRest: true, additionalRestDays: [], compensatoryWorkdays: [], note: 'Đã rà soát quyết định năm 2026' };

test('lịch lễ Nhà nước chỉ xem trước khi chưa áp dụng, giữ ngày bệnh viện và có thể chạy lại an toàn', async (t) => {
  const { pg, service } = await setup(); t.after(() => pg.close());
  await service.saveHoliday(user, { holidayDate: '2026-04-30', name: 'Lễ bệnh viện đã xác nhận', note: 'Không được ghi đè' });
  const preview = await service.previewNationalHolidayPlan(plan2026);
  assert.ok(preview.candidates.length >= 11);
  assert.equal((await service.holidays({ month: '2026-04' })).length, 1, 'xem dự thảo không tự ghi dữ liệu');

  const firstApply = await service.applyNationalHolidayPlan(user, plan2026);
  assert.ok(firstApply.added > 0);
  assert.equal(firstApply.preservedHospital, 1, 'ngày bệnh viện khai báo trùng mốc Nhà nước phải được giữ');
  const april = await service.holidays({ month: '2026-04' });
  assert.deepEqual(april.find((holiday) => holiday.holidayDate === '2026-04-30') && { name: april.find((holiday) => holiday.holidayDate === '2026-04-30')!.name, source: april.find((holiday) => holiday.holidayDate === '2026-04-30')!.source }, { name: 'Lễ bệnh viện đã xác nhận', source: 'HOSPITAL' });
  const may = await service.holidays({ month: '2026-05' });
  assert.equal(may.find((holiday) => holiday.holidayDate === '2026-05-01')?.source, 'NATIONAL_TEMPLATE');

  const rerun = await service.applyNationalHolidayPlan(user, plan2026);
  assert.equal(rerun.added, 0, 'áp dụng cùng phương án lần hai không nhân bản ngày nghỉ');
  assert.ok(rerun.unchanged > 0);

  // Khi cán bộ sửa một ngày sinh tự động, ngày đó thành cấu hình bệnh viện và các lần sinh sau không ghi đè.
  await service.saveHoliday(user, { holidayDate: '2026-05-01', name: 'Lịch trực bệnh viện nghỉ riêng', note: 'Đã chốt nội bộ' });
  const afterOverride = await service.applyNationalHolidayPlan(user, { ...plan2026, nationalDayAdjacent: 'BEFORE' });
  assert.ok(afterOverride.preservedHospital >= 2);
  assert.ok((afterOverride.removed ?? 0) >= 1, 'đổi phương án phải gỡ dòng lịch mẫu Quốc khánh cũ không còn thuộc dự thảo');
  assert.equal((await service.holidays({ month: '2026-05' })).find((holiday) => holiday.holidayDate === '2026-05-01')?.name, 'Lịch trực bệnh viện nghỉ riêng');
  const september = await service.holidays({ month: '2026-09' });
  assert.equal(september.some((holiday) => holiday.holidayDate === '2026-09-03'), false, 'chỉ dòng NATIONAL_TEMPLATE cũ 03/09 được gỡ');
  assert.equal(september.find((holiday) => holiday.holidayDate === '2026-09-01')?.source, 'NATIONAL_TEMPLATE');
});

test('ngày lễ áp dụng từ lịch mẫu đi vào tính công và phân loại trực ngày lễ', async (t) => {
  const { pg, service } = await setup(); t.after(() => pg.close());
  await service.applyNationalHolidayPlan(user, plan2026);
  await service.save(user, { departmentId: 10, entries: [{ userId: 1, workDate: '2026-05-01', code: 'T' }] });
  const board = await service.month(user, { departmentId: 10, month: '2026-05' });
  assert.equal(board.dates.find((day) => day.date === '2026-05-01')?.holidayName, 'Ngày Quốc tế Lao động');
  assert.equal(board.rowValues['1']?.SYS_TRUC_NGAY_LE, 1);
  assert.equal(board.rowValues['1']?.SYS_NGAY_CONG, 20, 'tháng 5/2026 có 21 ngày thường, trừ ngày lễ 01/05');
});

test('phương án năm có ngày nghỉ bổ sung và ngày làm bù, có thể điều chỉnh/gỡ an toàn và tôn trọng hoán đổi của bệnh viện', async (t) => {
  const { pg, service } = await setup(); t.after(() => pg.close());
  const adjustedPlan = {
    ...plan2026,
    compensateWeeklyRest: false,
    additionalRestDays: [{ date: '2026-02-23', name: 'Nghỉ kéo dài theo thông báo', note: 'QĐ thử nghiệm' }],
    compensatoryWorkdays: [{ date: '2026-02-21', name: 'Làm bù sau kỳ nghỉ', note: 'QĐ thử nghiệm' }],
  };
  const preview = await service.previewNationalHolidayPlan(adjustedPlan);
  assert.equal(preview.candidates.find((item) => item.date === '2026-02-23')?.kind, 'APPROVED_ADJUSTMENT');
  assert.equal(preview.workdayCandidates.find((item) => item.date === '2026-02-21')?.kind, 'COMPENSATORY_WORKDAY');

  const first = await service.applyNationalHolidayPlan(user, adjustedPlan);
  assert.equal(first.addedWorkdays, 1);
  assert.equal((await service.workdayOverrides({ month: '2026-02' })).find((item) => item.workDate === '2026-02-21')?.source, 'NATIONAL_TEMPLATE');
  await service.save(user, { departmentId: 10, entries: [{ userId: 1, workDate: '2026-02-21', code: 'T' }] });
  const february = await service.month(user, { departmentId: 10, month: '2026-02' });
  assert.equal(february.dates.find((day) => day.date === '2026-02-21')?.isWorkingOverride, true);
  assert.equal(february.rowValues['1']?.SYS_TRUC_NGAY_THUONG, 1, 'trực ngày làm bù được tính như ngày thường');
  assert.equal(february.rowValues['1']?.SYS_NGAY_CONG, 16, 'ngày làm bù tăng Ngày công; ngày nghỉ bổ sung làm giảm Ngày công');

  const reconciled = await service.applyNationalHolidayPlan(user, { ...plan2026, compensateWeeklyRest: false });
  assert.equal(reconciled.removed, 1, 'bỏ ngày nghỉ bổ sung chỉ gỡ dòng NATIONAL_TEMPLATE cũ');
  assert.equal(reconciled.removedWorkdays, 1, 'bỏ ngày làm bù chỉ gỡ dòng NATIONAL_TEMPLATE cũ');
  assert.equal((await service.workdayOverrides({ month: '2026-02' })).some((item) => item.workDate === '2026-02-21'), false);

  await service.saveWorkdayOverride(user, { workDate: '2026-03-08', name: 'Làm việc thay ngày nghỉ nội bộ', note: 'Kế hoạch khoa' });
  await assert.rejects(() => service.saveHoliday(user, { holidayDate: '2026-03-08', name: 'Không được ghi đè âm thầm', note: '' }), /ngày làm việc do bệnh viện khai báo/);
  const march = await service.month(user, { departmentId: 10, month: '2026-03' });
  assert.equal(march.dates.find((day) => day.date === '2026-03-08')?.isWorkingOverride, true);
  assert.equal(march.rowValues['1']?.SYS_NGAY_CONG, 23, 'Chủ nhật được bệnh viện khai báo làm việc phải được tính thêm Ngày công');
});
