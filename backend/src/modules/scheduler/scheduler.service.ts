/**
 * Tác vụ định kỳ & hàng đợi công việc.
 *
 * Quản trị cấu hình được: mã tác vụ, biểu thức cron, múi giờ, tham số, bật/tắt.
 * Mỗi lần chạy đều ghi vào `job_runs` để tra cứu lịch sử và chẩn đoán lỗi.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleInit,
} from '@nestjs/common';
import { CronExpressionParser } from 'cron-parser';
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { config } from '../../config/env';
import { DbService } from '../../db/db.service';
import { jobRuns, scheduledJobs } from '../../db/schema';
import type { JobStatus } from '../../db/schema/types';
import { buildPage, type AdvancedQueryDto, type Paginated, parseFilters } from '../../common/dto/query.dto';
import { CacheService } from '../../infra/cache/cache.service';
import { MaintenanceService } from '../../infra/maintenance/maintenance.service';
import type { JobContext, JobHandler, JobResult } from '../../infra/queue/queue.service';
import { QueueService } from '../../infra/queue/queue.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SettingsService } from '../settings/settings.service';
import { builtinHandlers, registerBuiltinHandlers } from './handlers';

export interface UpsertJobDto {
  code: string;
  name: string;
  description?: string;
  handler: string;
  cron: string;
  timezone?: string;
  payload?: Record<string, unknown>;
  active?: boolean;
  allowOverlap?: boolean;
  timeoutSec?: number;
  maxRetries?: number;
}

const HANDLER_LABELS: Record<string, string> = {
  'cache.warm': 'Làm nóng bộ đệm',
  'cache.cleanup': 'Dọn dẹp bộ đệm',
  'session.cleanup': 'Dọn phiên đăng nhập',
  'storage.cleanup': 'Dọn tệp kết xuất & rác sao lưu',
  'audit.digest': 'Tổng hợp nhật ký hoạt động',
  'report.daily-digest': 'Nhắc nhập báo cáo hằng ngày',
  'report.snapshot': 'Chốt số liệu báo cáo kỳ',
  'db.backup': 'Sao lưu CSDL',
  'jobs.stats': 'Thống kê hàng đợi',
};

const HANDLER_DESCRIPTIONS: Record<string, string> = {
  'cache.warm': 'Nạp sẵn danh mục khoa, vai trò vào bộ đệm cho trang chủ tải nhanh hơn',
  'cache.cleanup': 'Xoá các khoá bộ đệm tạm',
  'session.cleanup': 'Thu hồi phiên đăng nhập của tài khoản đã bị vô hiệu hoá',
  'storage.cleanup': 'Dọn tệp xuất quá hạn, tệp backup dở dang và xoay vòng các bộ backup đầy đủ',
  'audit.digest': 'Tổng hợp số liệu thao tác trong 24 giờ qua',
  'report.daily-digest': 'Liệt kê các khoa chưa nhập số liệu báo cáo trong ngày',
  'report.snapshot': 'Kiểm tra và chốt số liệu báo cáo của kỳ đã kết thúc',
  'db.backup': 'Sao lưu logic toàn bộ CSDL ra tệp JSON trong thư mục backups',
  'jobs.stats': 'Thống kê số tác vụ định kỳ đang bật',
};

const JOB_SORTABLE = {
  code: scheduledJobs.code,
  name: scheduledJobs.name,
  handler: scheduledJobs.handler,
  cron: scheduledJobs.cron,
  active: scheduledJobs.active,
  lastRunAt: scheduledJobs.lastRunAt,
  lastStatus: scheduledJobs.lastStatus,
  createdAt: scheduledJobs.createdAt,
} as const;

function jobOrderBy(query: { sortBy?: string; sortDir?: 'asc' | 'desc' }) {
  const col = JOB_SORTABLE[(query.sortBy ?? '') as keyof typeof JOB_SORTABLE];
  if (!col) return [asc(scheduledJobs.id)];
  const dir = query.sortDir === 'desc' ? desc : asc;
  return [dir(col), asc(scheduledJobs.id)];
}

@Injectable()
export class SchedulerService implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly running = new Set<string>();

  constructor(
    private readonly db: DbService,
    private readonly cache: CacheService,
    private readonly queue: QueueService,
    private readonly realtime: RealtimeService,
    private readonly settings: SettingsService,
    private readonly maintenance: MaintenanceService,
  ) {}

  async onModuleInit(): Promise<void> {
    // 1. Đăng ký các hàm xử lý có sẵn trong hệ thống
    const builtins = registerBuiltinHandlers(this.queue, {
      db: this.db,
      cache: this.cache,
      logger: this.logger,
      settings: this.settings,
      maintenance: this.maintenance,
      realtime: this.realtime,
    });

    // 2. Bọc mỗi hàm để tự động ghi lịch sử chạy và cập nhật trạng thái tác vụ
    for (const [code, handler] of builtins) {
      this.queue.registerHandler(code, (ctx) => this.tracked(code, handler, ctx));
    }

    this.logger.log(`Đã đăng ký ${builtins.size} hàm xử lý: ${[...builtins.keys()].join(', ')}`);
  }

  /**
   * Đăng ký hàm xử lý từ module nghiệp vụ khác (Studio…).
   * Tự bọc theo dõi: ghi lịch sử chạy + cập nhật trạng thái tác vụ như builtin.
   */
  registerHandler(code: string, handler: JobHandler): void {
    this.queue.registerHandler(code, (ctx) => this.tracked(code, handler, ctx));
  }

  /**
   * Nạp lịch SAU KHI mọi module đã khởi tạo xong — các module khác
   * (HSBA, Studio…) đăng ký hàm xử lý trong onModuleInit của chúng,
   * nên phải chờ đến lượt này hasHandler mới đầy đủ.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (config.queue.autoSchedule) await this.syncSchedules();
  }

  /** Bọc hàm xử lý để theo dõi lịch sử chạy */
  private async tracked(
    code: string,
    handler: JobHandler,
    ctx: JobContext,
  ): Promise<JobResult | void> {
    const started = Date.now();
    const [run] = await this.db.db
      .insert(jobRuns)
      .values({
        jobId: ctx.jobId ?? null,
        jobCode: ctx.jobCode ?? code,
        status: 'RUNNING',
        trigger: ctx.trigger,
        triggeredBy: ctx.userId ?? null,
      })
      .returning({ id: jobRuns.id });

    try {
      const result = (await handler(ctx)) as JobResult | void;
      const durationMs = Date.now() - started;
      if (run) {
        await this.db.db
          .update(jobRuns)
          .set({
            status: 'SUCCESS',
            finishedAt: new Date(),
            durationMs,
            message: String((result as JobResult | undefined)?.message ?? 'Hoàn tất'),
            result: (result ?? {}) as never,
          })
          .where(eq(jobRuns.id, run.id));
      }
      await this.markJobRun(ctx, 'SUCCESS', durationMs, '');
      return result;
    } catch (err) {
      const durationMs = Date.now() - started;
      const message = (err as Error).message;
      if (run) {
        await this.db.db
          .update(jobRuns)
          .set({
            status: 'FAILED',
            finishedAt: new Date(),
            durationMs,
            message,
            errorStack: (err as Error).stack ?? '',
          })
          .where(eq(jobRuns.id, run.id));
      }
      await this.markJobRun(ctx, 'FAILED', durationMs, message);
      throw err;
    }
  }

  private async markJobRun(
    ctx: JobContext,
    status: JobStatus,
    durationMs: number,
    error: string,
  ): Promise<void> {
    await this.db.db
      .update(scheduledJobs)
      .set({
        lastRunAt: new Date(),
        lastStatus: status,
        lastDurationMs: durationMs,
        lastError: error,
        runCount: sql`${scheduledJobs.runCount} + 1`,
        ...(status === 'FAILED' ? { failCount: sql`${scheduledJobs.failCount} + 1` } : {}),
        updatedAt: new Date(),
      })
      // Theo id (hoặc mã) TÁC VỤ — trước đây dùng mã hàm xử lý nên không cập nhật được dòng nào
      .where(ctx.jobId ? eq(scheduledJobs.id, ctx.jobId) : eq(scheduledJobs.code, ctx.jobCode ?? ctx.code));
  }

  /** Đẩy toàn bộ lịch đang bật vào hàng đợi */
  async syncSchedules(): Promise<{ synced: number; skipped: string[] }> {
    const jobs = await this.db.db.select().from(scheduledJobs).where(eq(scheduledJobs.active, true));
    let synced = 0;
    const skipped: string[] = [];
    for (const job of jobs) {
      if (!this.queue.hasHandler(job.handler)) {
        this.logger.warn(`Tác vụ ${job.code}: chưa có hàm xử lý "${job.handler}" — bỏ qua`);
        skipped.push(job.code);
        continue;
      }
      await this.queue.upsertSchedule({
        code: job.code,
        handler: job.handler,
        jobId: job.id,
        cron: job.cron,
        timezone: job.timezone,
        payload: job.payload,
        active: true,
      });
      synced++;
    }
    this.logger.log(`Đã nạp ${synced}/${jobs.length} tác vụ định kỳ`);
    return { synced, skipped };
  }

  async list(query: AdvancedQueryDto): Promise<Paginated<Record<string, unknown>>> {
    const where: SQL[] = [];
    if (query.activeOnly) where.push(eq(scheduledJobs.active, true));
    if (query.q?.trim()) {
      const like = `%${query.q.trim()}%`;
      where.push(
        or(
          ilike(scheduledJobs.name, like),
          ilike(scheduledJobs.code, like),
          ilike(scheduledJobs.handler, like),
        ) as SQL,
      );
    }
    for (const f of parseFilters(query.filters)) {
      if (f.field === 'active') where.push(eq(scheduledJobs.active, f.value === 'true'));
      if (f.field === 'lastStatus') where.push(eq(scheduledJobs.lastStatus, f.value as JobStatus));
    }
    const condition = where.length ? and(...where) : undefined;

    const [countRow] = await this.db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(scheduledJobs)
      .where(condition);

    const rows = await this.db.db
      .select()
      .from(scheduledJobs)
      .where(condition)
      .orderBy(asc(scheduledJobs.id))
      .limit(query.limit)
      .offset(query.offset);

    const items = rows.map((r) => ({
      ...r,
      hasHandler: this.queue.hasHandler(r.handler),
      nextRun: this.nextRunOf(r.cron, r.timezone),
      handlerLabel: HANDLER_LABELS[r.handler] ?? r.handler,
    }));

    return buildPage(items, countRow?.total ?? 0, query.page, query.pageSize);
  }

  /** Tính lần chạy kế tiếp — hiển thị cho người dùng */
  nextRunOf(cron: string, timezone = 'Asia/Ho_Chi_Minh'): string | null {
    try {
      return CronExpressionParser.parse(cron, { tz: timezone }).next().toDate().toISOString();
    } catch {
      return null;
    }
  }

  async findOne(id: number) {
    const [job] = await this.db.db
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.id, id))
      .limit(1);
    if (!job) throw new NotFoundException('Không tìm thấy tác vụ');
    return { ...job, runs: await this.runs(job.id, 50, job.handler) };
  }

  async runs(jobId: number, limit = 50, legacyHandler?: string) {
    return this.db.db
      .select()
      .from(jobRuns)
      .where(
        legacyHandler
          ? or(
              eq(jobRuns.jobId, jobId),
              // Lần chạy ghi bởi bản cũ: thiếu job_id, job_code là mã hàm xử lý
              and(isNull(jobRuns.jobId), eq(jobRuns.jobCode, legacyHandler)),
            )
          : eq(jobRuns.jobId, jobId),
      )
      .orderBy(desc(jobRuns.startedAt))
      .limit(limit);
  }

  async allRuns(query: AdvancedQueryDto): Promise<Paginated<Record<string, unknown>>> {
    const where: SQL[] = [];
    if (query.q?.trim()) where.push(ilike(jobRuns.jobCode, `%${query.q.trim()}%`));
    for (const f of parseFilters(query.filters)) {
      if (f.field === 'status') where.push(eq(jobRuns.status, f.value as JobStatus));
      if (f.field === 'jobCode') where.push(eq(jobRuns.jobCode, f.value));
    }
    const condition = where.length ? and(...where) : undefined;
    const [countRow] = await this.db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(jobRuns)
      .where(condition);
    const rows = await this.db.db
      .select()
      .from(jobRuns)
      .where(condition)
      .orderBy(desc(jobRuns.startedAt))
      .limit(query.limit)
      .offset(query.offset);
    return buildPage(rows, countRow?.total ?? 0, query.page, query.pageSize);
  }

  async create(dto: UpsertJobDto) {
    this.assertCron(dto.cron);
    const code = dto.code.trim().toUpperCase().replace(/[^A-Z0-9_.-]/g, '_');
    const dup = await this.db.db
      .select({ id: scheduledJobs.id })
      .from(scheduledJobs)
      .where(eq(scheduledJobs.code, code))
      .limit(1);
    if (dup.length > 0) throw new BadRequestException(`Mã tác vụ "${code}" đã tồn tại`);
    if (!this.queue.hasHandler(dto.handler)) {
      throw new BadRequestException(
        `Chưa có hàm xử lý "${dto.handler}". Danh sách có sẵn: ${this.queue.listHandlers().join(', ')}`,
      );
    }

    const nextRun = this.nextRunOf(dto.cron, dto.timezone);
    const [created] = await this.db.db
      .insert(scheduledJobs)
      .values({
        code,
        name: dto.name,
        description: dto.description ?? '',
        handler: dto.handler,
        cron: dto.cron,
        timezone: dto.timezone ?? 'Asia/Ho_Chi_Minh',
        payload: (dto.payload ?? {}) as never,
        active: dto.active ?? true,
        allowOverlap: dto.allowOverlap ?? false,
        timeoutSec: dto.timeoutSec ?? 600,
        maxRetries: dto.maxRetries ?? 2,
        nextRunAt: nextRun ? new Date(nextRun) : null,
      })
      .returning();

    if (created.active) {
      await this.queue.upsertSchedule({
        code: created.code,
        handler: created.handler,
        jobId: created.id,
        cron: created.cron,
        timezone: created.timezone,
        payload: created.payload,
        active: true,
      });
    }
    return { ...created, nextRun };
  }

  async update(id: number, dto: Partial<UpsertJobDto>) {
    const current = await this.findOne(id);
    if (dto.cron) this.assertCron(dto.cron);
    if (dto.handler && !this.queue.hasHandler(dto.handler)) {
      throw new BadRequestException(`Chưa có hàm xử lý "${dto.handler}"`);
    }
    const cron = dto.cron ?? current.cron;
    const timezone = dto.timezone ?? current.timezone;
    const nextRun = this.nextRunOf(cron, timezone);

    const [updated] = await this.db.db
      .update(scheduledJobs)
      .set({
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.handler !== undefined ? { handler: dto.handler } : {}),
        ...(dto.cron !== undefined ? { cron: dto.cron } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
        ...(dto.payload !== undefined ? { payload: dto.payload as never } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.allowOverlap !== undefined ? { allowOverlap: dto.allowOverlap } : {}),
        ...(dto.timeoutSec !== undefined ? { timeoutSec: dto.timeoutSec } : {}),
        ...(dto.maxRetries !== undefined ? { maxRetries: dto.maxRetries } : {}),
        nextRunAt: nextRun ? new Date(nextRun) : null,
        updatedAt: new Date(),
      })
      .where(eq(scheduledJobs.id, id))
      .returning();

    await this.queue.removeSchedule(current.code);
    if (updated.active) {
      await this.queue.upsertSchedule({
        code: updated.code,
        handler: updated.handler,
        jobId: updated.id,
        cron: updated.cron,
        timezone: updated.timezone,
        payload: updated.payload,
        active: true,
      });
    }
    return { ...updated, nextRun };
  }

  async remove(id: number) {
    const job = await this.findOne(id);
    await this.queue.removeSchedule(job.code);
    await this.db.db.delete(scheduledJobs).where(eq(scheduledJobs.id, id));
    return { message: `Đã xoá tác vụ ${job.name}` };
  }

  /** Bấm "Chạy ngay" trên giao diện */
  async runNow(id: number, userId?: number) {
    const job = await this.findOne(id);
    if (this.running.has(job.code) && !job.allowOverlap) {
      throw new BadRequestException('Tác vụ đang chạy, vui lòng đợi hoàn tất');
    }
    this.running.add(job.code);
    const started = Date.now();
    try {
      const result = await this.queue.runNow(job.handler, job.payload, userId, { jobId: job.id, jobCode: job.code });
      return {
        message: String((result as JobResult | undefined)?.message ?? 'Tác vụ đã chạy xong'),
        durationMs: Date.now() - started,
        result,
      };
    } finally {
      this.running.delete(job.code);
    }
  }

  async toggle(id: number, active: boolean) {
    return this.update(id, { active });
  }

  /** Danh mục hàm xử lý có sẵn — gợi ý khi tạo tác vụ mới */
  availableHandlers() {
    return [...builtinHandlers({ db: this.db, cache: this.cache, logger: this.logger, settings: this.settings, maintenance: this.maintenance, realtime: this.realtime }).keys()].map(
      (code) => ({
        code,
        label: HANDLER_LABELS[code] ?? code,
        description: HANDLER_DESCRIPTIONS[code] ?? '',
      }),
    );
  }

  async stats() {
    const [total] = await this.db.db.select({ total: sql<number>`count(*)::int` }).from(scheduledJobs);
    const [active] = await this.db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(scheduledJobs)
      .where(eq(scheduledJobs.active, true));
    const [failed] = await this.db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(scheduledJobs)
      .where(eq(scheduledJobs.lastStatus, 'FAILED'));
    const recent = await this.db.db
      .select()
      .from(jobRuns)
      .orderBy(desc(jobRuns.startedAt))
      .limit(10);
    return {
      total: total?.total ?? 0,
      active: active?.total ?? 0,
      failed: failed?.total ?? 0,
      driver: this.queue.driver,
      recent,
    };
  }

  private assertCron(cron: string): void {
    try {
      CronExpressionParser.parse(cron);
    } catch {
      throw new BadRequestException(
        `Biểu thức cron không hợp lệ: "${cron}". Ví dụ: "0 6 * * *" (6 giờ sáng mỗi ngày)`,
      );
    }
  }
}
