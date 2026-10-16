/** PostgreSQL integration without external infrastructure: production migrations + Drizzle + PGlite. */
import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { KioskService } from "../src/modules/kiosk/kiosk.service";
import { IntegrationDutyService } from "../src/modules/integration/integration-duty.service";
import * as schema from "../src/db/schema";

const TOKEN = "dev_real_pg_fixture_0123456789abcdef";
const MORNING = Date.parse("2026-10-15T07:30:00+07:00");

test("PostgreSQL: published roster → QR claim → verification → targeted lease → roster revocation", async (t) => {
  let now = MORNING;
  t.mock.method(Date, "now", () => now);
  const pg = await PGlite.create();
  t.after(async () => {
    await pg.close();
  });
  for (const file of [
    "0000_init_khoi_tao.sql",
    "0013_telegram_link.sql",
    "0015_lich_truc.sql",
    "0016_lich_truc_xoa_ky.sql",
    "0017_lich_truc_mau_ca.sql",
    "0019_kiosk_duty_attendance.sql",
    "0020_them_avatar_data_sinh_trac_hoc.sql",
    "0021_duty_absence_approval.sql",
  ]) {
    await pg.exec(
      readFileSync(resolve(__dirname, "..", "drizzle", file), "utf8"),
    );
  }
  const database = { db: drizzle(pg, { schema }) };
  const settings: Record<string, unknown> = {
    "kiosk.qrExpiresSeconds": 15,
    "kiosk.faceVerifyBufferSeconds": 60,
    "kiosk.lateCheckoutMinutes": 60,
    "kiosk.earlyCheckinMinutes": 60,
    "kiosk.itMasterPin": "fixture-it-pin-not-production",
  };
  const service = new KioskService(
    database as any,
    new IntegrationDutyService(database as any),
    { get: async (key: string) => settings[key] ?? null } as any,
    { log: async () => {} } as any,
  );
  t.after(() => service.onModuleDestroy());
  await pg.exec(`
    INSERT INTO users (id, username, password_hash, full_name, title) VALUES
      (7001, 'doctor_fixture_a', 'not-a-real-password', 'Bác sĩ A', 'BS.'),
      (7002, 'doctor_fixture_b', 'not-a-real-password', 'Bác sĩ B', 'BS.'),
      (7003, 'doctor_fixture_draft', 'not-a-real-password', 'Bác sĩ nháp', 'BS.');
    INSERT INTO duty_rooms (id, code, name) VALUES (7001, 'PK01', 'Phòng khám 01'), (7002, 'PK010', 'Phòng khám 010');
    INSERT INTO duty_roles (id, code, name) VALUES (7001, 'FIXTURE_BS', 'Bác sĩ');
    INSERT INTO duty_shift_types (id, code, name, start_time, end_time, crosses_midnight) VALUES
      (7001, 'FIXTURE_S', 'Ca sáng', '07:00', '11:00', false),
      (7002, 'FIXTURE_D', 'Ca đêm', '17:00', '07:00', true);
    INSERT INTO duty_periods (id, name, start_date, end_date, status, lock_at) VALUES
      (7001, 'Tuần đã công bố', '2026-10-12', '2026-10-18', 'CONG_BO', '2026-10-12T00:00:00+07:00'),
      (7002, 'Tuần nháp', '2026-10-12', '2026-10-18', 'NHAP', '2026-10-12T00:00:00+07:00');
    INSERT INTO duty_slots (id, period_id, duty_date, room_id, shift_id, role_id) VALUES
      (7001, 7001, '2026-10-15', 7001, 7001, 7001),
      (7002, 7001, '2026-10-15', 7002, 7001, 7001),
      (7003, 7002, '2026-10-15', 7001, 7001, 7001),
      (7004, 7001, '2026-10-14', 7001, 7002, 7001);
    INSERT INTO duty_assignments (id, slot_id, user_id) VALUES
      (7001, 7001, 7001), (7002, 7002, 7002), (7003, 7003, 7003), (7004, 7004, 7001);
  `);

  await t.test(
    "SQL roster joins include only the exact room and published period; unknown prefixes have no QR",
    async () => {
      const rows = await service.loadActiveRoster("PK01", ["2026-10-15"]);
      assert.deepEqual(
        rows.map((r) => r.userId),
        [7001],
      );
      const status = await service.getKioskStatus(
        "PK01",
        "pc_a",
        "https://hospital.test",
      );
      assert.equal(status.currentScheduled?.username, "doctor_fixture_a");
      assert.equal(status.currentScheduled?.startTime, "07:00");
      assert.equal(status.currentScheduled?.endTime, "11:00");
      const unknown = await service.getKioskStatus(
        "PK0",
        "pc_bad",
        "https://hospital.test",
      );
      assert.equal(unknown.roomExists, false);
      assert.equal(unknown.qrSession, null);
    },
  );

  await t.test(
    "concurrent frames produce one attendance row bound to slot/room and unlock only the scanning PC",
    async () => {
      const vector = Array<number>(512).fill(0);
      vector[0] = 1;
      await database.db.insert(schema.userBiometrics).values({
        userId: 7001,
        faceDescriptor: (service as any).encryptDescriptor(vector),
      });
      service.verifyAndExtractAi = async () => ({
        isLive: true,
        embedding: vector,
      });
      const status = await service.getKioskStatus(
        "PK01",
        "pc_a",
        "https://hospital.test",
      );
      const id = status.qrSession!.sessionId;
      await service.touchSessionScan(id, { claimToken: TOKEN });
      const params = {
        sessionId: id,
        snapshotBase64: "fixture-only-not-a-real-face",
        claimToken: TOKEN,
      };
      const replies = await Promise.all([
        service.verifyFaceAndUnlock(params),
        service.verifyFaceAndUnlock(params),
      ]);
      assert.equal(replies.filter((r) => r.success).length, 1);
      assert.equal(
        replies.filter((r) => "isProcessing" in r && r.isProcessing).length,
        1,
      );
      const attendance = await database.db.select().from(schema.dutyAttendance);
      assert.equal(attendance.length, 1);
      assert.equal(attendance[0].slotId, 7001);
      assert.equal(attendance[0].roomId, 7001);
      const pcA = await service.getKioskStatus(
        "PK01",
        "pc_a",
        "https://hospital.test",
      );
      assert.equal(pcA.isUnlocked, true);
      assert.equal(pcA.shiftEndMs, Date.parse("2026-10-15T11:00:00+07:00"));
      assert.equal(
        (await service.getKioskStatus("PK01", "pc_b", "https://hospital.test"))
          .isUnlocked,
        false,
      );
    },
  );

  await t.test(
    "real published roster binds IT PIN: replacement doctor revokes immediately and next shift is a hard deadline",
    async () => {
      await pg.exec(`
        INSERT INTO duty_shift_types (id, code, name, start_time, end_time, crosses_midnight) VALUES
          (7005, 'FIXTURE_C', 'Ca chiều fixture', '11:00', '15:00', false);
        INSERT INTO duty_slots (id, period_id, duty_date, room_id, shift_id, role_id) VALUES
          (7005, 7001, '2026-10-15', 7001, 7005, 7001);
        INSERT INTO duty_assignments (id, slot_id, user_id) VALUES (7005, 7005, 7003);
      `);
      // pc_a was verified by doctor A during the morning shift. Its prior no-next-shift
      // lease must be shortened to the newly published 11:00 handover, then lock exactly there.
      const biometricWithHandover = await service.getKioskStatus(
        "PK01",
        "pc_a",
        "https://hospital.test",
      );
      assert.equal(
        biometricWithHandover.shiftEndMs,
        Date.parse("2026-10-15T11:00:00+07:00"),
      );
      now = Date.parse("2026-10-15T11:00:00+07:00");
      assert.equal(
        (await service.getKioskStatus("PK01", "pc_a", "https://hospital.test"))
          .isUnlocked,
        false,
      );
      now = MORNING;
      const granted = await service.authorizeItOverride(
        "PK01",
        "pc_it_guard",
        "fixture-it-pin-not-production",
        "10.1.1.2",
      );
      assert.equal(granted.shiftEndMs, Date.parse("2026-10-15T11:00:00+07:00"));
      assert.equal(
        (
          await service.getKioskStatus(
            "PK01",
            "pc_it_guard",
            "https://hospital.test",
          )
        ).isUnlocked,
        true,
      );
      await pg.exec(
        "UPDATE duty_assignments SET user_id = 7002 WHERE id = 7001",
      );
      assert.equal(
        (
          await service.getKioskStatus(
            "PK01",
            "pc_it_guard",
            "https://hospital.test",
          )
        ).isUnlocked,
        false,
      );
      await pg.exec(
        "UPDATE duty_assignments SET user_id = 7001 WHERE id = 7001; DELETE FROM duty_assignments WHERE id = 7005; DELETE FROM duty_slots WHERE id = 7005; DELETE FROM duty_shift_types WHERE id = 7005",
      );
    },
  );

  await t.test(
    "adding an absence removes the active shift and releases the desktop; overnight absences cover the second day",
    async () => {
      await pg.exec(
        "INSERT INTO duty_absences (user_id, start_date, end_date) VALUES (7001, '2026-10-15', '2026-10-15')",
      );
      assert.equal(
        (await service.loadActiveRoster("PK01", ["2026-10-14", "2026-10-15"]))
          .length,
        0,
      );
      assert.equal(
        (await service.getKioskStatus("PK01", "pc_a", "https://hospital.test"))
          .isUnlocked,
        true,
      );
      assert.equal(
        (await service.getKioskStatus("PK01", "pc_a", "https://hospital.test"))
          .kioskRequired,
        false,
      );
      now = Date.parse("2026-10-15T03:00:00+07:00");
      assert.equal(
        (await service.getKioskStatus("PK01", "pc_a", "https://hospital.test"))
          .currentScheduled,
        null,
      );
      now = MORNING;
      await pg.exec("DELETE FROM duty_absences WHERE user_id = 7001");
    },
  );

  await t.test(
    "a late AI result after the buffer cannot write attendance or release the PC",
    async () => {
      service.lockRoom("PK01");
      const status = await service.getKioskStatus(
        "PK01",
        "pc_a",
        "https://hospital.test",
      );
      const id = status.qrSession!.sessionId;
      await service.touchSessionScan(id, { claimToken: TOKEN });
      const before = (await database.db.select().from(schema.dutyAttendance))
        .length;
      service.verifyAndExtractAi = async () => {
        now += 60_001;
        return { isLive: true, embedding: [1, ...Array<number>(511).fill(0)] };
      };
      await assert.rejects(
        service.verifyFaceAndUnlock({
          sessionId: id,
          snapshotBase64: "fixture-only",
          claimToken: TOKEN,
        }),
        /hết hạn|bị huỷ/,
      );
      assert.equal(
        (await database.db.select().from(schema.dutyAttendance)).length,
        before,
      );
      assert.equal(
        (await service.getKioskStatus("PK01", "pc_a", "https://hospital.test"))
          .isUnlocked,
        false,
      );
      now = MORNING;
    },
  );

  await t.test(
    "face verification cannot release a PC after the exact shift end even while its phone buffer remains valid",
    async () => {
      settings["kiosk.faceVerifyBufferSeconds"] = 180;
      now = Date.parse("2026-10-15T10:59:00+07:00");
      service.lockRoom("PK01");
      const status = await service.getKioskStatus("PK01", "pc_a", "https://hospital.test");
      const id = status.qrSession!.sessionId;
      await service.touchSessionScan(id, { claimToken: TOKEN });
      const before = (await database.db.select().from(schema.dutyAttendance)).length;
      service.verifyAndExtractAi = async () => {
        now = Date.parse("2026-10-15T11:01:00+07:00");
        return { isLive: true, embedding: [1, ...Array<number>(511).fill(0)] };
      };
      await assert.rejects(
        service.verifyFaceAndUnlock({ sessionId: id, snapshotBase64: "fixture-only", claimToken: TOKEN }),
        /khung giờ ca trực|Ca trực đã kết thúc/,
      );
      assert.equal((await database.db.select().from(schema.dutyAttendance)).length, before);
      const released = await service.getKioskStatus("PK01", "pc_a", "https://hospital.test");
      assert.equal(released.kioskRequired, false);
      assert.equal(released.isUnlocked, true);
      settings["kiosk.faceVerifyBufferSeconds"] = 60;
      now = MORNING;
    },
  );

  await t.test(
    "deleting an assignment is reflected without restarting the kiosk/backend",
    async () => {
      await pg.exec("DELETE FROM duty_assignments WHERE id = 7001");
      assert.equal(
        (await service.loadActiveRoster("PK01", ["2026-10-15"])).length,
        0,
      );
      assert.notEqual(
        (await service.getKioskStatus("PK01", "pc_a", "https://hospital.test"))
          .currentScheduled?.shiftCode,
        "FIXTURE_S",
      );
      now = Date.parse("2026-10-15T12:01:00+07:00");
      assert.equal(
        (await service.getKioskStatus("PK01", "pc_a", "https://hospital.test"))
          .currentScheduled,
        null,
      );
    },
  );
});
