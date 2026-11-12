/**
 * Khởi tạo dữ liệu nền cho QLBS.
 *
 *   npm run db:seed
 *
 * An toàn khi chạy lại nhiều lần (idempotent): chỉ thêm những gì còn thiếu,
 * không ghi đè dữ liệu đã có.
 *
 * Thứ tự: quyền → vai trò → người dùng quản trị → cấu hình → khoa/phòng →
 *         quy trình ký → tiện ích → tác vụ định kỳ → mẫu in → mẫu báo cáo mẫu.
 */
import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { and, eq, ilike, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { config } from '../src/config/env';
import * as schema from '../src/db/schema';
import { defaultAssetLabelDocument, LABEL_TEMPLATE_CODE } from '../src/modules/assets/asset-label-template';
import { defaultAssetVoucherDocument, VOUCHER_TEMPLATE_CODE } from '../src/modules/assets/asset-voucher-template';
import { defaultInventoryDocument, INVENTORY_TEMPLATE_CODE } from '../src/modules/assets/asset-inventory-template';
import { seedStudioDefaultDashboard } from './seed-studio';
import {
  DEMO_DEPARTMENTS,
  DEMO_REPORT_TEMPLATE,
  DEFAULT_JOB_TITLES,
  DEFAULT_DUTY_ROOMS,
  DEFAULT_DUTY_SHIFTS,
  DEFAULT_DUTY_ROLES,
  DEFAULT_WORKFLOW,
  PERMISSIONS,
  ROLES,
  SCHEDULED_JOBS,
  UTILITIES,
  defaultHsbaPrintDocument,
  settingsSeed,
} from '../src/db/seed-data';

const pool = new Pool({ connectionString: config.database.url, max: 5 });
const db = drizzle(pool, { schema });

const log = (...args: unknown[]): void => console.log('  ', ...args);
const title = (t: string): void => console.log(`\n▸ ${t}`);

async function seedPermissions(): Promise<Map<string, number>> {
  title(`Quyền hệ thống (${PERMISSIONS.length})`);
  let created = 0;
  for (const p of PERMISSIONS) {
    const [existing] = await db
      .select({ id: schema.permissions.id })
      .from(schema.permissions)
      .where(eq(schema.permissions.code, p.code))
      .limit(1);
    if (existing) continue;
    await db.insert(schema.permissions).values({
      code: p.code,
      name: p.name,
      module: p.module,
      action: p.action,
      description: p.description ?? '',
      isSystem: true,
      sortOrder: PERMISSIONS.indexOf(p),
    });
    created++;
  }
  const rows = await db
    .select({ id: schema.permissions.id, code: schema.permissions.code })
    .from(schema.permissions);
  log(created > 0 ? `Đã thêm ${created} quyền mới (tổng ${rows.length})` : `Đã có đủ ${rows.length} quyền`);
  return new Map(rows.map((r) => [r.code, r.id]));
}

async function seedRoles(permissionMap: Map<string, number>): Promise<Map<string, number>> {
  title(`Vai trò (${ROLES.length})`);
  for (const role of ROLES) {
    let [existing] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.code, role.code))
      .limit(1);

    if (!existing) {
      const [inserted] = await db
        .insert(schema.roles)
        .values({
          code: role.code,
          name: role.name,
          description: role.description,
          dataScope: role.dataScope,
          priority: role.priority,
          color: role.color,
          isSystem: role.isSystem,
          sortOrder: ROLES.indexOf(role),
          active: true,
        })
        .returning({ id: schema.roles.id });
      existing = inserted;
      log(`+ ${role.code} — ${role.name}`);
    }

    // Gán quyền
    const codes = role.permissions === '*' ? [...permissionMap.keys()] : role.permissions;
    const ids = codes.map((c) => permissionMap.get(c)).filter((v): v is number => v !== undefined);
    const missing = codes.filter((c) => !permissionMap.has(c));
    if (missing.length > 0) {
      console.warn(`    ⚠ ${role.code}: quyền không tồn tại → ${missing.join(', ')}`);
    }
    if (ids.length > 0) {
      await db
        .insert(schema.rolePermissions)
        .values(ids.map((permissionId) => ({ roleId: existing!.id, permissionId })))
        .onConflictDoNothing();
    }
  }
  const rows = await db.select({ id: schema.roles.id, code: schema.roles.code }).from(schema.roles);
  return new Map(rows.map((r) => [r.code, r.id]));
}

async function seedAdmin(roleMap: Map<string, number>): Promise<void> {
  title('Tài khoản quản trị');
  const username = config.seed.adminUser.toLowerCase();
  let [admin] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .limit(1);

  if (!admin) {
    const hash = await bcrypt.hash(config.seed.adminPass, config.security.bcryptRounds);
    const [created] = await db
      .insert(schema.users)
      .values({
        manv: username.slice(0, 4),
        username,
        passwordHash: hash,
        fullName: config.seed.adminName,
        title: 'Quản trị hệ thống',
        mustChangePassword: false,
        active: true,
      })
      .returning({ id: schema.users.id });
    admin = created;
    log(`+ Đã tạo tài khoản "${username}" — mật khẩu: ${config.seed.adminPass}`);
    log('  ⚠ Hãy đổi mật khẩu ngay sau khi đăng nhập lần đầu!');
  } else {
    log(`= Tài khoản "${username}" đã tồn tại — giữ nguyên mật khẩu hiện tại`);
  }

  for (const code of ['SUPER_ADMIN', 'ADMIN']) {
    const roleId = roleMap.get(code);
    if (!roleId) continue;
    await db
      .insert(schema.userRoles)
      .values({ userId: admin.id, roleId })
      .onConflictDoNothing();
  }
}

async function seedSettings(): Promise<void> {
  const items = settingsSeed();
  title(`Cấu hình hệ thống (${items.length})`);
  let created = 0;
  for (const item of items) {
    const [existing] = await db
      .select({ key: schema.settings.key })
      .from(schema.settings)
      .where(eq(schema.settings.key, item.key))
      .limit(1);
    if (existing) continue;
    await db.insert(schema.settings).values({
      key: item.key,
      value: item.value as never,
      group: item.group ?? 'general',
      label: item.label ?? '',
      description: item.description ?? '',
      valueType: item.valueType ?? 'string',
      isPublic: item.isPublic ?? false,
    });
    created++;
  }
  log(created > 0 ? `Đã thêm ${created} cấu hình` : 'Cấu hình đã đầy đủ');
}

async function seedDepartments(): Promise<void> {
  title('Đơn vị / Khoa phòng');
  const [existingCount] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.departments)
    .where(eq(schema.departments.code, 'VIEN'));
  if ((existingCount?.total ?? 0) > 0 && !config.seed.demo) {
    log('Đã có dữ liệu đơn vị — bỏ qua');
    return;
  }

  const codeToId = new Map<string, number>();
  const codeToPath = new Map<string, string>();

  // Tạo theo thứ tự để cấp trên luôn có trước
  for (const dept of DEMO_DEPARTMENTS) {
    const [existing] = await db
      .select({ id: schema.departments.id, path: schema.departments.path })
      .from(schema.departments)
      .where(eq(schema.departments.code, dept.code))
      .limit(1);
    if (existing) {
      codeToId.set(dept.code, existing.id);
      codeToPath.set(dept.code, existing.path);
      continue;
    }

    const parentId = dept.parentCode ? (codeToId.get(dept.parentCode) ?? null) : null;
    const parentPath = dept.parentCode ? (codeToPath.get(dept.parentCode) ?? '') : '';
    const level = parentId ? (parentPath.split('/').filter(Boolean).length || 0) + 1 : 1;

    const [created] = await db
      .insert(schema.departments)
      .values({
        code: dept.code,
        name: dept.name,
        shortName: dept.shortName,
        parentId,
        level: level || 1,
        kind: dept.kind,
        reportCode: dept.reportCode ?? 'B4',
        reportEnabled: dept.reportEnabled ?? true,
        path: '',
        sortOrder: DEMO_DEPARTMENTS.indexOf(dept),
      })
      .returning({ id: schema.departments.id });

    const path = `${parentPath}${created.id}/`;
    await db
      .update(schema.departments)
      .set({ path })
      .where(eq(schema.departments.id, created.id));

    codeToId.set(dept.code, created.id);
    codeToPath.set(dept.code, path);
    log(`+ ${dept.code} — ${dept.name}`);
  }
  log(`Tổng ${codeToId.size} đơn vị`);
}

/** Danh mục lịch trực mặc định (phòng, ca, vai trò) — chỉ thêm mục còn thiếu, không ghi đè chỉnh sửa của quản trị */
async function seedDutyCatalog(): Promise<void> {
  await db
    .insert(schema.dutyRooms)
    .values(DEFAULT_DUTY_ROOMS.map((r) => ({ code: r.code, name: r.name, sortOrder: r.sortOrder })))
    .onConflictDoNothing();
  await db
    .insert(schema.dutyShiftTypes)
    .values(
      DEFAULT_DUTY_SHIFTS.map((s) => ({
        code: s.code,
        name: s.name,
        startTime: s.startTime,
        endTime: s.endTime,
        crossesMidnight: s.endTime <= s.startTime,
        isNight: s.isNight,
        color: s.color,
        sortOrder: s.sortOrder,
        active: s.active,
      })),
    )
    .onConflictDoNothing();
  await db
    .insert(schema.dutyRoles)
    .values(DEFAULT_DUTY_ROLES.map((r) => ({ code: r.code, name: r.name, requiredTitle: r.requiredTitle, sortOrder: r.sortOrder })))
    .onConflictDoNothing();
  log(`+ danh mục lịch trực mặc định (${DEFAULT_DUTY_ROOMS.length} phòng, ${DEFAULT_DUTY_SHIFTS.length} ca, ${DEFAULT_DUTY_ROLES.length} vai trò)`);
}

async function seedJobTitles(): Promise<void> {
  title('Danh mục chức danh');
  const [row] = await db.select({ total: sql<number>`count(*)::int` }).from(schema.jobTitles);
  if ((row?.total ?? 0) > 0) {
    log(`Đã có ${row!.total} chức danh — bỏ qua`);
    return;
  }
  await db
    .insert(schema.jobTitles)
    .values(DEFAULT_JOB_TITLES.map((t, i) => ({ code: t.code, name: t.name, sortOrder: i + 1 })))
    .onConflictDoNothing();
  log(`+ ${DEFAULT_JOB_TITLES.length} chức danh mặc định`);
}

async function seedWorkflow(): Promise<void> {
  title('Quy trình ký');
  const [existing] = await db
    .select({ id: schema.hsbaWorkflows.id })
    .from(schema.hsbaWorkflows)
    .where(eq(schema.hsbaWorkflows.code, DEFAULT_WORKFLOW.code))
    .limit(1);
  if (existing) {
    log(`= Quy trình "${DEFAULT_WORKFLOW.code}" đã tồn tại`);
    return;
  }
  await db.insert(schema.hsbaWorkflows).values({
    code: DEFAULT_WORKFLOW.code,
    name: DEFAULT_WORKFLOW.name,
    description: DEFAULT_WORKFLOW.description,
    steps: DEFAULT_WORKFLOW.steps as never,
    isDefault: true,
    active: true,
  });
  log(`+ ${DEFAULT_WORKFLOW.code} — ${DEFAULT_WORKFLOW.steps.length} bước ký`);
}

async function seedUtilities(): Promise<void> {
  title(`Tiện ích (${UTILITIES.length})`);
  let created = 0;
  let updated = 0;
  for (const u of UTILITIES) {
    const [existing] = await db
      .select({ id: schema.utilities.id })
      .from(schema.utilities)
      .where(eq(schema.utilities.code, u.code))
      .limit(1);
    if (existing) {
      // Cập nhật lại thông tin hiển thị theo bản seed mới nhất (đường dẫn, biểu tượng, thứ tự…)
      await db
        .update(schema.utilities)
        .set({
          name: u.name,
          description: u.description,
          icon: u.icon,
          kind: u.kind,
          route: u.route,
          permissionCode: u.permissionCode,
          placement: u.placement ?? 'sidebar',
          color: u.color,
          sortOrder: u.sortOrder,
        })
        .where(eq(schema.utilities.id, existing.id));
      updated++;
      continue;
    }
    await db.insert(schema.utilities).values({
      code: u.code,
      name: u.name,
      description: u.description,
      icon: u.icon,
      kind: u.kind,
      route: u.route,
      permissionCode: u.permissionCode,
      placement: u.placement ?? 'sidebar',
      color: u.color,
      sortOrder: u.sortOrder,
      active: true,
    });
    created++;
  }
  log(
    created > 0 || updated > 0
      ? `Đã thêm ${created} tiện ích, cập nhật ${updated}`
      : 'Tiện ích đã đầy đủ',
  );
}

async function seedJobs(): Promise<void> {
  title(`Tác vụ định kỳ (${SCHEDULED_JOBS.length})`);
  let created = 0;
  for (const j of SCHEDULED_JOBS) {
    const [existing] = await db
      .select({ id: schema.scheduledJobs.id })
      .from(schema.scheduledJobs)
      .where(eq(schema.scheduledJobs.code, j.code))
      .limit(1);
    if (existing) continue;
    await db.insert(schema.scheduledJobs).values({
      code: j.code,
      name: j.name,
      description: j.description,
      handler: j.handler,
      cron: j.cron,
      timezone: config.timezone,
      payload: j.payload as never,
      active: j.active,
    });
    created++;
  }
  log(created > 0 ? `Đã thêm ${created} tác vụ định kỳ` : 'Tác vụ định kỳ đã đầy đủ');
}

async function seedPrintTemplate(): Promise<void> {
  title('Mẫu in mặc định');
  const code = 'PHIEU_SUA_HSBA';
  const [existing] = await db
    .select({ id: schema.printTemplates.id })
    .from(schema.printTemplates)
    .where(eq(schema.printTemplates.code, code))
    .limit(1);
  if (existing) {
    log(`= Mẫu in "${code}" đã tồn tại`);
    return;
  }
  const doc = defaultHsbaPrintDocument();
  await db.insert(schema.printTemplates).values({
    code,
    name: 'Giấy đề nghị sửa hồ sơ bệnh án điện tử',
    description:
      'Mẫu in chuẩn A4 dọc: tiêu đề bệnh viện, thông tin người bệnh, nội dung đề nghị và 3 khối chữ ký xác nhận điện tử.',
    module: 'HSBA',
    docType: 'PHIEU_SUA_HSBA',
    paperSize: 'A4',
    orientation: 'portrait',
    document: doc as never,
    isDefault: true,
    active: true,
  });
  log('+ Đã tạo mẫu in PHIEU_SUA_HSBA (A4 dọc, 3 khối chữ ký)');
}

async function seedAssetLabelTemplate(): Promise<void> {
  title('Mẫu tem tài sản');
  const [existing] = await db
    .select({ id: schema.printTemplates.id })
    .from(schema.printTemplates)
    .where(eq(schema.printTemplates.code, LABEL_TEMPLATE_CODE))
    .limit(1);
  if (existing) {
    log(`= Mẫu in "${LABEL_TEMPLATE_CODE}" đã tồn tại`);
    return;
  }
  await db.insert(schema.printTemplates).values({
    code: LABEL_TEMPLATE_CODE,
    name: 'Tem tài sản 50 × 30 mm (QR + mã vạch)',
    description: 'Tem dán tài sản: QR tra cứu, mã vạch Code128, tên, khoa, năm sử dụng. Sửa được trong Trình thiết kế bản in.',
    module: 'ASSET',
    docType: LABEL_TEMPLATE_CODE,
    paperSize: 'Custom',
    orientation: 'portrait',
    document: defaultAssetLabelDocument() as never,
    isDefault: true,
    active: true,
  });
  log(`+ Đã tạo mẫu in ${LABEL_TEMPLATE_CODE} (50 × 30 mm)`);
}

async function seedAssetVoucherTemplate(): Promise<void> {
  title('Mẫu biên bản chứng từ tài sản');
  const [existing] = await db
    .select({ id: schema.printTemplates.id })
    .from(schema.printTemplates)
    .where(eq(schema.printTemplates.code, VOUCHER_TEMPLATE_CODE))
    .limit(1);
  if (existing) {
    log(`= Mẫu in "${VOUCHER_TEMPLATE_CODE}" đã tồn tại`);
    return;
  }
  await db.insert(schema.printTemplates).values({
    code: VOUCHER_TEMPLATE_CODE,
    name: 'Biên bản chứng từ tài sản (A4)',
    description: 'Biên bản bàn giao / điều chuyển / thu hồi / sửa chữa / thanh lý… — tiêu đề tự đổi theo loại nghiệp vụ. Sửa được trong Trình thiết kế bản in.',
    module: 'ASSET',
    docType: VOUCHER_TEMPLATE_CODE,
    paperSize: 'A4',
    orientation: 'portrait',
    document: defaultAssetVoucherDocument() as never,
    isDefault: true,
    active: true,
  });
  log(`+ Đã tạo mẫu in ${VOUCHER_TEMPLATE_CODE}`);
}

async function seedAssetInventoryTemplate(): Promise<void> {
  title('Mẫu biên bản kiểm kê tài sản');
  const [existing] = await db
    .select({ id: schema.printTemplates.id })
    .from(schema.printTemplates)
    .where(eq(schema.printTemplates.code, INVENTORY_TEMPLATE_CODE))
    .limit(1);
  if (existing) {
    log(`= Mẫu in "${INVENTORY_TEMPLATE_CODE}" đã tồn tại`);
    return;
  }
  await db.insert(schema.printTemplates).values({
    code: INVENTORY_TEMPLATE_CODE,
    name: 'Biên bản kiểm kê tài sản (A4 ngang)',
    description: 'Biên bản kiểm kê: hội đồng, tóm tắt kết quả, bảng sổ sách / kiểm kê / chênh lệch từng tài sản, kết luận. Sửa được trong Trình thiết kế bản in.',
    module: 'ASSET',
    docType: INVENTORY_TEMPLATE_CODE,
    paperSize: 'A4',
    orientation: 'landscape',
    document: defaultInventoryDocument() as never,
    isDefault: true,
    active: true,
  });
  log(`+ Đã tạo mẫu in ${INVENTORY_TEMPLATE_CODE}`);
}

async function seedReportTemplates(): Promise<void> {
  title('Mẫu báo cáo mẫu');
  const reportableDepts = await db
    .select({ id: schema.departments.id, code: schema.departments.code, name: schema.departments.name })
    .from(schema.departments)
    .where(and(eq(schema.departments.reportEnabled, true), eq(schema.departments.active, true)));

  if (reportableDepts.length === 0) {
    log('Không có khoa nào cần báo cáo — bỏ qua');
    return;
  }

  let created = 0;
  for (const dept of reportableDepts) {
    const [existing] = await db
      .select({ id: schema.reportTemplates.id })
      .from(schema.reportTemplates)
      .where(
        and(
          eq(schema.reportTemplates.departmentId, dept.id),
          eq(schema.reportTemplates.code, DEMO_REPORT_TEMPLATE.code),
        ),
      )
      .limit(1);
    if (existing) continue;

    const [template] = await db
      .insert(schema.reportTemplates)
      .values({
        departmentId: dept.id,
        code: DEMO_REPORT_TEMPLATE.code,
        name: DEMO_REPORT_TEMPLATE.name,
        title: DEMO_REPORT_TEMPLATE.title,
        subtitle: DEMO_REPORT_TEMPLATE.subtitle,
        footerNote: DEMO_REPORT_TEMPLATE.footerNote,
        defaultPeriod: DEMO_REPORT_TEMPLATE.defaultPeriod,
        isDefault: true,
        active: true,
      })
      .returning({ id: schema.reportTemplates.id });

    // Cột / đối tượng số liệu
    for (const col of DEMO_REPORT_TEMPLATE.columns) {
      await db.insert(schema.reportColumns).values({
        templateId: template.id,
        colKey: col.colKey,
        label: col.label,
        groupLabel: col.groupLabel,
        kind: col.kind,
        formula: 'formula' in col ? String(col.formula ?? '') : '',
        format: col.format,
        summaryKey: 'summaryKey' in col ? String(col.summaryKey ?? '') : '',
        width: col.width,
        sortOrder: col.sortOrder,
      });
    }

    // Mục → nhóm dòng → dòng
    for (const section of DEMO_REPORT_TEMPLATE.sections) {
      const [sec] = await db
        .insert(schema.reportSections)
        .values({ templateId: template.id, title: section.title, sortOrder: section.sortOrder })
        .returning({ id: schema.reportSections.id });

      const blockIds = new Map<string, number>();
      for (const row of section.rows) {
        let blockId: number | null = null;
        const blockLabel = 'blockLabel' in row ? String(row.blockLabel ?? '') : '';
        if (blockLabel) {
          if (!blockIds.has(blockLabel)) {
            const [blk] = await db
              .insert(schema.reportBlocks)
              .values({ sectionId: sec.id, label: blockLabel, sortOrder: blockIds.size + 1 })
              .returning({ id: schema.reportBlocks.id });
            blockIds.set(blockLabel, blk.id);
          }
          blockId = blockIds.get(blockLabel) ?? null;
        }
        await db.insert(schema.reportRows).values({
          sectionId: sec.id,
          blockId,
          rowLabel: row.rowLabel,
          agg: row.agg,
          sortOrder: row.sortOrder,
        });
      }
    }
    log(`+ ${dept.name}: ${DEMO_REPORT_TEMPLATE.columns.length} cột, ${DEMO_REPORT_TEMPLATE.sections.length} mục`);
    created++;
  }
  log(`Đã tạo ${created} mẫu báo cáo cho ${reportableDepts.length} khoa`);
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   QLBS — Khởi tạo dữ liệu nền                            ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`   CSDL: ${config.database.url.replace(/:\/\/[^@]*@/, '://***@')}`);

  // Kiểm tra bảng đã tồn tại chưa
  const tables = await db.execute<{ total: number }>(sql`
    select count(*)::int as total from information_schema.tables
    where table_schema = 'public' and table_name = 'users'
  `);
  const total = ((tables as unknown as { rows: { total: number }[] }).rows ?? [])[0]?.total ?? 0;
  if (!total) {
    console.error(
      '\n✗ Chưa có bảng trong CSDL. Hãy chạy `npm run db:migrate` trước rồi chạy lại lệnh này.\n',
    );
    await pool.end();
    process.exit(1);
  }

  const permissionMap = await seedPermissions();
  const roleMap = await seedRoles(permissionMap);
  await seedAdmin(roleMap);
  await seedSettings();
  if (config.seed.demo) {
    await seedDepartments();
    await seedReportTemplates();
  }
  await seedJobTitles();
  await seedDutyCatalog();
  await seedWorkflow();
  await seedUtilities();
  await seedJobs();
  await seedPrintTemplate();
  await seedAssetLabelTemplate();
  await seedAssetVoucherTemplate();
  await seedAssetInventoryTemplate();
  await seedStudioDefaultDashboard(db, log);

  console.log('\n✅ Hoàn tất khởi tạo dữ liệu nền.\n');
  console.log(`   Đăng nhập: ${config.seed.adminUser} / ${config.seed.adminPass}`);
  console.log('   (đổi mật khẩu ngay sau khi đăng nhập lần đầu)\n');

  await pool.end();
}

main().catch(async (err) => {
  console.error('\n✗ Khởi tạo thất bại:', err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});

/* Giữ tham chiếu để tránh cảnh báo unused khi mở rộng */
export const _refs = { ilike };
