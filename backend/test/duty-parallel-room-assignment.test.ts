import "reflect-metadata";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../src/db/schema";
import { DutyCoreService } from "../src/modules/duty/duty-core.service";

const rules = JSON.stringify({
  maxShiftsPerDay: 1,
  maxShiftsPerPeriod: 1,
  maxNightShiftsPerPeriod: 1,
  maxHoursPerDay: 0,
  maxHoursPerWeek: 0,
  minRestHours: 0,
  crossDeptPolicy: "CHO_PHEP",
  allowSelfRegister: true,
  swapNeedsApproval: true,
  requireFullBeforePublish: false,
});

test("PostgreSQL: cùng bác sĩ ở nhiều phòng trong cùng ca được phép và chỉ tính một ca", async (t) => {
  const pg = await PGlite.create();
  t.after(() => pg.close());
  for (const file of ["0000_init_khoi_tao.sql", "0015_lich_truc.sql"]) {
    await pg.exec(readFileSync(resolve(__dirname, "..", "drizzle", file), "utf8"));
  }
  await pg.exec(`
    INSERT INTO departments(id,code,name) VALUES(1,'K1','Khoa 1');
    INSERT INTO users(id,username,password_hash,full_name,title,department_id,active)
      VALUES(1,'doctor','fixture','Bác sĩ kiểm thử','Bác sĩ',1,true);
    INSERT INTO duty_rooms(id,code,name,department_id) VALUES
      (1,'P1','Phòng 1',1),(2,'P2','Phòng 2',1);
    INSERT INTO duty_roles(id,code,name,required_title) VALUES(1,'BS','Bác sĩ','Bác sĩ');
    INSERT INTO duty_shift_types(id,code,name,start_time,end_time,crosses_midnight,is_night) VALUES
      (1,'S','Ca sáng','07:00','11:00',false,false),
      (2,'CHONG','Ca chồng giờ','08:00','12:00',false,false);
    INSERT INTO duty_periods(id,name,start_date,end_date,status,lock_at,rules)
      VALUES(1,'Kỳ kiểm thử','2026-11-02','2026-11-02','NHAP','2026-12-01T00:00:00+07:00','${rules}'::jsonb);
    INSERT INTO duty_slots(id,period_id,duty_date,room_id,shift_id,role_id) VALUES
      (1,1,'2026-11-02',1,1,1),
      (2,1,'2026-11-02',2,1,1),
      (3,1,'2026-11-02',2,2,1);
    INSERT INTO duty_assignments(slot_id,user_id) VALUES(1,1);
  `);

  const db = { db: drizzle(pg, { schema }) };
  const core = new DutyCoreService(db as any, { notify: async () => {} } as any, { publish: () => {} } as any);
  const doctor = (await core.loadUsers(db.db as any, [1])).get(1)!;

  // CSDL có hai phòng cùng một ca, nhưng bộ đếm theo kỳ phải ghi nhận một ca.
  const counts = await core.loadPeriodCounts(db.db as any, [1], [1]);
  assert.deepEqual(counts.get("1:1"), { shifts: 1, nights: 0 });

  const sameShiftOtherRoom = await core.getSlot(2, db.db as any);
  const parallel = (await core.evaluatePairs(db.db as any, core.pairsFor(sameShiftOtherRoom, [doctor]))).get("2:1")!;
  assert.equal(parallel.ok, true, JSON.stringify(parallel.errors));
  assert.equal(parallel.errors.some((error) => error.code === "OVERLAP"), false);
  assert.equal(parallel.errors.some((error) => error.code === "SHIFTS_PER_DAY"), false);
  assert.equal(parallel.errors.some((error) => error.code === "SHIFTS_PER_PERIOD"), false);

  // Một ca KHÁC có giờ chồng vẫn không được nới lỏng.
  const overlappingDifferentShift = await core.getSlot(3, db.db as any);
  const conflict = (await core.evaluatePairs(db.db as any, core.pairsFor(overlappingDifferentShift, [doctor]))).get("3:1")!;
  assert.equal(conflict.ok, false);
  assert.equal(conflict.errors.some((error) => error.code === "OVERLAP"), true);
  assert.equal(conflict.errors.some((error) => error.code === "SHIFTS_PER_DAY"), true);
});
