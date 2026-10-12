/**
 * Sao lưu & phục hồi CSDL từ giao diện.
 *
 * - Bản sao lưu là tệp `qlbs-*.json.gz` do hàm xử lý `db.backup` tạo ra (xem
 *   scheduler/handlers.ts) nằm trong `BACKUPS_DIR` (Docker: ./data/backups trên máy chủ).
 * - Phục hồi = thay TOÀN BỘ dữ liệu hiện tại bằng dữ liệu trong bản sao lưu, chạy trong
 *   MỘT giao dịch: lỗi ở bất kỳ bảng nào → quay lui, dữ liệu hiện tại giữ nguyên.
 * - Trước khi phục hồi luôn tự tạo một bản sao lưu an toàn (`…-truoc-phuc-hoi.json.gz`)
 *   để có thể quay lại trạng thái ngay trước đó.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import type { Readable } from 'stream';
import * as zlib from 'zlib';
import { config } from '../../config/env';
import { DbService } from '../../db/db.service';
import { scheduledJobs, userBiometrics } from '../../db/schema';
import { CacheService } from '../../infra/cache/cache.service';
import { MaintenanceService } from '../../infra/maintenance/maintenance.service';
import { QueueService } from '../../infra/queue/queue.service';
import { backupFileName, rotateBackups, writeBackup, type SqlExecutor } from './backup-writer';
import { AuditService } from '../audit/audit.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import type { AccessContext } from '../../common/types/access-context';

/** Tên tệp hợp lệ (chặn đi ra ngoài thư mục sao lưu) */
const FILE_RE = /^qlbs-[A-Za-z0-9._-]+\.json(\.gz)?$/;
/** Bảng không bao giờ ghi đè khi phục hồi: lịch sử migration phải khớp với mã nguồn hiện tại */
const NEVER_RESTORE = new Set(['_qlbs_migrations']);
/** Cụm từ người dùng phải gõ để xác nhận phục hồi */
export const RESTORE_CONFIRM_TEXT = 'PHUC HOI';
/** Khoá cache cần xoá sau khi phục hồi (giữ nguyên phiên đăng nhập và hàng đợi) */
const CACHE_PREFIXES = ['auth:ctx:', 'dashboard:', 'dept:', 'hsba:', 'report:', 'setting:', 'warm:', 'digest:', 'tag:'];
const INSERT_BATCH = 500;
/** Số lần thử phục hồi khi tranh khoá, và thời gian chờ khoá mỗi lần */
const RESTORE_ATTEMPTS = 3;
const LOCK_WAIT_SECONDS = 10;

/** Mã lỗi PostgreSQL (drizzle bọc lỗi gốc trong `cause`) */
function pgErrorCode(err: unknown): string | undefined {
  let e = err as { code?: unknown; cause?: unknown } | undefined;
  for (let i = 0; i < 4 && e; i++) {
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
    e = e.cause as typeof e;
  }
  return undefined;
}

interface BackupFile {
  format?: string;
  version?: number;
  createdAt?: string;
  tables: Record<string, Record<string, unknown>[]>;
  counts?: Record<string, number>;
}

interface ColumnInfo {
  table_name: string;
  column_name: string;
  is_generated: string;
  identity_generation: string | null;
  column_default: string | null;
}

@Injectable()
export class BackupsService {
  private readonly logger = new Logger(BackupsService.name);
  private restoring = false;

  constructor(
    private readonly db: DbService,
    private readonly cache: CacheService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    private readonly scheduler: SchedulerService,
    private readonly maintenance: MaintenanceService,
  ) {}

  private get dir(): string {
    return config.storage.backupsDir;
  }

  /** Đường dẫn tuyệt đối an toàn của một tệp sao lưu */
  private resolve(name: string): string {
    const base = path.basename(String(name ?? ''));
    if (!FILE_RE.test(base)) throw new BadRequestException('Tên tệp sao lưu không hợp lệ');
    const full = path.join(this.dir, base);
    if (!fs.existsSync(full)) throw new NotFoundException(`Không tìm thấy bản sao lưu ${base}`);
    return full;
  }

  /* ------------------------------------------------------------------ Danh sách */

  list() {
    fs.mkdirSync(this.dir, { recursive: true });
    const items = fs
      .readdirSync(this.dir)
      .filter((f) => FILE_RE.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(this.dir, f));
        return {
          name: f,
          size: st.size,
          createdAt: st.mtime.toISOString(),
          kind: f.includes('truoc-phuc-hoi') ? 'pre-restore' : f.includes('tai-len') ? 'uploaded' : 'normal',
          // Bản cũ (JSON không nén, trước bản vá) chỉ chứa 17 bảng danh mục → không phục hồi được
          legacy: !f.endsWith('.gz'),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const totalSize = items.reduce((s, i) => s + i.size, 0);
    let diskFree: number | null = null;
    try {
      const st = fs.statfsSync(this.dir);
      diskFree = Number(st.bavail) * Number(st.bsize);
    } catch {
      /* statfs không khả dụng */
    }
    return { dir: this.dir, items, total: items.length, totalSize, diskFree, restoring: this.restoring };
  }

  /* ------------------------------------------------------------ Đọc nội dung */

  private async load(full: string): Promise<BackupFile> {
    const raw = fs.readFileSync(full);
    let text: string;
    try {
      text = (full.endsWith('.gz') ? zlib.gunzipSync(raw) : raw).toString('utf8');
    } catch {
      throw new BadRequestException('Tệp sao lưu bị hỏng (không giải nén được)');
    }
    let data: BackupFile;
    try {
      data = JSON.parse(text) as BackupFile;
    } catch {
      throw new BadRequestException('Tệp sao lưu bị hỏng (JSON không hợp lệ)');
    }
    if (!data || typeof data !== 'object' || !data.tables || typeof data.tables !== 'object') {
      throw new BadRequestException('Tệp không phải bản sao lưu QLBS');
    }
    return data;
  }

  /** Thông tin chi tiết một bản sao lưu: thời điểm, số dòng từng bảng, có phục hồi được không */
  async detail(name: string) {
    const full = this.resolve(name);
    const data = await this.load(full);
    const counts: Record<string, number> = {};
    for (const [t, rows] of Object.entries(data.tables)) counts[t] = Array.isArray(rows) ? rows.length : 0;
    const check = this.restorable(data);
    return {
      name: path.basename(full),
      size: fs.statSync(full).size,
      createdAt: data.createdAt ?? fs.statSync(full).mtime.toISOString(),
      format: data.format ?? 'qlbs-backup',
      version: data.version ?? 1,
      tables: Object.keys(counts).length,
      totalRows: Object.values(counts).reduce((s, n) => s + n, 0),
      counts,
      restorable: check.ok,
      reason: check.reason,
    };
  }

  private restorable(data: BackupFile): { ok: boolean; reason?: string } {
    if ((data.version ?? 1) < 2 || data.format !== 'qlbs-backup') {
      return {
        ok: false,
        reason:
          'Bản sao lưu theo định dạng cũ chỉ gồm 17 bảng danh mục (thiếu phiếu HSBA, chữ ký, nhật ký…) — phục hồi sẽ làm mất dữ liệu nên bị chặn.',
      };
    }
    for (const must of ['users', 'roles', 'permissions']) {
      if (!Array.isArray(data.tables[must]) || data.tables[must].length === 0) {
        return { ok: false, reason: `Bản sao lưu thiếu dữ liệu bảng ${must}` };
      }
    }
    return { ok: true };
  }

  download(name: string): { stream: fs.ReadStream; fileName: string; size: number } {
    const full = this.resolve(name);
    return { stream: fs.createReadStream(full), fileName: path.basename(full), size: fs.statSync(full).size };
  }

  /* ------------------------------------------------------------ Tạo / xoá / tải lên */

  /** Tìm tác vụ định kỳ dùng hàm db.backup để ghi chung lịch sử chạy */
  private async backupJob() {
    const [job] = await this.db.db.select().from(scheduledJobs).where(eq(scheduledJobs.handler, 'db.backup')).limit(1);
    return job;
  }

  async create(user: AccessContext, label?: string) {
    const job = await this.backupJob();
    const payload = { ...((job?.payload as Record<string, unknown> | null) ?? {}), ...(label ? { label } : {}) };
    const result = await this.queue.runNow('db.backup', payload, user.id, {
      jobId: job?.id,
      jobCode: job?.code ?? 'BACKUP_THU_CONG',
    });
    return result as { message: string; fileName: string; size: number };
  }

  remove(name: string, user: AccessContext) {
    const full = this.resolve(name);
    fs.rmSync(full, { force: true });
    void this.audit.log({
      userId: user.id,
      username: user.username,
      fullName: user.fullName,
      action: 'DELETE',
      module: 'BACKUP',
      entity: 'backup_file',
      entityId: path.basename(full),
      description: `Xoá bản sao lưu ${path.basename(full)}`,
    });
    return { message: `Đã xoá ${path.basename(full)}` };
  }

  /** Nhận tệp sao lưu tải lên (luồng nhị phân thô), kiểm tra hợp lệ rồi lưu vào thư mục sao lưu */
  async upload(stream: Readable, originalName: string, user: AccessContext) {
    fs.mkdirSync(this.dir, { recursive: true });
    const lower = String(originalName ?? '').toLowerCase();
    if (!lower.endsWith('.json.gz') && !lower.endsWith('.json')) {
      throw new BadRequestException('Chỉ nhận tệp .json.gz (hoặc .json) do QLBS tạo ra');
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tmp = path.join(this.dir, `.upload-${stamp}.partial`);
    const maxBytes = 1024 * 1024 * 1024; // 1 GB
    let received = 0;
    stream.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) stream.destroy(new Error('Tệp vượt quá 1 GB'));
    });
    try {
      await pipeline(stream, fs.createWriteStream(tmp));
      if (received === 0) throw new BadRequestException('Tệp rỗng');
      // Chuẩn hoá: luôn lưu dạng .json.gz
      const isGzip = (() => {
        const fd = fs.openSync(tmp, 'r');
        const b = Buffer.alloc(2);
        fs.readSync(fd, b, 0, 2, 0);
        fs.closeSync(fd);
        return b[0] === 0x1f && b[1] === 0x8b;
      })();
      const finalName = `qlbs-${stamp}-tai-len.json.gz`;
      const finalPath = path.join(this.dir, finalName);
      if (isGzip) fs.renameSync(tmp, finalPath);
      else {
        await pipeline(fs.createReadStream(tmp), zlib.createGzip({ level: 6 }), fs.createWriteStream(finalPath));
        fs.rmSync(tmp, { force: true });
      }
      let info;
      try {
        info = await this.detail(finalName);
      } catch (err) {
        fs.rmSync(finalPath, { force: true });
        throw err;
      }
      void this.audit.log({
        userId: user.id,
        username: user.username,
        fullName: user.fullName,
        action: 'UPLOAD',
        module: 'BACKUP',
        entity: 'backup_file',
        entityId: finalName,
        description: `Tải lên bản sao lưu ${originalName} → ${finalName}`,
      });
      return { message: `Đã tải lên ${originalName}`, ...info };
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  /* ------------------------------------------------------------------ Phục hồi */

  async restore(name: string, confirm: string, user: AccessContext, meta: { ip?: string; userAgent?: string }) {
    if (String(confirm ?? '').trim().toUpperCase() !== RESTORE_CONFIRM_TEXT) {
      throw new BadRequestException(`Hãy gõ đúng "${RESTORE_CONFIRM_TEXT}" để xác nhận phục hồi`);
    }
    if (this.restoring || this.maintenance.current()) {
      throw new ConflictException('Đang có một lần phục hồi khác chạy, vui lòng đợi');
    }
    const full = this.resolve(name);
    this.restoring = true;
    const started = Date.now();
    try {
      // 1) Đọc & kiểm tra bản sao lưu vào bộ nhớ trước (tệp có thể bị xoay vòng xoá sau đó)
      const data = await this.load(full);
      const check = this.restorable(data);
      if (!check.ok) throw new BadRequestException(check.reason);

      // 2) Bật bảo trì: yêu cầu mới của người khác nhận 503 "đang phục hồi" thay vì treo/ghi mất.
      //    Chờ các thao tác ghi đang xử lý dở hoàn tất (tối đa 10 giây).
      await this.maintenance.start(
        'restore',
        'Hệ thống đang phục hồi dữ liệu từ bản sao lưu — thao tác tạm dừng trong ít phút. Trang sẽ tự tải lại khi xong.',
        user.fullName || user.username,
      );
      const stillRunning = await this.maintenance.drain(10_000);
      if (stillRunning > 0) this.logger.warn(`Còn ${stillRunning} yêu cầu ghi chưa xong sau 10 giây — tiếp tục, khoá bảng sẽ chờ chúng`);

      // 3) Phục hồi — tự thử lại khi tranh khoá (deadlock / hết thời gian chờ khoá)
      const safetyName = backupFileName('truoc-phuc-hoi');
      const safetyPath = path.join(this.dir, safetyName);
      let summary: Awaited<ReturnType<BackupsService['applyRestore']>> | undefined;
      for (let attempt = 1; ; attempt++) {
        try {
          summary = await this.applyRestore(data, safetyPath);
          break;
        } catch (err) {
          // Giao dịch đã quay lui → dữ liệu hiện tại còn nguyên, bản an toàn dở dang không cần giữ
          fs.rmSync(safetyPath, { force: true });
          const code = pgErrorCode(err);
          const retryable = code === '40P01' || code === '55P03' || code === '40001';
          // Deadlock: thử lại tối đa 3 lần. Hết giờ chờ khoá (có truy vấn chạy lâu): chỉ thử thêm
          // 1 lần — tránh khoá hệ thống quá lâu với người dùng khác.
          const maxAttempts = code === '55P03' ? 2 : RESTORE_ATTEMPTS;
          if (retryable && attempt < maxAttempts) {
            this.logger.warn(`Phục hồi lần ${attempt} gặp tranh khoá (${code}) — thử lại`);
            await new Promise((r) => setTimeout(r, 1500 * attempt));
            continue;
          }
          if (retryable) {
            throw new ServiceUnavailableException(
              'Hệ thống đang bận: có thao tác chạy lâu (ví dụ báo cáo lớn) đang giữ dữ liệu. Dữ liệu CHƯA thay đổi — vui lòng thử lại sau ít phút.',
            );
          }
          throw err;
        }
      }

      // 4) Xoá cache nghiệp vụ (giữ phiên đăng nhập và hàng đợi)
      for (const p of CACHE_PREFIXES) await this.cache.delByPrefix(p).catch(() => 0);

      // Tự động khôi phục toàn bộ tệp ảnh chân dung sinh trắc học ra thư mục uploads/faces từ CSDL vừa phục hồi
      try {
        const bios = await this.db.db
          .select({ userId: userBiometrics.userId, avatarData: userBiometrics.avatarData })
          .from(userBiometrics);
        const facesDir = path.resolve(process.cwd(), 'uploads', 'faces');
        fs.mkdirSync(facesDir, { recursive: true });
        let restoredAvatars = 0;
        for (const b of bios) {
          if (b.avatarData) {
            let raw = b.avatarData;
            if (raw.includes(',')) raw = raw.split(',')[1];
            if (raw) {
              fs.writeFileSync(path.join(facesDir, `user_${b.userId}_avatar.jpg`), Buffer.from(raw, 'base64'));
              restoredAvatars++;
            }
          }
        }
        if (restoredAvatars > 0) {
          this.logger.log(`Đã tự động khôi phục ${restoredAvatars} tệp ảnh chân dung sinh trắc học ra đĩa.`);
        }
      } catch (err) {
        this.logger.warn(`Lỗi khôi phục tệp ảnh sinh trắc học ra đĩa sau khi phục hồi: ${err}`);
      }

      // Lịch chạy định kỳ có thể khác trong bản sao lưu → đăng ký lại
      await this.scheduler.syncSchedules().catch((err: Error) => this.logger.warn(`Đồng bộ lịch tác vụ: ${err.message}`));

      // Xoay vòng theo số bản cần giữ của tác vụ sao lưu (không bao giờ xoá bản an toàn vừa tạo)
      const job = await this.backupJob().catch(() => undefined);
      const keepRaw = Number((job?.payload as { keep?: unknown } | null)?.keep ?? 14);
      rotateBackups(this.dir, Number.isFinite(keepRaw) && keepRaw >= 1 ? Math.floor(keepRaw) : 14, [safetyName]);

      const durationMs = Date.now() - started;
      const message = `Đã phục hồi ${summary.tables} bảng · ${summary.rows.toLocaleString('vi-VN')} dòng từ ${path.basename(full)} (${(durationMs / 1000).toFixed(1)}s). Bản an toàn trước phục hồi: ${safetyName}`;
      this.logger.warn(message);
      await this.audit.log({
        userId: user.id,
        username: user.username,
        fullName: user.fullName,
        action: 'RESTORE',
        module: 'BACKUP',
        entity: 'database',
        entityId: path.basename(full),
        description: message,
        afterData: { counts: summary.counts, skipped: summary.skipped, emptied: summary.emptied },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return { message, durationMs, safetyBackup: safetyName, ...summary };
    } finally {
      this.restoring = false;
      await this.maintenance.end();
    }
  }

  private async applyRestore(data: BackupFile, safetyPath: string) {
    return this.db.db.transaction(async (tx) => {
      const rowsOf = <T>(res: unknown): T[] => ((res as { rows?: T[] }).rows ?? []) as T[];

      const colRows = rowsOf<ColumnInfo>(
        await tx.execute(sql.raw(`
          select c.table_name, c.column_name, c.is_generated, c.identity_generation, c.column_default
          from information_schema.columns c
          join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
          where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
          order by c.table_name, c.ordinal_position`)),
      );
      const columns = new Map<string, ColumnInfo[]>();
      for (const c of colRows) columns.set(c.table_name, [...(columns.get(c.table_name) ?? []), c]);
      const allTables = [...columns.keys()].filter((t) => /^[a-z_][a-z0-9_]*$/.test(t));
      const current = allTables.filter((t) => !NEVER_RESTORE.has(t));

      // Khoá độc quyền TOÀN BỘ bảng trước khi làm gì khác: chờ tối đa 10 giây cho các giao
      // dịch đang chạy xong; sau đó không ai đọc/ghi chen vào được cho tới khi phục hồi xong.
      await tx.execute(sql.raw(`set local lock_timeout = '${LOCK_WAIT_SECONDS}s'`));
      await tx.execute(sql.raw(`lock table ${allTables.map((t) => `"${t}"`).join(', ')} in access exclusive mode`));
      await tx.execute(sql.raw('set local lock_timeout = 0'));

      // Bản an toàn chụp NGAY TRONG giao dịch đang giữ khoá → không lọt thay đổi nào
      // giữa lúc sao lưu an toàn và lúc thay dữ liệu.
      const safety = await writeBackup(tx as unknown as SqlExecutor, safetyPath);
      this.logger.log(`Bản an toàn trước phục hồi: ${path.basename(safetyPath)} (${safety.totalRows} dòng)`);

      // Thứ tự chèn theo khoá ngoại: bảng cha trước, bảng con sau
      const fks = rowsOf<{ child: string; parent: string }>(
        await tx.execute(sql.raw(`
          select cl.relname as child, pl.relname as parent
          from pg_constraint k
          join pg_class cl on cl.oid = k.conrelid
          join pg_class pl on pl.oid = k.confrelid
          join pg_namespace n on n.oid = cl.relnamespace
          where k.contype = 'f' and n.nspname = 'public'`)),
      );
      const order = topoSort(current, fks);

      // Tắt kiểm tra khoá ngoại trong giao dịch nếu có quyền (tài khoản chủ CSDL của Docker có).
      // Dùng savepoint để nếu không có quyền thì bỏ qua, vẫn phục hồi theo thứ tự khoá ngoại.
      let fkRelaxed = false;
      try {
        await tx.transaction(async (sp) => {
          await sp.execute(sql.raw('set local session_replication_role = replica'));
        });
        fkRelaxed = true;
      } catch {
        this.logger.warn('Không tắt được kiểm tra khoá ngoại tạm thời — phục hồi theo thứ tự phụ thuộc');
      }

      // Làm trống mọi bảng (trừ migration) trong một lệnh — không CASCADE ra ngoài tập này
      if (current.length) {
        await tx.execute(sql.raw(`truncate table ${current.map((t) => `"${t}"`).join(', ')} restart identity`));
      }

      const counts: Record<string, number> = {};
      const skipped = Object.keys(data.tables).filter((t) => !columns.has(t) && !NEVER_RESTORE.has(t));
      const emptied = current.filter((t) => !Array.isArray(data.tables[t]));
      let rows = 0;

      for (const table of order) {
        const src = data.tables[table];
        if (!Array.isArray(src) || src.length === 0) {
          counts[table] = 0;
          continue;
        }
        const cols = columns.get(table) ?? [];
        const insertable = cols.filter((c) => c.is_generated !== 'ALWAYS');
        // Chỉ chèn các cột có trong bản sao lưu → cột mới thêm sau này nhận giá trị mặc định
        const present = new Set<string>();
        for (const r of src.slice(0, 200)) for (const k of Object.keys(r ?? {})) present.add(k);
        const use = insertable.filter((c) => present.has(c.column_name)).map((c) => c.column_name);
        if (use.length === 0) {
          counts[table] = 0;
          continue;
        }
        const colList = use.map((c) => `"${c}"`).join(', ');
        const overriding = cols.some((c) => c.identity_generation === 'ALWAYS' && use.includes(c.column_name))
          ? 'overriding system value'
          : '';
        for (let i = 0; i < src.length; i += INSERT_BATCH) {
          const batch = JSON.stringify(src.slice(i, i + INSERT_BATCH));
          await tx.execute(
            sql`insert into ${sql.raw(`"${table}" (${colList}) ${overriding}`)} select ${sql.raw(colList)} from json_populate_recordset(null::${sql.raw(`"${table}"`)}, ${batch}::json)`,
          );
        }
        counts[table] = src.length;
        rows += src.length;
      }

      // Đặt lại bộ đếm tự tăng (serial/identity) theo giá trị lớn nhất vừa phục hồi
      for (const table of current) {
        for (const c of columns.get(table) ?? []) {
          const isSerial = (c.column_default ?? '').startsWith('nextval(') || !!c.identity_generation;
          if (!isSerial) continue;
          await tx.execute(
            sql.raw(
              `select setval(pg_get_serial_sequence('"${table}"', '${c.column_name}'), coalesce((select max("${c.column_name}") from "${table}"), 0) + 1, false)`,
            ),
          );
        }
      }

      // Lượt chạy tác vụ đang dở trong bản sao lưu (vd chính lần sao lưu đó) sẽ không bao giờ kết thúc
      if (columns.has('job_runs')) {
        await tx.execute(
          sql.raw(
            `update job_runs set status = 'CANCELLED', finished_at = coalesce(finished_at, now()), message = 'Bị gián đoạn — dữ liệu được phục hồi từ bản sao lưu' where status in ('RUNNING', 'PENDING')`,
          ),
        );
      }

      // Kiểm tra toàn vẹn khoá ngoại nếu đã tạm tắt: vi phạm → huỷ toàn bộ giao dịch
      if (fkRelaxed) {
        const bad = await this.findFkViolations(tx);
        if (bad.length) {
          throw new BadRequestException(
            `Dữ liệu trong bản sao lưu vi phạm ràng buộc khoá ngoại (${bad.slice(0, 5).join('; ')}) — đã huỷ, dữ liệu hiện tại giữ nguyên`,
          );
        }
      }

      return { tables: Object.values(counts).filter((n) => n > 0).length, rows, counts, skipped, emptied };
    });
  }

  /** Dò các dòng có khoá ngoại trỏ tới bản ghi không tồn tại (chỉ khoá ngoại 1 cột) */
  private async findFkViolations(tx: { execute: (q: ReturnType<typeof sql.raw>) => Promise<unknown> }): Promise<string[]> {
    const res = await tx.execute(
      sql.raw(`
        select cl.relname as child, a.attname as col, pl.relname as parent, pa.attname as pcol
        from pg_constraint k
        join pg_class cl on cl.oid = k.conrelid
        join pg_class pl on pl.oid = k.confrelid
        join pg_namespace n on n.oid = cl.relnamespace
        join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
        join pg_attribute pa on pa.attrelid = k.confrelid and pa.attnum = k.confkey[1]
        where k.contype = 'f' and n.nspname = 'public' and array_length(k.conkey, 1) = 1`),
    );
    const list = ((res as { rows?: { child: string; col: string; parent: string; pcol: string }[] }).rows ?? []);
    const bad: string[] = [];
    for (const f of list) {
      const r = await tx.execute(
        sql.raw(
          `select count(*)::int as n from "${f.child}" c where c."${f.col}" is not null and not exists (select 1 from "${f.parent}" p where p."${f.pcol}" = c."${f.col}")`,
        ),
      );
      const n = ((r as { rows?: { n: number }[] }).rows ?? [])[0]?.n ?? 0;
      if (n > 0) bad.push(`${f.child}.${f.col} → ${f.parent}: ${n} dòng`);
    }
    return bad;
  }
}

/** Sắp xếp bảng theo phụ thuộc khoá ngoại (cha trước con); vòng lặp/tự tham chiếu được bỏ qua */
function topoSort(tables: string[], fks: { child: string; parent: string }[]): string[] {
  const set = new Set(tables);
  const deps = new Map<string, Set<string>>();
  for (const t of tables) deps.set(t, new Set());
  for (const { child, parent } of fks) {
    if (child !== parent && set.has(child) && set.has(parent)) deps.get(child)!.add(parent);
  }
  const out: string[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (t: string): void => {
    if (state.get(t) === 2 || state.get(t) === 1) return;
    state.set(t, 1);
    for (const p of deps.get(t) ?? []) visit(p);
    state.set(t, 2);
    out.push(t);
  };
  for (const t of [...tables].sort()) visit(t);
  return out;
}
