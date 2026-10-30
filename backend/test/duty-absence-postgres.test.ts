import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../src/db/schema";
import { DutyCoreService } from "../src/modules/duty/duty-core.service";
import { DutyAbsenceService } from "../src/modules/duty/duty-absence.service";
import { KioskService } from "../src/modules/kiosk/kiosk.service";
import { IntegrationDutyService } from "../src/modules/integration/integration-duty.service";
import type { AccessContext } from "../src/common/types/access-context";

const context = (
  id: number,
  permissions: string[] = [],
  departmentId = 1,
): AccessContext => ({
  id,
  username: `fixture_${id}`,
  fullName: `Fixture ${id}`,
  title: "BS.",
  departmentId,
  departmentName: "Khoa 1",
  roles: [],
  permissions,
  departmentIds: [departmentId],
  dataScope: "DEPT",
  isSuperAdmin: false,
  sessionId: "fixture",
});
const doctor = context(1, ["duty.view", "duty.register"]);
const manager = context(9, [
  "duty.view",
  "duty.manage-all",
  "duty.exception.resolve",
]);
const leave = {
  startDate: "2026-10-15",
  endDate: "2026-10-16",
  reason: "PHEP_NAM" as const,
  note: "Xin nghỉ có người thay",
};

test("PostgreSQL: absence requests preserve roster until scoped, atomic approval with replacements", async (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-10-15T07:30:00+07:00"));
  const pg = await PGlite.create();
  t.after(() => pg.close());
  for (const file of [
    "0000_init_khoi_tao.sql",
    "0013_telegram_link.sql",
    "0015_lich_truc.sql",
    "0016_lich_truc_xoa_ky.sql",
    "0017_lich_truc_mau_ca.sql",
    "0019_kiosk_duty_attendance.sql",
    "0020_them_avatar_data_sinh_trac_hoc.sql",
  ])
    await pg.exec(
      readFileSync(resolve(__dirname, "..", "drizzle", file), "utf8"),
    );
  await pg.exec(`INSERT INTO departments(id,code,name) VALUES(1,'K1','Khoa 1'),(2,'K2','Khoa 2');
    INSERT INTO users(id,username,password_hash,full_name,title,department_id,active) VALUES
    (1,'absence_doctor','fixture','Bác sĩ xin nghỉ','BS.',1,true),(2,'replacement_a','fixture','Bác sĩ thay A','BS.',1,true),
    (3,'replacement_b','fixture','Bác sĩ thay B','BS.',1,true),(4,'other_department','fixture','Bác sĩ khoa khác','BS.',2,true),
    (5,'inactive_doctor','fixture','Đã nghỉ việc','BS.',1,false),(9,'absence_manager','fixture','Quản lý','BS.',1,true);
    INSERT INTO duty_rooms(id,code,name,department_id) VALUES(1,'P2','Phòng 2',1),(2,'P3','Phòng 3',2);
    INSERT INTO duty_roles(id,code,name) VALUES(1,'BS','Bác sĩ');
    INSERT INTO duty_shift_types(id,code,name,start_time,end_time,crosses_midnight) VALUES(1,'S','Ca sáng','07:00','11:00',false),(2,'D','Ca đêm','22:00','06:00',true);
    INSERT INTO duty_periods(id,name,start_date,end_date,status,lock_at) VALUES(1,'Tuần kiểm thử','2026-10-12','2026-10-18','CONG_BO','2026-10-19T00:00:00+07:00');
    INSERT INTO duty_slots(id,period_id,duty_date,room_id,shift_id,role_id) VALUES(1,1,'2026-10-15',1,1,1),(2,1,'2026-10-16',1,1,1),(3,1,'2026-10-15',2,1,1),(4,1,'2026-10-14',1,2,1);
    INSERT INTO duty_absences(user_id,start_date,end_date) VALUES(4,'2026-10-20','2026-10-20');`);
  const migration = readFileSync(
    resolve(__dirname, "..", "drizzle", "0021_duty_absence_approval.sql"),
    "utf8",
  );
  await pg.exec(migration);
  await pg.exec(migration);
  assert.equal(
    (await pg.query("SELECT * FROM duty_absences")).rows.length,
    1,
    "upgrade preserves pre-existing operational absences",
  );
  const db = { db: drizzle(pg, { schema }) };
  const events: string[] = [];
  const core = new DutyCoreService(
    db as any,
    { notify: async () => {} } as any,
    { publish: (e: any) => events.push(e.type) } as any,
  );
  const service = new DutyAbsenceService(db as any, core);
  const kiosk = new KioskService(
    db as any,
    new IntegrationDutyService(db as any),
    { get: async () => null } as any,
    { log: async () => {} } as any,
  );
  t.after(() => kiosk.onModuleDestroy());
  const reset = async () => {
    await pg.exec(
      "DELETE FROM duty_absence_requests; DELETE FROM duty_absences; DELETE FROM duty_assignments; DELETE FROM duty_logs; UPDATE duty_periods SET lock_at = '2026-10-19T00:00:00+07:00'; UPDATE duty_rooms SET department_id=1 WHERE id=1;",
    );
    await pg.exec(
      "INSERT INTO duty_assignments(id,slot_id,user_id) VALUES(101,1,1),(102,2,1)",
    );
    await pg.exec("UPDATE duty_shift_types SET end_time='06:00' WHERE id=2");
    events.length = 0;
  };
  const picks = [
    { slotId: 1, assignmentId: 101, replacementUserId: 2 },
    { slotId: 2, assignmentId: 102, replacementUserId: 3 },
  ];
  const original = async () =>
    (
      await pg.query<{ user_id: number }>(
        "SELECT user_id FROM duty_assignments ORDER BY slot_id",
      )
    ).rows.map((r) => r.user_id);

  await t.test(
    "pending request is isolated from operational absences, engine availability and Kiosk roster",
    async () => {
      await reset();
      const before = await kiosk.loadActiveRoster("P2", ["2026-10-15"]);
      const req = await service.create(doctor, leave);
      assert.equal(req.status, "CHO_DUYET");
      assert.deepEqual(await original(), [1, 1]);
      assert.equal((await db.db.select().from(schema.dutyAbsences)).length, 0);
      assert.equal(
        (await core.loadAbsences(db.db as any, [1], "2026-10-15", "2026-10-16"))
          .size,
        0,
      );
      assert.deepEqual(
        (await kiosk.loadActiveRoster("P2", ["2026-10-15"])).map(
          (r) => r.userId,
        ),
        before.map((r) => r.userId),
      );
      assert.deepEqual(events, ["absence-request"]);
    },
  );
  await t.test(
    "duplicate pending ranges, invalid dates and reporting for another doctor are refused",
    async () => {
      await reset();
      await service.create(doctor, leave);
      await assert.rejects(service.create(doctor, leave), /trùng ngày/);
      await assert.rejects(
        service.create(doctor, { ...leave, userId: 2 }),
        /quản lý/,
      );
      await assert.rejects(
        service.create(doctor, { ...leave, startDate: "2026-02-30" }),
        /không hợp lệ/,
      );
      await assert.rejects(
        service.create(doctor, {
          ...leave,
          startDate: "0001-01-01",
          endDate: "9999-12-31",
        }),
        /366/,
      );
    },
  );
  await t.test(
    "ordinary doctor, unrelated department and self-approval have no authorization",
    async () => {
      await reset();
      const req = await service.create(doctor, leave);
      await assert.rejects(
        service.approve(doctor, req.id, { replacements: picks }),
        /quản lý/,
      );
      await assert.rejects(
        service.approve(context(4, ["duty.manage"], 2), req.id, {
          replacements: picks,
        }),
        /phạm vi khoa/,
      );
      await assert.rejects(
        service.approve(context(1, ["duty.manage-all"]), req.id, {
          replacements: picks,
        }),
        /chính mình/,
      );
      await assert.rejects(service.listRequests(doctor, "approval"), /quản lý/);
      assert.deepEqual(await original(), [1, 1]);
    },
  );
  await t.test(
    "no or partial replacements cannot remove any existing assignment",
    async () => {
      await reset();
      const req = await service.create(doctor, leave);
      await assert.rejects(service.approve(manager, req.id, {}), /TẤT CẢ/);
      await assert.rejects(
        service.approve(manager, req.id, { replacements: [picks[0]] }),
        /TẤT CẢ/,
      );
      assert.deepEqual(await original(), [1, 1]);
      assert.equal((await db.db.select().from(schema.dutyAbsences)).length, 0);
    },
  );
  await t.test(
    "invalid second replacement rolls back the first swap and the entire approval",
    async () => {
      await reset();
      const req = await service.create(doctor, leave);
      await assert.rejects(
        service.approve(manager, req.id, {
          replacements: [picks[0], { ...picks[1], replacementUserId: 5 }],
        }),
        /không hợp lệ/,
      );
      assert.deepEqual(await original(), [1, 1]);
      assert.equal(
        (await db.db.select().from(schema.dutyAbsenceRequests))[0].status,
        "CHO_DUYET",
      );
      assert.equal((await db.db.select().from(schema.dutyAbsences)).length, 0);
    },
  );
  await t.test(
    "approval replaces all slots, records approved absence/audit and changes published Kiosk roster atomically",
    async () => {
      await reset();
      const req = await service.create(doctor, leave);
      const preview = await service.detail(manager, req.id);
      assert.equal(preview.affected.length, 2);
      assert.ok(preview.affected[0].candidates.some((c) => c.userId === 2));
      await service.approve(manager, req.id, {
        replacements: picks,
        note: "Đã liên hệ người thay",
      });
      assert.deepEqual(await original(), [2, 3]);
      const saved = (await db.db.select().from(schema.dutyAbsenceRequests))[0];
      assert.equal(saved.status, "DA_DUYET");
      assert.ok(saved.approvedAbsenceId);
      assert.equal(
        (
          await core.loadAbsences(db.db as any, [1], "2026-10-15", "2026-10-16")
        ).get(1)?.length,
        1,
      );
      assert.deepEqual(
        (await kiosk.loadActiveRoster("P2", ["2026-10-15"])).map(
          (r) => r.userId,
        ),
        [2],
      );
      assert.equal(
        (await service.list(doctor, {})).length,
        1,
        "approved request not duplicated by its operational absence",
      );
      await assert.rejects(
        service.approve(manager, req.id, { replacements: picks }),
        /đã được xử lý/,
      );
      await assert.rejects(service.resolve(doctor, req.id, "HUY"), /đang chờ/);
      await assert.rejects(
        service.deleteLegacy(doctor, saved.approvedAbsenceId!),
        /quản lý/,
      );
    },
  );
  await t.test(
    "rejection and withdrawal keep roster and availability unchanged",
    async () => {
      await reset();
      let req = await service.create(doctor, leave);
      await assert.rejects(
        service.resolve(manager, req.id, "TU_CHOI", ""),
        /lý do/,
      );
      await service.resolve(
        manager,
        req.id,
        "TU_CHOI",
        "Chưa bố trí được người thay",
      );
      assert.deepEqual(await original(), [1, 1]);
      assert.equal((await db.db.select().from(schema.dutyAbsences)).length, 0);
      req = await service.create(doctor, leave);
      await assert.rejects(
        service.resolve(context(2), req.id, "HUY"),
        /người xin nghỉ/,
      );
      await service.resolve(doctor, req.id, "HUY");
      assert.deepEqual(await original(), [1, 1]);
    },
  );
  await t.test(
    "stale assignment IDs and duplicated replacement entries are rejected",
    async () => {
      await reset();
      const req = await service.create(doctor, leave);
      await assert.rejects(
        service.approve(manager, req.id, {
          replacements: [{ ...picks[0], assignmentId: 999 }, picks[1]],
        }),
        /TẤT CẢ/,
      );
      await assert.rejects(
        service.approve(manager, req.id, {
          replacements: [picks[0], picks[0]],
        }),
        /Mỗi ca/,
      );
      assert.deepEqual(await original(), [1, 1]);
    },
  );
  await t.test(
    "replacement must remain eligible and cannot have a conflicting different shift",
    async () => {
      await reset();
      // Slot 3 là cùng ca sáng ở phòng khác và được phép từ quy tắc nhiều
      // phòng/cùng ca. Tạo riêng một ca khác chồng giờ để kiểm tra rào chắn
      // an toàn với ca KHÁC vẫn giữ nguyên.
      await pg.exec(`
        INSERT INTO duty_shift_types(id,code,name,start_time,end_time,crosses_midnight,is_night)
        VALUES(3,'CHONG','Ca chồng giờ','08:00','12:00',false,false);
        INSERT INTO duty_slots(id,period_id,duty_date,room_id,shift_id,role_id)
        VALUES(5,1,'2026-10-15',2,3,1);
        INSERT INTO duty_assignments(slot_id,user_id) VALUES(5,2);
      `);
      const req = await service.create(doctor, leave);
      await assert.rejects(
        service.approve(manager, req.id, { replacements: picks }),
        /không hợp lệ/,
      );
      assert.deepEqual(
        (await pg.query("SELECT user_id FROM duty_assignments WHERE slot_id=1"))
          .rows,
        [{ user_id: 1 }],
      );
    },
  );
  await t.test(
    "locked schedule still requires KHTH exception permission",
    async () => {
      await reset();
      await pg.exec(
        "UPDATE duty_periods SET lock_at='2026-10-10T00:00:00+07:00'",
      );
      const req = await service.create(doctor, leave);
      const coordinator = context(9, ["duty.manage-all"]);
      assert.equal(
        (await service.detail(coordinator, req.id)).canApprove,
        false,
      );
      await assert.rejects(
        service.approve(coordinator, req.id, { replacements: picks }),
        /KHTH/,
      );
      assert.deepEqual(await original(), [1, 1]);
    },
  );
  await t.test(
    "người xếp lịch duyệt nhân viên khoa mình dù ca ở phòng gắn khoa khác",
    async () => {
      await reset();
      await pg.exec("UPDATE duty_rooms SET department_id=2 WHERE id=1");
      const req = await service.create(doctor, leave);
      await service.approve(
        context(9, ["duty.manage", "duty.exception.resolve"]),
        req.id,
        { replacements: picks },
      );
      assert.deepEqual(await original(), [2, 3]);
    },
  );
  await t.test(
    "no assigned shifts requires approval but not invented replacements",
    async () => {
      await reset();
      await pg.exec("DELETE FROM duty_assignments");
      const req = await service.create(doctor, leave);
      assert.equal(req.status, "CHO_DUYET");
      await service.approve(manager, req.id, {});
      assert.equal((await db.db.select().from(schema.dutyAbsences)).length, 1);
    },
  );
  await t.test(
    "legacy IDs cannot collide with withdrawal of a pending request or bypass approved workflow",
    async () => {
      await reset();
      const req = await service.create(doctor, leave);
      await pg.exec(
        `INSERT INTO duty_absences(id,user_id,start_date,end_date) VALUES(${req.id},1,'2026-10-20','2026-10-20')`,
      );
      const list = await service.list(doctor, {});
      assert.equal(list.length, 2);
      assert.deepEqual(
        new Set(list.map((r) => r.kind)),
        new Set(["REQUEST", "APPROVED"]),
      );
      await service.resolve(doctor, req.id, "HUY");
      assert.equal((await db.db.select().from(schema.dutyAbsences)).length, 1);
      const next = await service.create(doctor, leave);
      await service.approve(manager, next.id, { replacements: picks });
      const approved = (
        await db.db.select().from(schema.dutyAbsenceRequests)
      ).find((r) => r.id === next.id)!;
      await assert.rejects(
        service.deleteLegacy(manager, approved.approvedAbsenceId!),
        /đã duyệt qua quy trình/,
      );
    },
  );
  await t.test(
    "pending request leaves an existing verified, terminal-bound biometric lease valid",
    async () => {
      await reset();
      kiosk.lockRoom("P2");
      const vector = Array<number>(512).fill(0);
      vector[0] = 1;
      await db.db
        .insert(schema.userBiometrics)
        .values({
          userId: 1,
          faceDescriptor: (kiosk as any).encryptDescriptor(vector),
        })
        .onConflictDoUpdate({
          target: schema.userBiometrics.userId,
          set: { faceDescriptor: (kiosk as any).encryptDescriptor(vector) },
        });
      kiosk.verifyAndExtractAi = async () => ({
        isLive: true,
        embedding: vector,
      });
      const origin = "https://hospital.test",
        terminal = "pc_absence_fixture",
        claimToken = "dev_absence_fixture_0123456789abcdef";
      const status = await kiosk.getKioskStatus("P2", terminal, origin);
      assert.ok(status.qrSession);
      await kiosk.touchSessionScan(status.qrSession.sessionId, { claimToken });
      const checked = await kiosk.verifyFaceAndUnlock({
        sessionId: status.qrSession.sessionId,
        claimToken,
        snapshotBase64: "fixture-no-real-patient-or-face",
      });
      assert.equal(checked.success, true);
      await service.create(doctor, leave);
      assert.equal(
        (await kiosk.getKioskStatus("P2", terminal, origin)).isUnlocked,
        true,
      );
      assert.equal(
        (await kiosk.getKioskStatus("P2", "another_pc", origin)).isUnlocked,
        false,
      );
      assert.deepEqual(await original(), [1, 1]);
      kiosk.lockRoom("P2");
    },
  );
  await t.test(
    "completed assignments remain clinical history, not retroactively replaced",
    async () => {
      await reset();
      await pg.exec(
        "DELETE FROM duty_assignments; INSERT INTO duty_assignments(id,slot_id,user_id) VALUES(104,4,1)",
      );
      const req = await service.create(doctor, {
        ...leave,
        endDate: "2026-10-15",
      });
      assert.equal((await service.detail(manager, req.id)).affected.length, 0);
      await service.approve(manager, req.id, {});
      assert.deepEqual(await original(), [1]);
    },
  );
  await t.test(
    "a shift ending exactly at absence midnight remains unchanged and operational",
    async () => {
      await reset();
      await pg.exec(
        "DELETE FROM duty_assignments; INSERT INTO duty_assignments(id,slot_id,user_id) VALUES(104,4,1); UPDATE duty_shift_types SET end_time='00:00' WHERE id=2",
      );
      const savedNow = Date.now;
      t.mock.method(Date, "now", () => Date.parse("2026-10-14T23:30:00+07:00"));
      const req = await service.create(doctor, {
        ...leave,
        endDate: "2026-10-15",
      });
      assert.equal((await service.detail(manager, req.id)).affected.length, 0);
      await service.approve(manager, req.id, {});
      assert.deepEqual(await original(), [1]);
      assert.deepEqual(
        (await kiosk.loadActiveRoster("P2", ["2026-10-14"])).map(
          (r) => r.userId,
        ),
        [1],
      );
      t.mock.method(Date, "now", savedNow);
    },
  );
  await t.test(
    "ongoing overnight assignment is included when absence begins on its second day",
    async () => {
      await reset();
      await pg.exec(
        "DELETE FROM duty_assignments; INSERT INTO duty_assignments(id,slot_id,user_id) VALUES(104,4,1)",
      );
      const savedNow = Date.now;
      t.mock.method(Date, "now", () => Date.parse("2026-10-15T03:00:00+07:00"));
      const req = await service.create(doctor, {
        ...leave,
        endDate: "2026-10-15",
      });
      assert.deepEqual(
        (await service.detail(manager, req.id)).affected.map((s) => s.slotId),
        [4],
      );
      await pg.exec(
        "INSERT INTO duty_absences(user_id,start_date,end_date) VALUES(2,'2026-10-15','2026-10-15')",
      );
      const preview = await service.detail(manager, req.id);
      assert.ok(
        !preview.affected[0].candidates.some((c) => c.userId === 2),
        "replacement absent on second day cannot cover overnight shift",
      );
      await assert.rejects(
        service.approve(manager, req.id, {
          replacements: [
            { slotId: 4, assignmentId: 104, replacementUserId: 2 },
          ],
        }),
        /không hợp lệ/,
      );
      await service.approve(manager, req.id, {
        replacements: [{ slotId: 4, assignmentId: 104, replacementUserId: 3 }],
      });
      assert.deepEqual(await original(), [3]);
      t.mock.method(Date, "now", savedNow);
    },
  );
});
