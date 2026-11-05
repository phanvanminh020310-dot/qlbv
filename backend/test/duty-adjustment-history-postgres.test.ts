/** Durable KHTH direct-adjustment history/reporting over the real PostgreSQL schema (PGlite). */
import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as ExcelJS from "exceljs";
import * as schema from "../src/db/schema";
import { DutyService } from "../src/modules/duty/duty.service";
import { DutyCoreService } from "../src/modules/duty/duty-core.service";
import { DutyRequestService } from "../src/modules/duty/duty-request.service";

const migration = (name: string) => readFileSync(resolve(__dirname, "..", "drizzle", name), "utf8");
const khth = {
  id: 9001,
  username: "khth_fixture",
  fullName: "Điều phối KHTH",
  permissions: ["duty.exception.resolve"],
};

test("PostgreSQL: direct doctor adjustments remain reportable and exportable after roster changes", async (t) => {
  const pg = await PGlite.create();
  t.after(() => pg.close());
  for (const file of [
    "0000_init_khoi_tao.sql",
    "0015_lich_truc.sql",
    "0027_lich_su_dieu_chinh_bac_si_kham.sql",
  ]) await pg.exec(migration(file));
  // The reporting index migration is deliberately safe for one-command retries.
  await pg.exec(migration("0027_lich_su_dieu_chinh_bac_si_kham.sql"));

  await pg.exec(`
    INSERT INTO users (id, username, password_hash, full_name, title) VALUES
      (9001, 'khth_fixture', 'fixture', 'Điều phối KHTH', 'KHTH'),
      (9002, 'doctor_removed', 'fixture', 'Bác sĩ được gỡ', 'BS.'),
      (9003, 'doctor_added', 'fixture', 'Bác sĩ được xếp', 'BS.');
    INSERT INTO duty_rooms (id, code, name) VALUES (9001, 'PK-HS', 'Phòng khám Lịch sử');
    INSERT INTO duty_shift_types (id, code, name, start_time, end_time, crosses_midnight) VALUES
      (9001, 'S-HS', 'Ca sáng lịch sử', '07:00', '11:00', false);
    INSERT INTO duty_roles (id, code, name) VALUES (9001, 'BS-HS', 'Bác sĩ khám');
    INSERT INTO duty_periods (id, name, start_date, end_date, status, lock_at) VALUES
      (9001, 'Kỳ báo cáo fixture', '2026-11-02', '2026-11-08', 'DA_CHOT', '2026-11-01T17:00:00+07:00');
    INSERT INTO duty_slots (id, period_id, duty_date, room_id, shift_id, role_id) VALUES
      (9001, 9001, '2026-11-04', 9001, 9001, 9001);
    INSERT INTO duty_logs (period_id, slot_id, action, actor_id, user_id, reason, detail, created_at) VALUES
      (9001, 9001, 'OVERRIDE', 9001, 9003, 'BS cũ nghỉ đột xuất, KHTH đổi người khám',
       '{"removed":9002,"added":9003,"forced":true,"violations":["Trùng lịch đã được lãnh đạo chấp thuận"],"room":"PK-HS","shift":"S-HS","date":"2026-11-04"}'::jsonb,
       '2026-11-03T02:15:00Z'),
      (9001, NULL, 'OVERRIDE', 9001, 9003, 'Lưu lịch sử ngay cả khi ô ca đã bị xoá',
       '{"removed":9002,"removedName":"Bác sĩ được gỡ","added":9003,"addedName":"Bác sĩ được xếp","actorName":"Điều phối KHTH","periodName":"Kỳ báo cáo fixture","room":"PK-DA-XOA","roomName":"Phòng đã xoá","shift":"C-XOA","shiftName":"Ca đã xoá","startTime":"13:00","endTime":"17:00","roleName":"Bác sĩ khám","date":"2026-11-05","forced":false,"violations":[]}'::jsonb,
       '2026-11-04T02:15:00Z'),
      (9001, 9001, 'ASSIGN', 9001, 9003, '', '{}'::jsonb, '2026-11-04T03:00:00Z');
  `);

  const database = { db: drizzle(pg, { schema }) };
  const service = new DutyService(
    database as any,
    { hasPerm: (user: any, permission: string) => user.permissions?.includes(permission) } as any,
    {} as any,
  );

  const rows = await service.adjustmentHistory(khth as any, { periodId: 9001 });
  assert.equal(rows.length, 2, "only OVERRIDE entries are included; ordinary assignment logs stay out of this report");
  assert.equal(rows[0].roomCode, "PK-DA-XOA", "snapshot preserves a deleted slot's room identity");
  assert.equal(rows[0].removedName, "Bác sĩ được gỡ");
  assert.equal(rows[0].addedName, "Bác sĩ được xếp");
  assert.equal(rows[1].roomCode, "PK-HS");
  assert.equal(rows[1].actorName, "Điều phối KHTH");
  assert.equal(rows[1].forced, true);
  assert.deepEqual(rows[1].violations, ["Trùng lịch đã được lãnh đạo chấp thuận"]);

  const bounded = await service.adjustmentHistory(khth as any, { from: "2026-11-04", to: "2026-11-04" });
  assert.equal(bounded.length, 1, "Vietnam-date range filters report events deterministically");
  assert.equal(bounded[0].roomCode, "PK-DA-XOA");
  await assert.rejects(
    service.adjustmentHistory({ ...khth, permissions: [] } as any),
    /Chỉ Điều phối lịch khám/,
  );

  const exported = await service.exportAdjustmentHistory(khth as any, { periodId: 9001 });
  assert.match(exported.fileName, /^lich-su-dieu-chinh-bac-si-kham-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(exported.buffer as any);
  const sheet = workbook.getWorksheet("Lịch sử điều chỉnh");
  assert.ok(sheet, "report contains a dedicated, named worksheet");
  assert.equal(sheet!.getCell("A1").value, "LỊCH SỬ ĐIỀU CHỈNH TRỰC TIẾP BÁC SĨ KHÁM");
  assert.equal(sheet!.getCell("H4").value, "Bác sĩ được gỡ");
  assert.equal(sheet!.getCell("I4").value, "Bác sĩ được xếp");
  assert.equal(sheet!.getCell("K5").value, "Có", "forced adjustments are explicit in Excel");

  // Exercise the production direct-adjustment path itself: its new snapshot is
  // what guarantees future reports survive slot/user changes, not merely a UI-only projection.
  await pg.exec("INSERT INTO duty_assignments (slot_id, user_id, source, created_by) VALUES (9001, 9002, 'PHAN_CONG', 9001)");
  const core = new DutyCoreService(
    database as any,
    { notify: async () => {} } as any,
    { publish: () => {} } as any,
  );
  const operationalDuty = new DutyService(database as any, core, {} as any);
  const requests = new DutyRequestService(database as any, core, operationalDuty);
  await requests.override(khth as any, {
    slotId: 9001,
    removeUserId: 9002,
    addUserId: 9003,
    reason: "KHTH điều chỉnh bác sĩ cho báo cáo lịch sử",
    force: true,
  });
  const latest = (await operationalDuty.adjustmentHistory(khth as any, { periodId: 9001 }))
    .find((row) => row.reason === "KHTH điều chỉnh bác sĩ cho báo cáo lịch sử");
  assert.equal(latest?.removedName, "Bác sĩ được gỡ");
  assert.equal(latest?.addedName, "Bác sĩ được xếp");
  assert.equal(latest?.roomName, "Phòng khám Lịch sử");
  assert.equal(latest?.roleName, "Bác sĩ khám");
});
