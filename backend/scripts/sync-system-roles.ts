/**
 * Đồng bộ vai trò HỆ THỐNG theo danh mục chuẩn trong `src/db/seed-data.ts`.
 *
 * Chạy khi hệ thống đã dùng lâu (bản seed cũ đã nằm trong CSDL) và cần nâng lên
 * ma trận phân quyền chuẩn mới mà KHÔNG cần xoá dữ liệu:
 *
 *   npx tsx scripts/sync-system-roles.ts           # xem trước thay đổi (dry-run)
 *   npx tsx scripts/sync-system-roles.ts --apply   # thực hiện
 *
 * Tác dụng (idempotent — chạy lặp lại an toàn):
 *  - Tạo vai trò hệ thống còn thiếu (vd LANH_DAO).
 *  - Cập nhật tên/mô tả/phạm vi/ưu tiên/màu của vai trò hệ thống theo chuẩn.
 *  - Thay tập quyền của vai trò hệ thống bằng tập chuẩn mới (báo trước mọi
 *    quyền bị GỠ — kể cả quyền quản trị thường đã thêm bằng tay).
 *  - SUPER_ADMIN: không động vào (toàn quyền ngầm).
 *  - Vai trò do đơn vị TỰ TẠO (isSystem=false): không hề bị đụng.
 */
import 'dotenv/config';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { permissions, rolePermissions, roles } from '../src/db/schema';
import { PERMISSIONS, ROLES } from '../src/db/seed-data';

const APPLY = process.argv.includes('--apply');
const SUPER = 'SUPER_ADMIN';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('✗ Thiếu DATABASE_URL trong môi trường');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const db = drizzle(pool, { schema: { permissions, rolePermissions, roles } });

  // Đảm bảo danh mục quyền đã đủ (seed chạy khi cài mới; ở đây upsert nhẹ cho chắc)
  const permidByCode = new Map<string, number>();
  {
    const all = await db.select({ id: permissions.id, code: permissions.code }).from(permissions);
    for (const p of all) permidByCode.set(p.code, p.id);
  }
  const missingPerms = PERMISSIONS.filter((p) => !permidByCode.has(p.code));
  if (missingPerms.length > 0) {
    console.log(`\n▸ Danh mục quyền còn thiếu ${missingPerms.length} mã — upsert trước.`);
    if (APPLY) {
      for (const p of missingPerms) {
        await db
          .insert(permissions)
          .values({ code: p.code, name: p.name, module: p.module, action: p.action, description: p.description ?? '' })
          .onConflictDoNothing();
      }
      const all = await db.select({ id: permissions.id, code: permissions.code }).from(permissions);
      permidByCode.clear();
      for (const p of all) permidByCode.set(p.code, p.id);
    }
  }

  let changed = 0;
  for (const seed of ROLES) {
    if (seed.code === SUPER) continue; // toàn quyền ngầm — không đồng bộ

    const [existing] = await db.select().from(roles).where(eq(roles.code, seed.code)).limit(1);

    if (!existing) {
      console.log(`\n+ VAI TRÒ MỚI: ${seed.code} — ${seed.name}`);
      if (APPLY) {
        await db.insert(roles).values({
          code: seed.code,
          name: seed.name,
          description: seed.description,
          dataScope: seed.dataScope,
          priority: seed.priority,
          color: seed.color,
          isSystem: true,
        });
      }
      changed++;
    } else {
      const diffs: string[] = [];
      if (existing.name !== seed.name) diffs.push(`tên: "${existing.name}" → "${seed.name}"`);
      if (existing.description !== seed.description) diffs.push('cập nhật mô tả');
      if (existing.dataScope !== seed.dataScope) diffs.push(`phạm vi: ${existing.dataScope} → ${seed.dataScope}`);
      if (existing.priority !== seed.priority) diffs.push(`ưu tiên: ${existing.priority} → ${seed.priority}`);
      if (existing.color !== seed.color) diffs.push(`màu: ${existing.color} → ${seed.color}`);
      if (existing.isSystem !== true) diffs.push('đánh dấu vai trò hệ thống');
      if (diffs.length > 0) {
        console.log(`\n▸ ${seed.code}: ${diffs.join(' · ')}`);
        if (APPLY) {
          await db
            .update(roles)
            .set({
              name: seed.name,
              description: seed.description,
              dataScope: seed.dataScope,
              priority: seed.priority,
              color: seed.color,
              isSystem: true,
              updatedAt: new Date(),
            })
            .where(eq(roles.id, existing.id));
        }
        changed++;
      }
    }

    // ---- Đồng bộ tập quyền
    const [roleRow] = await db.select().from(roles).where(eq(roles.code, seed.code)).limit(1);
    const roleId = roleRow?.id ?? -1;
    const wantCodes = seed.permissions === '*' ? PERMISSIONS.map((p) => p.code) : seed.permissions;
    const want = new Set(wantCodes);
    const current = roleId > 0
      ? new Set(
          (
            await db
              .select({ code: permissions.code })
              .from(rolePermissions)
              .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
              .where(eq(rolePermissions.roleId, roleId))
          ).map((r) => r.code),
        )
      : new Set<string>();

    const toAdd = [...want].filter((c) => !current.has(c));
    const toRemove = [...current].filter((c) => !want.has(c));
    if (toAdd.length === 0 && toRemove.length === 0) {
      console.log(`  ${seed.code}: quyền đã chuẩn (${want.size}/${want.size})`);
      continue;
    }
    console.log(
      `  ${seed.code}: hiện ${current.size} quyền → chuẩn ${want.size} · THÊM ${toAdd.length} · GỠ ${toRemove.length}`,
    );
    if (toRemove.length > 0) {
      console.log(`    ⚠ sẽ GỠ: ${toRemove.join(', ')}`);
    }
    if (APPLY && roleRow) {
      await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleRow.id));
      if (wantCodes.length > 0) {
        const ids = wantCodes
          .map((c) => permidByCode.get(c))
          .filter((x): x is number => typeof x === 'number');
        const skipped = wantCodes.filter((c) => !permidByCode.has(c));
        if (skipped.length > 0) console.log(`    (bỏ qua mã chưa có trong danh mục: ${skipped.join(', ')})`);
        await db
          .insert(rolePermissions)
          .values(ids.map((permissionId) => ({ roleId: roleRow.id, permissionId })))
          .onConflictDoNothing();
      }
      changed++;
    }
  }

  console.log(
    `\n${APPLY ? '✅ ĐÃ ĐỒNG BỘ' : 'ℹ CHỈ XEM TRƯỚC — thêm --apply để áp dụng'} (${changed} thay đổi)`,
  );
  // Nhắc dọn cache ngữ cảnh người dùng để quyền mới có hiệu lực ngay:
  // các phiên sẽ tự cập nhật khi cache TTL hết hoặc khi đăng nhập lại.
  await pool.end();
}

main().catch((err) => {
  console.error('✗ Lỗi:', err);
  process.exit(1);
});
