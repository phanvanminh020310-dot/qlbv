import "reflect-metadata";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { AccessContext } from "../src/common/types/access-context";
import * as schema from "../src/db/schema";
import { DutyCoreService } from "../src/modules/duty/duty-core.service";
import { DutyService } from "../src/modules/duty/duty.service";
import { RealtimeService } from "../src/modules/realtime/realtime.service";

const NOW = Date.parse("2026-10-15T07:30:00+07:00");

function manager(
  permissions: string[],
  departmentIds: number[],
  dataScope: AccessContext["dataScope"] = "DEPT",
): AccessContext {
  return {
    id: 90,
    username: "monitor_manager",
    fullName: "Điều phối trực",
    title: "Điều phối",
    departmentId: departmentIds[0] ?? null,
    departmentName: "Khoa fixture",
    roles: dataScope === "DEPT" ? ["NGUOI_XEP_LICH_TRUC_KHOA"] : ["DIEU_PHOI_TRUC"],
    permissions,
    departmentIds,
    dataScope,
    isSuperAdmin: false,
    sessionId: "fixture",
  };
}

test("live monitor shows only exact-active, published roster and preserves department scope", async (t) => {
  t.mock.method(Date, "now", () => NOW);
  const pg = await PGlite.create();
  t.after(() => pg.close());
  for (const file of [
    "0000_init_khoi_tao.sql",
    "0015_lich_truc.sql",
    "0016_lich_truc_xoa_ky.sql",
    "0017_lich_truc_mau_ca.sql",
    "0019_kiosk_duty_attendance.sql",
  ]) {
    await pg.exec(readFileSync(resolve(__dirname, "..", "drizzle", file), "utf8"));
  }

  await pg.exec(`
    INSERT INTO departments (id, code, name) VALUES (1, 'K1', 'Khoa Một'), (2, 'K2', 'Khoa Hai');
    INSERT INTO users (id, username, password_hash, full_name, title, department_id, active) VALUES
      (1, 'doctor_one', 'fixture', 'Bác sĩ Một', 'BS.', 1, true),
      (2, 'doctor_two', 'fixture', 'Bác sĩ Hai', 'BS.', 2, true);
    INSERT INTO duty_rooms (id, code, name, department_id, location) VALUES
      (1, 'PK01', 'Phòng khám 01', 1, 'Tầng 1'),
      (2, 'PK02', 'Phòng khám 02', 2, 'Tầng 2');
    INSERT INTO duty_roles (id, code, name) VALUES (1, 'BS', 'Bác sĩ khám');
    INSERT INTO duty_shift_types (id, code, name, start_time, end_time, crosses_midnight, color) VALUES
      (1, 'S', 'Ca sáng', '07:00', '11:00', false, '#0f766e'),
      (2, 'C', 'Ca chiều', '12:00', '17:00', false, '#0369a1');
    INSERT INTO duty_periods (id, name, start_date, end_date, status, lock_at) VALUES
      (1, 'Kỳ công bố', '2026-10-12', '2026-10-18', 'CONG_BO', '2026-10-19T00:00:00+07:00'),
      (2, 'Kỳ nháp', '2026-10-12', '2026-10-18', 'NHAP', '2026-10-19T00:00:00+07:00');
    INSERT INTO duty_slots (id, period_id, duty_date, room_id, shift_id, role_id, required_count) VALUES
      (1, 1, '2026-10-15', 1, 1, 1, 2),
      (2, 1, '2026-10-15', 2, 1, 1, 1),
      (3, 1, '2026-10-15', 1, 2, 1, 1),
      (4, 2, '2026-10-15', 1, 1, 1, 1);
    INSERT INTO duty_assignments (id, slot_id, user_id) VALUES (1, 1, 1), (2, 2, 2), (3, 3, 1), (4, 4, 1);
    INSERT INTO duty_attendance (id, slot_id, room_id, room_code, room_name, user_id, username, full_name, title, shift_code, shift_name, checkin_time, method) VALUES
      ('attendance-current', 1, 1, 'PK01', 'Phòng khám 01', 1, 'doctor_one', 'Bác sĩ Một', 'BS.', 'S', 'Ca sáng', '2026-10-15T07:20:00+07:00', 'AI_FACIAL_BIOMETRICS'),
      ('attendance-wrong-method', 2, 2, 'PK02', 'Phòng khám 02', 2, 'doctor_two', 'Bác sĩ Hai', 'BS.', 'S', 'Ca sáng', '2026-10-15T07:21:00+07:00', 'IT_EMERGENCY_PIN');
  `);

  const db = { db: drizzle(pg, { schema }) };
  const core = new DutyCoreService(
    db as any,
    { notify: async () => {} } as any,
    { publish: () => {} } as any,
  );
  const service = new DutyService(db as any, core, {} as any);

  const scoped = await service.liveMonitor(manager(["duty.view", "duty.manage"], [1]));
  assert.equal(scoped.scope, "DEPT");
  assert.deepEqual(scoped.summary, { rooms: 1, slots: 1, expected: 1, verified: 1, itOverrides: 0, pending: 0, unassigned: 1 });
  assert.equal(scoped.rooms[0]?.code, "PK01");
  assert.equal(scoped.rooms[0]?.slots[0]?.doctors[0]?.fullName, "Bác sĩ Một");
  assert.equal(scoped.rooms[0]?.slots[0]?.doctors[0]?.verified, true);
  assert.equal(scoped.rooms[0]?.slots[0]?.unassigned, 1);

  const all = await service.liveMonitor(manager(["duty.manage-all"], [], "ALL"));
  assert.equal(all.scope, "ALL");
  assert.equal(all.summary.rooms, 2, "only exact-active published slots are included");
  assert.equal(all.summary.expected, 2);
  assert.equal(all.summary.verified, 1, "PIN unlock never masquerades as biometric attendance");
  assert.equal(all.summary.itOverrides, 1, "PIN IT is exposed as a distinct technical event");
  assert.equal(all.summary.pending, 0, "the recorded IT event is not shown as a generic waiting state");
  const itDoctor = all.rooms.find((room) => room.code === "PK02")?.slots[0]?.doctors[0];
  assert.equal(itDoctor?.verified, false, "IT PIN must never set verified=true");
  assert.ok(itDoctor?.itOverrideAt, "monitor returns the IT event timestamp");
  assert.ok(!all.rooms.flatMap((room) => room.slots).some((slot) => slot.shiftCode === "C"), "future shift is excluded");

  await pg.exec("INSERT INTO duty_absences (user_id, start_date, end_date, reason) VALUES (2, '2026-10-15', '2026-10-15', 'OM_DAU')");
  const withApprovedAbsence = await service.liveMonitor(manager(["duty.manage-all"], [], "ALL"));
  assert.equal(withApprovedAbsence.summary.expected, 1, "approved absence is not treated as waiting for a biometric scan");
  assert.equal(withApprovedAbsence.summary.itOverrides, 0);
  assert.equal(withApprovedAbsence.summary.pending, 0);
  assert.equal(withApprovedAbsence.rooms.find((room) => room.code === "PK02")?.slots[0]?.doctors[0]?.absent, true);

  await assert.rejects(
    service.liveMonitor(manager(["duty.manage"], [])),
    /chưa được gán phạm vi khoa/,
  );

  // requiredCount là chỉ tiêu, nên không được gỡ người hoặc từ chối sửa khi
  // người xếp lịch chủ động để số người thực tế cao hơn chỉ tiêu.
  await pg.exec(`
    INSERT INTO users (id, username, password_hash, full_name, title, active)
    VALUES (90, 'monitor_manager', 'fixture', 'Điều phối trực', 'Điều phối', true);
    INSERT INTO duty_assignments (id, slot_id, user_id) VALUES (5, 1, 2);
  `);
  const loweredTarget = await service.updateSlot(
    manager(["duty.manage-all"], [], "ALL"),
    1,
    { requiredCount: 1 },
  );
  assert.equal(loweredTarget.requiredCount, 1);
  assert.equal(loweredTarget.filled, 2);
});


test("realtime attendance signal accepts either department manager permission and preserves department isolation", () => {
  const realtime = new RealtimeService();
  const allManagerEvents: string[] = [];
  const scopedManagerEvents: string[] = [];
  const otherDepartmentEvents: string[] = [];
  realtime.streamFor(manager(["duty.manage-all"], [], "ALL")).subscribe((event) => allManagerEvents.push(event.type));
  realtime.streamFor(manager(["duty.manage"], [1])).subscribe((event) => scopedManagerEvents.push(event.type));
  realtime.streamFor(manager(["duty.manage"], [2])).subscribe((event) => otherDepartmentEvents.push(event.type));
  realtime.publish({
    topic: "duty-attendance",
    type: "verified",
    permissions: ["duty.manage", "duty.manage-all"],
    departmentId: 1,
  });
  assert.deepEqual(allManagerEvents, ["verified"]);
  assert.deepEqual(scopedManagerEvents, ["verified"]);
  assert.deepEqual(otherDepartmentEvents, []);
});
