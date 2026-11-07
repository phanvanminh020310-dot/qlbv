/**
 * Thư viện hàm xử lý cho tác vụ định kỳ.
 *
 * Mỗi hàm nhận `JobContext` và trả về `{ message, ...số liệu }` để ghi vào lịch sử chạy.
 * Muốn thêm tác vụ mới: viết hàm ở đây rồi thêm vào `builtinHandlers` — sau đó
 * quản trị có thể tạo tác vụ từ giao diện mà không cần sửa mã nguồn.
 */
import { Logger } from '@nestjs/common';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../../config/env';
import type { DbService } from '../../db/db.service';
import { departments, roles, scheduledJobs, users } from '../../db/schema';
import type { CacheService } from '../../infra/cache/cache.service';
import type { MaintenanceService } from '../../infra/maintenance/maintenance.service';
import type { JobContext, JobHandler, JobResult } from '../../infra/queue/queue.service';
import { runAssetDueReminder } from '../assets/asset-reminder';
import type { RealtimeService } from '../realtime/realtime.service';
import type { SettingsService } from '../settings/settings.service';
import {
  backupFileName,
  cleanupBackupTemporaryArtifacts,
  cleanupStorageWriteTemporaryArtifacts,
  formatBytes,
  rotateBackups,
  writeBackupBundle,
  type SqlExecutor,
} from '../backups/backup-writer';

export interface HandlerDeps {
  db: DbService;
  cache: CacheService;
  logger: Logger;
  settings: SettingsService;
  maintenance: MaintenanceService;
  realtime?: RealtimeService;
}

export function builtinHandlers(deps: HandlerDeps): Map<string, JobHandler> {
  const { db, cache, logger, settings, maintenance } = deps;
  const handlers = new Map<string, JobHandler>();

  /* ------------------------------------------------------------- Bộ đệm */

  handlers.set('cache.warm', async (): Promise<JobResult> => {
    const deptRows = await db.db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(and(eq(departments.active, true), isNull(departments.deletedAt)));
    const roleRows = await db.db.select({ id: roles.id, code: roles.code }).from(roles).where(eq(roles.active, true));
    await cache.set('warm:departments', deptRows, config.cache.structureTtl);
    await cache.set('warm:roles', roleRows, config.cache.structureTtl);
    await cache.set('warm:at', new Date().toISOString(), 86_400);
    return { message: `Đã nạp ${deptRows.length} khoa và ${roleRows.length} vai trò vào bộ đệm` };
  });

  handlers.set('cache.cleanup', async (): Promise<JobResult> => {
    const before = cache.stats();
    await cache.delByPrefix('tmp:');
    await cache.delByPrefix('warm:');
    const after = cache.stats();
    return {
      message: 'Đã dọn bộ đệm tạm',
      backend: after.backend,
      sizeBefore: before.size,
      sizeAfter: after.size,
    };
  });

  /* ---------------------------------------------------------- Phiên đăng nhập */

  handlers.set('session.cleanup', async (): Promise<JobResult> => {
    // Thu hồi phiên của những tài khoản đã bị vô hiệu hoá
    const disabled = await db.db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.active, false));
    let revoked = 0;
    for (const u of disabled) {
      const indexKey = `auth:user-sessions:${u.id}`;
      const sessionIds = await cache.smembers(indexKey);
      for (const sid of sessionIds) {
        await cache.del(`auth:session:${sid}`);
        revoked++;
      }
      if (sessionIds.length > 0) await cache.del(indexKey);
      await cache.del(`auth:ctx:${u.id}`);
    }
    return { message: `Đã thu hồi ${revoked} phiên của ${disabled.length} tài khoản bị vô hiệu hoá` };
  });

  /* ------------------------------------------------------------ Lưu trữ tệp */

  /**
   * Chỉ dọn cây exports do QLBS tự sinh. Tuyệt đối không gọi hàm này cho
   * STORAGE_DIR/uploads: đó là tệp HSBA, phông và ảnh sinh trắc học cần giữ.
   */
  const cleanupExpiredExports = (dir: string, cutoff: number): { removed: number; freedBytes: number } => {
    if (!fs.existsSync(dir)) return { removed: 0, freedBytes: 0 };
    let removed = 0;
    let freedBytes = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          const child = cleanupExpiredExports(full, cutoff);
          removed += child.removed;
          freedBytes += child.freedBytes;
          // Chỉ bỏ thư mục trống của exports sau khi đã dọn con; không theo symlink.
          if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
          continue;
        }
        if (!entry.isFile()) continue;
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(full);
          removed++;
          freedBytes += stat.size;
        }
      } catch (err) {
        logger.warn(`Không xoá được tệp kết xuất ${full}: ${(err as Error).message}`);
      }
    }
    return { removed, freedBytes };
  };

  handlers.set('storage.cleanup', async (): Promise<JobResult> => {
    if (maintenance.current()) {
      throw new Error('Đang phục hồi dữ liệu; tác vụ dọn lưu trữ được hoãn để không đụng vào archive/staging đang sử dụng.');
    }
    const [keep, exportDays, temporaryHours, jobRunDays] = await Promise.all([
      settings.backupKeepCount(),
      settings.exportRetentionDays(),
      settings.backupTemporaryRetentionHours(),
      settings.jobRunRetentionDays(),
    ]);
    const exports = cleanupExpiredExports(config.storage.exportsDir, Date.now() - exportDays * 86_400_000);
    // Backup chỉ xoay vòng theo số lượng, không xóa theo tuổi: nếu tác vụ backup bị ngừng,
    // các điểm khôi phục tốt cuối cùng vẫn không bị mất chỉ vì đã quá ngày.
    const backupRemoved = rotateBackups(config.storage.backupsDir, keep);
    const temporary = cleanupBackupTemporaryArtifacts(config.storage.backupsDir, temporaryHours * 3_600_000);
    // Chỉ temporary có marker QLBS (atomic write bị ngắt), không quét/xóa tệp HSBA hay uploads hoàn chỉnh.
    const storageTemporary = cleanupStorageWriteTemporaryArtifacts(config.storage.dir, temporaryHours * 3_600_000);
    // File Studio hết hạn không còn hữu ích thì xóa luôn metadata để người dùng không thấy link hỏng.
    const cutoff = new Date(Date.now() - exportDays * 86_400_000);
    const studioResult = await db.db.execute(sql`delete from studio_subscription_files where created_at < ${cutoff}`);
    const studioRows = (studioResult as unknown as { rowCount?: number }).rowCount ?? 0;
    // Chỉ dọn job_runs kỹ thuật; audit_logs và mọi dữ liệu nghiệp vụ/điểm danh vẫn được giữ.
    const jobRuns = await pruneJobRuns(db, jobRunDays);
    const removed = exports.removed + backupRemoved.length + temporary.removed + storageTemporary.removed;
    const freedBytes = exports.freedBytes + temporary.freedBytes + storageTemporary.freedBytes;
    return {
      message: `Đã dọn ${exports.removed} tệp xuất, ${temporary.removed + storageTemporary.removed} tệp dở dang có marker QLBS, ${backupRemoved.length} bộ backup cũ; giữ ${keep} bộ backup đầy đủ`,
      removed,
      freedBytes,
      exportsRemoved: exports.removed,
      backupsRemoved: backupRemoved,
      temporaryRemoved: temporary.removed,
      storageTemporaryRemoved: storageTemporary.removed,
      studioRowsRemoved: studioRows,
      jobRunsRemoved: jobRuns,
      keep,
    };
  });

  /* ------------------------------------------------------------ Nhật ký */

  handlers.set('audit.digest', async (): Promise<JobResult> => {
    const rows = await db.db.execute<{ module: string; total: number }>(sql`
      select module, count(*)::int as total
      from audit_logs
      where created_at > now() - interval '1 day'
      group by module
      order by total desc
    `);
    const list = (rows as unknown as { rows: { module: string; total: number }[] }).rows ?? [];
    const summary = list.map((r) => `${r.module}: ${r.total}`).join(', ') || 'không có hoạt động';
    await cache.set('digest:audit:24h', { at: new Date().toISOString(), list }, 86_400);
    return { message: `Hoạt động 24 giờ qua — ${summary}`, modules: list.length };
  });

  /* ------------------------------------------------------------ Báo cáo */

  handlers.set('report.daily-digest', async (ctx: JobContext): Promise<JobResult> => {
    const day = (ctx.payload?.['date'] as string) ?? new Date().toISOString().slice(0, 10);
    const rows = await db.db.execute<{ name: string }>(sql`
      select d.name
      from departments d
      where d.active = true and d.report_enabled = true and d.deleted_at is null
        and not exists (
          select 1 from report_entries e
          join report_templates t on t.id = e.template_id
          where t.department_id = d.id and e.entry_date = ${day}::date
        )
      order by d.name
    `);
    const missing = ((rows as unknown as { rows: { name: string }[] }).rows ?? []).map((r) => r.name);
    await cache.set(`digest:missing:${day}`, missing, 86_400);
    return {
      message:
        missing.length === 0
          ? `Tất cả các khoa đã nhập số liệu ngày ${day}`
          : `${missing.length} khoa chưa nhập số liệu ngày ${day}: ${missing.join(', ')}`,
      date: day,
      missingCount: missing.length,
      departments: missing,
    };
  });

  handlers.set('report.snapshot', async (ctx: JobContext): Promise<JobResult> => {
    const payload = ctx.payload ?? {};
    const dateFrom = (payload['dateFrom'] as string) ?? new Date().toISOString().slice(0, 10);
    const dateTo = (payload['dateTo'] as string) ?? dateFrom;
    const [row] = await db.db.execute<{ total: number }>(sql`
      select count(*)::int as total from report_snapshots
      where date_from = ${dateFrom}::date and date_to = ${dateTo}::date
    `).then((r) => (r as unknown as { rows: { total: number }[] }).rows ?? []);
    return {
      message: `Kỳ ${dateFrom} → ${dateTo}: hiện có ${row?.total ?? 0} bản chốt số liệu`,
      dateFrom,
      dateTo,
    };
  });

  /* ------------------------------------------------------------ CSDL */

  handlers.set('db.backup', async (ctx?: JobContext): Promise<JobResult> => {
    if (maintenance.current()) {
      throw new Error('Đang phục hồi dữ liệu; sao lưu định kỳ được hoãn để không xoay vòng/xóa nhầm bộ backup đang phục hồi.');
    }
    /*
     * Bộ sao lưu đầy đủ: mọi bảng public (tự bao phủ bảng của tính năng/migration
     * tương lai) + toàn bộ STORAGE_DIR (HSBA, phông, ảnh khuôn mặt). Tất cả được
     * staging trước khi công bố tên chính thức, nên backup lỗi không trở thành điểm
     * khôi phục thiếu dữ liệu và cũng không kích hoạt xoay vòng xóa bản tốt.
     */
    const dir = config.storage.backupsDir;
    const fileName = backupFileName(String((ctx?.payload as { label?: unknown } | undefined)?.label ?? ''));
    const keep = await settings.backupKeepCount();
    const bundle = await db.db.transaction(
      async (tx) => writeBackupBundle(tx as unknown as SqlExecutor, {
        backupsDir: dir,
        storageDir: config.storage.dir,
        fileName,
      }),
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );

    // Chỉ xoay vòng sau khi cả CSDL lẫn archive uploads đã hoàn tất.
    const removed = rotateBackups(dir, keep, [fileName]);
    const sizeText = formatBytes(bundle.database.size + bundle.storage.size);
    logger.log(
      `Sao lưu đầy đủ: ${fileName} — ${Object.keys(bundle.database.counts).length} bảng, ${bundle.database.totalRows} dòng, ${bundle.storage.files} tệp lưu trữ, ${sizeText}`,
    );
    return {
      message: `Đã sao lưu ${Object.keys(bundle.database.counts).length} bảng · ${bundle.database.totalRows.toLocaleString('vi-VN')} dòng · ${bundle.storage.files} tệp lưu trữ · ${sizeText}${removed.length ? ` (đã xoá ${removed.length} bộ cũ, giữ ${keep})` : ` (giữ ${keep} bộ mới nhất)`}`,
      fileName,
      size: bundle.database.size,
      storageSize: bundle.storage.size,
      storageFileName: bundle.storage.fileName,
      storageFiles: bundle.storage.files,
      totalRows: bundle.database.totalRows,
      counts: bundle.database.counts,
      removed,
    };
  });

  /* ------------------------------------------------------------ Tài sản */

  handlers.set('asset.due-reminder', async (ctx?: JobContext): Promise<JobResult> => {
    const days = Number((ctx?.payload as { days?: unknown } | undefined)?.days ?? 15);
    return runAssetDueReminder(db, Number.isFinite(days) ? days : 15, deps.realtime);
  });

  /* ------------------------------------------------------------ Hàng đợi */

  handlers.set('jobs.stats', async (): Promise<JobResult> => {
    const rows = await db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(scheduledJobs)
      .where(eq(scheduledJobs.active, true));
    return { message: `Có ${rows[0]?.total ?? 0} tác vụ định kỳ đang bật` };
  });

  return handlers;
}

/** Đăng ký toàn bộ hàm xử lý có sẵn vào hàng đợi */
export function registerBuiltinHandlers(
  queue: { registerHandler: (code: string, handler: JobHandler) => void },
  deps: HandlerDeps,
): Map<string, JobHandler> {
  const handlers = builtinHandlers(deps);
  for (const [code, handler] of handlers) queue.registerHandler(code, handler);
  return handlers;
}

/** Dọn các lần chạy cũ (giữ lịch sử gọn) */
export async function pruneJobRuns(db: DbService, keepDays = 90): Promise<number> {
  const cutoff = new Date(Date.now() - keepDays * 86_400_000);
  const res = await db.db.execute(sql`delete from job_runs where started_at < ${cutoff}`);
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}

export { lt };
