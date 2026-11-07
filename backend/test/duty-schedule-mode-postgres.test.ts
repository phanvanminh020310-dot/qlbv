import "reflect-metadata";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../src/db/schema";
import { DutyCoreService } from "../src/modules/duty/duty-core.service";
import { DutyRequestService } from "../src/modules/duty/duty-request.service";
import { DutyService } from "../src/modules/duty/duty.service";

const migration = (name: string) => readFileSync(resolve(__dirname, "..", "drizzle", name), "utf8");

const scheduler = {
  id: 1,
  username: "scheduler_fixture",
  fullName: "Người xếp lịch khoa",
  permissions: ["duty.manage"],
  roles: ["NGUOI_XEP_LICH_TRUC_KHOA"],
  departmentId: 1,
  departmentIds: [1],
  dataScope: "DEPT",
};
const khth = {
  id: 2,
  username: "khth_fixture",
  fullName: "Điều phối KHTH",
  permissions: ["duty.exception.resolve"],
  roles: [],
  departmentId: null,
  departmentIds: [],
  dataScope: "ALL",
};

test("PostgreSQL: Theo buổi and Hành chính are exclusive, switch is explicit, and KHTH approval replaces atomically", async (t) => {
  const pg = await PGlite.create();
  t.after(() => pg.close());
  for (const file of ["0000_init_khoi_tao.sql", "0015_lich_truc.sql"]) await pg.exec(migration(file));
  await pg.exec("INSERT INTO duty_shift_types (id, code, name, start_time, end_time, crosses_midnight) VALUES (99, 'hanhchinh', 'Ca hành chính cũ', '07:00', '17:00', false)");
  await pg.exec(migration("0028_ca_kham_theo_buoi_hoac_ca_ngay.sql"));
  const hcMode = await pg.query<{ schedule_mode: string }>("select schedule_mode from duty_shift_types where id = 99");
  assert.deepEqual(hcMode.rows, [{ schedule_mode: "CA_NGAY" }], "migration recognises an existing Hành chính catalogue entry once, without data reset");

  await pg.exec(`
    INSERT INTO departments (id, code, name) VALUES (1, 'K1', 'Khoa 1');
    INSERT INTO users (id, username, password_hash, full_name, title, department_id) VALUES
      (1, 'scheduler_fixture', 'fixture', 'Người xếp lịch khoa', 'BS.', 1),
      (2, 'khth_fixture', 'fixture', 'Điều phối KHTH', 'KHTH', 1),
      (3, 'doctor_old', 'fixture', 'Bác sĩ cũ', 'BS.', 1),
      (4, 'doctor_new', 'fixture', 'Bác sĩ thay', 'BS.', 1);
    INSERT INTO duty_rooms (id, code, name) VALUES (1, 'PK1', 'Phòng khám 1');
    INSERT INTO duty_shift_types (id, code, name, start_time, end_time, crosses_midnight, schedule_mode) VALUES
      (1, 'S', 'Ca sáng', '07:00', '11:30', false, 'THEO_BUOI'),
      (2, 'C', 'Ca chiều', '13:00', '17:00', false, 'THEO_BUOI'),
      (3, 'HC', 'Hành chính cả ngày', '07:00', '17:00', false, 'CA_NGAY');
    INSERT INTO duty_roles (id, code, name) VALUES (1, 'BS', 'Bác sĩ khám');
    INSERT INTO duty_periods (id, name, start_date, end_date, status, lock_at) VALUES
      (1, 'Kỳ nháp theo buổi', '2027-01-04', '2027-01-10', 'NHAP', '2027-01-03T17:00:00+07:00'),
      (2, 'Kỳ KHTH duyệt', '2027-02-01', '2027-02-07', 'CONG_BO', '2027-01-31T17:00:00+07:00');
  `);

  const database = { db: drizzle(pg, { schema }) };
  const core = new DutyCoreService(database as any, { notify: async () => {} } as any, { publish: () => {} } as any);
  // Notifications are not part of the transactional contract tested below.
  (core as any).holderIds = async () => [];
  const duty = new DutyService(database as any, core, {} as any);
  const requests = new DutyRequestService(database as any, core, duty);

  await duty.createSlot(scheduler as any, 1, { dutyDate: "2027-01-05", roomId: 1, shiftId: 1, roleId: 1 });
  await duty.createSlot(scheduler as any, 1, { dutyDate: "2027-01-05", roomId: 1, shiftId: 2, roleId: 1 });
  await assert.rejects(
    duty.createSlot(scheduler as any, 1, { dutyDate: "2027-01-05", roomId: 1, shiftId: 3, roleId: 1 }),
    /Đổi sang ca Hành chính\? Lịch Sáng và Chiều sẽ bị xóa/,
    "adding Hành chính never silently leaves Sáng/Chiều behind",
  );
  await assert.rejects(
    duty.generateSlots(scheduler as any, 1, { roomIds: [1], shiftIds: [1, 3], roleIds: [1], weekdays: [2] }),
    /không chọn đồng thời hai cách xếp/,
    "bulk generation cannot be used to recreate the forbidden combination",
  );

  const toDay = await duty.switchSlotMode(scheduler as any, 1, {
    dutyDate: "2027-01-05", roomId: 1, roleId: 1, shiftIds: [3], confirm: true,
  });
  assert.equal(toDay.removed, 2);
  const dayMode = await pg.query<{ code: string; schedule_mode: string }>(`
    SELECT st.code, st.schedule_mode FROM duty_slots s JOIN duty_shift_types st ON st.id = s.shift_id
    WHERE s.period_id = 1 AND s.duty_date = '2027-01-05' ORDER BY st.id
  `);
  assert.deepEqual(dayMode.rows, [{ code: "HC", schedule_mode: "CA_NGAY" }]);

  const toParts = await duty.switchSlotMode(scheduler as any, 1, {
    dutyDate: "2027-01-05", roomId: 1, roleId: 1, shiftIds: [1], confirm: true,
  });
  assert.equal(toParts.removed, 1, "choosing Sáng restores the complete Theo buổi layout, including Chiều");
  const partMode = await pg.query<{ code: string; schedule_mode: string }>(`
    SELECT st.code, st.schedule_mode FROM duty_slots s JOIN duty_shift_types st ON st.id = s.shift_id
    WHERE s.period_id = 1 AND s.duty_date = '2027-01-05' ORDER BY st.id
  `);
  assert.deepEqual(partMode.rows, [
    { code: "S", schedule_mode: "THEO_BUOI" },
    { code: "C", schedule_mode: "THEO_BUOI" },
  ]);
  // Reproduce a period generated by the former logic: all three slots already exist.
  // Normalising to Hành chính preserves the selected Hành chính slot and only removes its opposite layout.
  await pg.exec("INSERT INTO duty_slots (period_id, duty_date, room_id, shift_id, role_id) VALUES (1, '2027-01-05', 1, 3, 1)");
  const legacyCleanup = await duty.switchSlotMode(scheduler as any, 1, {
    dutyDate: "2027-01-05", roomId: 1, roleId: 1, shiftIds: [3], confirm: true,
  });
  assert.deepEqual(legacyCleanup, { removed: 2, affectedAssignments: 0, created: 0 });
  const normalized = await pg.query<{ code: string }>(`
    SELECT st.code FROM duty_slots s JOIN duty_shift_types st ON st.id = s.shift_id
    WHERE s.period_id = 1 AND s.duty_date = '2027-01-05'
  `);
  assert.deepEqual(normalized.rows, [{ code: "HC" }], "an old three-shift layout can be explicitly normalised without deleting the chosen layout");

  await pg.exec(`
    INSERT INTO duty_slots (id, period_id, duty_date, room_id, shift_id, role_id) VALUES (20, 2, '2027-02-02', 1, 1, 1);
    INSERT INTO duty_assignments (slot_id, user_id, source, created_by) VALUES (20, 3, 'PHAN_CONG', 1);
  `);
  const created = await requests.createDepartmentChange(scheduler as any, {
    slotId: 20, targetUserId: 3, replacementUserId: 4, reason: "Bác sĩ cũ đi công tác theo quyết định khoa",
  });
  assert.equal(created.status, "CHO_DUYET");
  await requests.approve(khth as any, created.id, {});
  const assignment = await pg.query<{ user_id: number }>("select user_id from duty_assignments where slot_id = 20 order by user_id");
  assert.deepEqual(assignment.rows, [{ user_id: 4 }], "approval removes the selected doctor and inserts the proposed replacement in one transaction");
  const request = await pg.query<{ status: string; replacement_user_id: number }>("select status, replacement_user_id from duty_requests where id = $1", [created.id]);
  assert.deepEqual(request.rows, [{ status: "DA_DUYET", replacement_user_id: 4 }]);
  const history = await duty.adjustmentHistory(khth as any, { periodId: 2 });
  assert.equal(history.length, 1, "an approved KHTH replacement appears in the adjustment-history report, not only in the request list");
  assert.equal(history[0].removedName, "Bác sĩ cũ");
  assert.equal(history[0].addedName, "Bác sĩ thay");
});
