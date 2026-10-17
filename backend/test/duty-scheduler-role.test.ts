import "reflect-metadata";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { AccessContext } from "../src/common/types/access-context";
import { ROLES } from "../src/db/seed-data";
import { DutyCoreService } from "../src/modules/duty/duty-core.service";

function context(permissions: string[], departmentIds: number[]): AccessContext {
  return {
    id: 19,
    username: "scheduler",
    fullName: "Người xếp lịch",
    title: "Hành chính khoa",
    departmentId: departmentIds[0] ?? null,
    departmentName: "Khoa kiểm thử",
    roles: ["NGUOI_XEP_LICH_TRUC_KHOA"],
    permissions,
    departmentIds,
    dataScope: "DEPT",
    isSuperAdmin: false,
    sessionId: "test",
  };
}

test("vai trò Người xếp lịch trực khoa chỉ được cấp quyền điều phối trong khoa", () => {
  const role = ROLES.find((item) => item.code === "NGUOI_XEP_LICH_TRUC_KHOA");
  assert.ok(role, "phải có vai trò hệ thống người xếp lịch trực khoa");
  assert.equal(role.dataScope, "DEPT");
  assert.deepEqual(role.permissions, ["duty.view", "duty.manage", "duty.swap.approve", "duty.export"]);

  const doctor = ROLES.find((item) => item.code === "NHAN_VIEN_TRUC");
  assert.ok(doctor);
  assert.deepEqual(doctor.permissions, ["duty.view"], "bác sĩ/điều dưỡng chỉ xem lịch");

  const chief = ROLES.find((item) => item.code === "TRUONG_KHOA");
  assert.ok(chief);
  assert.ok(chief.permissions !== "*" && !chief.permissions.includes("duty.manage"), "trưởng khoa cần được gán riêng vai trò xếp lịch");
});

test("người xếp lịch khoa thao tác mọi phòng nhưng chỉ quản lý nhân viên khoa được gán", () => {
  const core = new DutyCoreService({} as any, {} as any, {} as any);
  const scheduler = context(["duty.view", "duty.manage", "duty.swap.approve"], [7, 11]);
  const viewer = context(["duty.view"], [7]);

  assert.doesNotThrow(() => core.ensureManageSchedule(scheduler, "Phòng khám thuộc khoa khác"));
  assert.equal(core.canManageDept(scheduler, 7), true);
  assert.equal(core.canManageDept(scheduler, 11), true);
  assert.equal(core.canManageDept(scheduler, 8), false);
  assert.throws(() => core.ensureManageDept(scheduler, 8, "Nhân viên khoa khác"), /ngoài phạm vi khoa/);
  assert.equal(core.canManageAny(viewer), false);
});

test("migration role xếp lịch tạo quyền DEPT và thu hồi tự đăng ký ở vai trò hệ thống", async (t) => {
  const pg = await PGlite.create();
  t.after(() => pg.close());
  await pg.exec(readFileSync(resolve(__dirname, "..", "drizzle", "0000_init_khoi_tao.sql"), "utf8"));
  await pg.exec("TRUNCATE role_permissions, user_roles, roles, permissions RESTART IDENTITY CASCADE");
  await pg.exec(`
    INSERT INTO permissions (code, name, module, action) VALUES
      ('duty.view', 'Xem', 'duty', 'view'),
      ('duty.register', 'Tự đăng ký', 'duty', 'register'),
      ('duty.manage', 'Xếp', 'duty', 'manage'),
      ('duty.swap.approve', 'Duyệt đổi', 'duty', 'swap.approve'),
      ('duty.export', 'Xuất', 'duty', 'export');
    INSERT INTO roles (code, name) VALUES
      ('NHAN_VIEN_TRUC', 'Nhân viên'),
      ('TRUONG_KHOA', 'Trưởng khoa'),
      ('DIEU_PHOI_TRUC', 'Điều phối'),
      ('KHTB', 'KHTB');
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM (VALUES
      ('NHAN_VIEN_TRUC', 'duty.view'), ('NHAN_VIEN_TRUC', 'duty.register'),
      ('TRUONG_KHOA', 'duty.view'), ('TRUONG_KHOA', 'duty.register'), ('TRUONG_KHOA', 'duty.manage'), ('TRUONG_KHOA', 'duty.swap.approve'), ('TRUONG_KHOA', 'duty.export'),
      ('DIEU_PHOI_TRUC', 'duty.register'), ('KHTB', 'duty.register')
    ) AS wanted(role_code, permission_code)
    JOIN roles r ON r.code = wanted.role_code
    JOIN permissions p ON p.code = wanted.permission_code;
  `);

  const migration = readFileSync(resolve(__dirname, "..", "drizzle", "0022_nguoi_xep_lich_truc_khoa.sql"), "utf8");
  await pg.exec(migration);
  await pg.exec(migration);

  const scheduler = await pg.query<{ data_scope: string }>("SELECT data_scope FROM roles WHERE code = 'NGUOI_XEP_LICH_TRUC_KHOA'");
  assert.equal(scheduler.rows[0]?.data_scope, "DEPT");
  const schedulerPerms = await pg.query<{ code: string }>(`
    SELECT p.code FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE r.code = 'NGUOI_XEP_LICH_TRUC_KHOA'
    ORDER BY p.code
  `);
  assert.deepEqual(schedulerPerms.rows.map((row) => row.code), ["duty.export", "duty.manage", "duty.swap.approve", "duty.view"]);
  const selfService = await pg.query<{ code: string }>(`
    SELECT r.code FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE p.code = 'duty.register'
  `);
  assert.deepEqual(selfService.rows, []);
  const retiredPermission = await pg.query<{ code: string }>("SELECT code FROM permissions WHERE code = 'duty.register'");
  assert.deepEqual(retiredPermission.rows, []);
  const chiefDutyPerms = await pg.query<{ code: string }>(`
    SELECT p.code FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE r.code = 'TRUONG_KHOA' AND p.code IN ('duty.manage', 'duty.swap.approve', 'duty.export')
  `);
  assert.deepEqual(chiefDutyPerms.rows, []);
});


test("người xếp lịch khoa thấy mọi phòng nhưng API ứng viên chỉ trả nhân sự trong khoa", () => {
  const source = readFileSync(resolve(__dirname, "..", "src", "modules", "duty", "duty.service.ts"), "utf8");
  const start = source.indexOf("async candidates(user: AccessContext");
  const end = source.indexOf("/* ================================================================ Theo dõi xác thực", start);
  const candidates = source.slice(start, end);
  assert.ok(candidates.includes("this.core.ensureManageSchedule(user"));
  assert.ok(candidates.includes("const isDepartmentScheduler = this.core.isDepartmentScheduler(user)"));
  assert.ok(candidates.includes("const departmentIds = this.core.scopeDeptIds(user)"));
  assert.ok(candidates.includes("conds.push(inArray(users.departmentId, departmentIds))"));
  assert.ok(candidates.includes("ignoreRoomDepartment: isDepartmentScheduler"));
  assert.ok(candidates.includes("chưa được gán phạm vi khoa"));

  const coreSource = readFileSync(resolve(__dirname, "..", "src", "modules", "duty", "duty-core.service.ts"), "utf8");
  assert.ok(coreSource.includes("if (opts.ignoreRoomDepartment) slot.roomDepartmentId = null"));
});

test("auth context merges home department with explicitly assigned department scopes", () => {
  const source = readFileSync(resolve(__dirname, "..", "src", "modules", "auth", "auth.service.ts"), "utf8");
  assert.ok(source.includes("A primary department does not replace explicitly assigned additional scopes"));
  assert.ok(source.includes(".from(userDepartmentScopes)"));
  assert.ok(source.includes("if (user.departmentId) departmentIds.add(user.departmentId)"));
  assert.ok(source.includes("for (const s of scopeRows) departmentIds.add(s.departmentId)"));
});
