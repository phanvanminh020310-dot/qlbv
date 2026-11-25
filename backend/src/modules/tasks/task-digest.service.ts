/**
 * TỔNG HỢP CÔNG VIỆC HÀNG TUẦN — gởi mỗi người một bản tóm tắt (chuông 🔔 + Telegram).
 *
 * Chạy nền 10 phút/lần; chỉ gởi vào ngày/giờ cấu hình (`task.digest.weekday`, `task.digest.hour`,
 * giờ Việt Nam). Mỗi người nhận tối đa một bản trong ngày nhờ cờ `users.task_digest_sent_at`
 * (claim nguyên tử) nên khởi động lại tiến trình không gởi trùng. Người không có việc gì thì bỏ qua.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { users } from '../../db/schema';
import { NotificationCenterService } from '../notifications/notification-center.service';
import { SettingsService } from '../settings/settings.service';

const TZ = 'Asia/Ho_Chi_Minh';
const OPEN = `'ASSIGNED','ACCEPTED','IN_PROGRESS','ON_HOLD','RETURNED'`;
const WEEKDAYS = ['', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'];

export interface DigestStats {
  open: number;
  toAccept: number;
  inProgress: number;
  onHold: number;
  returned: number;
  overdue: number;
  dueWeek: number;
  mySubmitted: number;
  doneWeek: number;
  doneOnTime: number;
  doneLate: number;
  toReview: number;
  assignedOpen: number;
  assignedOverdue: number;
}

export interface DigestItem {
  code: string;
  title: string;
  dueAt: Date | string | null;
  status: string;
  priority: string;
}

const EMPTY: DigestStats = {
  open: 0, toAccept: 0, inProgress: 0, onHold: 0, returned: 0, overdue: 0, dueWeek: 0, mySubmitted: 0,
  doneWeek: 0, doneOnTime: 0, doneLate: 0, toReview: 0, assignedOpen: 0, assignedOverdue: 0,
};

const rowsOf = <T>(res: unknown): T[] => {
  const r = res as { rows?: T[] };
  return Array.isArray(r?.rows) ? r.rows : Array.isArray(res) ? (res as T[]) : [];
};

const fmtDay = (d: Date | string | null) => {
  if (!d) return '';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  const local = new Date(x.getTime() + 7 * 3600_000);
  return `${String(local.getUTCDate()).padStart(2, '0')}/${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** 0h (giờ Việt Nam) của ngày chứa `now`. */
function localDayStart(now: Date): Date {
  const local = new Date(now.getTime() + 7 * 3600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 7 * 3600_000);
}

/** Người dùng có nội dung đáng gởi không (không spam người không có việc). */
export function digestHasContent(s: DigestStats): boolean {
  return s.open + s.mySubmitted + s.doneWeek + s.toReview + s.assignedOpen > 0;
}

/** Soạn nội dung tổng hợp (văn bản thuần, dùng chung cho chuông và Telegram). */
export function composeDigest(s: DigestStats, items: DigestItem[], now = new Date()): { title: string; body: string } {
  const lines: string[] = [];
  if (s.open) {
    const parts = [`${s.open} đang mở`];
    if (s.toAccept) parts.push(`${s.toAccept} chờ nhận`);
    if (s.inProgress) parts.push(`${s.inProgress} đang làm`);
    if (s.onHold) parts.push(`${s.onHold} tạm hoãn`);
    if (s.returned) parts.push(`${s.returned} bị trả lại`);
    lines.push(`📋 Việc của tôi: ${parts.join(' · ')}`);
  } else {
    lines.push('📋 Việc của tôi: không còn việc đang mở');
  }
  if (s.overdue || s.dueWeek) lines.push(`⏰ Quá hạn: ${s.overdue} · Đến hạn 7 ngày tới: ${s.dueWeek}`);
  if (s.mySubmitted) lines.push(`📤 Đã gửi, đang chờ duyệt: ${s.mySubmitted}`);
  lines.push(
    s.doneWeek
      ? `✅ 7 ngày qua: hoàn thành ${s.doneWeek} việc${s.doneOnTime + s.doneLate ? ` (đúng hạn ${s.doneOnTime}${s.doneLate ? `, trễ ${s.doneLate}` : ''})` : ''}`
      : '✅ 7 ngày qua: chưa hoàn thành việc nào',
  );
  if (s.toReview) lines.push(`🔍 Chờ tôi duyệt: ${s.toReview}`);
  if (s.assignedOpen) lines.push(`👥 Tôi đã giao: ${s.assignedOpen} đang thực hiện${s.assignedOverdue ? ` · ${s.assignedOverdue} quá hạn` : ''}`);
  if (items.length) {
    lines.push('', 'Cần chú ý:');
    const nowMs = now.getTime();
    for (const it of items.slice(0, 5)) {
      const due = it.dueAt ? new Date(it.dueAt) : null;
      const late = due && due.getTime() < nowMs;
      const urgent = it.priority === 'URGENT' ? '🔴 ' : it.priority === 'HIGH' ? '🟠 ' : '';
      const title = it.title.length > 70 ? `${it.title.slice(0, 67)}…` : it.title;
      lines.push(`• ${urgent}${it.code} ${title}${due ? ` — hạn ${fmtDay(due)}${late ? ' (quá hạn)' : ''}` : ''}`);
    }
  }
  return { title: `Tổng hợp công việc tuần ${fmtDay(now)}`, body: lines.join('\n') };
}

@Injectable()
export class TaskDigestService {
  private readonly logger = new Logger('TaskDigest');
  private running = false;

  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationCenterService,
  ) {}

  @Interval('task-weekly-digest', 10 * 60_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (err) {
      this.logger.warn(`Tổng hợp công việc tuần lỗi (bỏ qua): ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async config() {
    const enabled = (await this.settings.get<boolean>('task.digest.enabled', true)) !== false;
    let weekday = Math.floor(Number(await this.settings.get<number>('task.digest.weekday', 1)));
    if (!(weekday >= 1 && weekday <= 7)) weekday = 1;
    let hour = Math.floor(Number(await this.settings.get<number>('task.digest.hour', 7)));
    if (!(hour >= 0 && hour <= 23)) hour = 7;
    return { enabled, weekday, hour, weekdayLabel: WEEKDAYS[weekday]! };
  }

  /** Đến giờ gởi chưa — trả về mốc 0h hôm nay (giờ VN) nếu đến giờ, ngược lại null. */
  static dueWindow(now: Date, weekday: number, hour: number): Date | null {
    const local = new Date(now.getTime() + 7 * 3600_000);
    const wd = local.getUTCDay() || 7;
    if (wd !== weekday || local.getUTCHours() < hour) return null;
    return localDayStart(now);
  }

  /** Số liệu tổng hợp của nhiều người (hoặc một người) trong một lượt truy vấn. */
  async stats(now: Date, userId?: number): Promise<Map<number, DigestStats>> {
    const only = (col: string) => (userId ? sql.raw(` and ${col} = ${Math.floor(userId)}`) : sql.raw(''));
    const weekAgo = new Date(now.getTime() - 7 * 86400_000);
    const weekAhead = new Date(now.getTime() + 7 * 86400_000);
    const [mine, done, review, assigned] = await Promise.all([
      this.db.db.execute(sql`select assignee_id as uid,
          count(*) filter (where status in (${sql.raw(OPEN)}))::int as "open",
          count(*) filter (where status = 'ASSIGNED')::int as "toAccept",
          count(*) filter (where status in ('ACCEPTED','IN_PROGRESS'))::int as "inProgress",
          count(*) filter (where status = 'ON_HOLD')::int as "onHold",
          count(*) filter (where status = 'RETURNED')::int as "returned",
          count(*) filter (where status in (${sql.raw(OPEN)}) and due_at < ${now})::int as "overdue",
          count(*) filter (where status in (${sql.raw(OPEN)}) and due_at >= ${now} and due_at < ${weekAhead})::int as "dueWeek",
          count(*) filter (where status = 'SUBMITTED')::int as "mySubmitted"
        from tasks where deleted_at is null and assignee_id is not null${only('assignee_id')} group by assignee_id`),
      this.db.db.execute(sql`select assignee_id as uid, count(*)::int as "doneWeek",
          count(*) filter (where due_at is not null and completed_at <= due_at)::int as "doneOnTime",
          count(*) filter (where due_at is not null and completed_at > due_at)::int as "doneLate"
        from tasks where deleted_at is null and status = 'DONE' and completed_at >= ${weekAgo} and assignee_id is not null${only('assignee_id')}
        group by assignee_id`),
      this.db.db.execute(sql`select coalesce(reviewer_id, assigner_id) as uid, count(*)::int as "toReview"
        from tasks where deleted_at is null and status = 'SUBMITTED' and coalesce(reviewer_id, assigner_id) is not null${only('coalesce(reviewer_id, assigner_id)')}
        group by 1`),
      this.db.db.execute(sql`select assigner_id as uid,
          count(*)::int as "assignedOpen",
          count(*) filter (where due_at < ${now})::int as "assignedOverdue"
        from tasks where deleted_at is null and status in (${sql.raw(OPEN)}, 'SUBMITTED') and assigner_id is not null
          and assignee_id is distinct from assigner_id${only('assigner_id')}
        group by assigner_id`),
    ]);
    const out = new Map<number, DigestStats>();
    const merge = (res: unknown) => {
      for (const r of rowsOf<Record<string, unknown>>(res)) {
        const uid = Number(r['uid']);
        const cur = out.get(uid) ?? { ...EMPTY };
        for (const [k, v] of Object.entries(r)) if (k !== 'uid') (cur as unknown as Record<string, number>)[k] = Number(v ?? 0);
        out.set(uid, cur);
      }
    };
    merge(mine);
    merge(done);
    merge(review);
    merge(assigned);
    return out;
  }

  /** Tối đa 5 việc cần chú ý mỗi người: quá hạn / gần hạn nhất, ưu tiên cao trước. */
  async focusItems(userIds: number[]): Promise<Map<number, DigestItem[]>> {
    const out = new Map<number, DigestItem[]>();
    if (!userIds.length) return out;
    const res = await this.db.db.execute(sql`select uid, code, title, "dueAt", status, priority from (
        select assignee_id as uid, code, title, due_at as "dueAt", status, priority,
          row_number() over (partition by assignee_id order by due_at asc nulls last,
            case priority when 'URGENT' then 0 when 'HIGH' then 1 when 'NORMAL' then 2 else 3 end, id) as rn
        from tasks where deleted_at is null and status in (${sql.raw(OPEN)})
          and assignee_id in (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})
          and (due_at is not null or priority in ('URGENT','HIGH'))
      ) x where rn <= 5 order by uid, rn`);
    for (const r of rowsOf<DigestItem & { uid: number }>(res)) {
      const uid = Number(r.uid);
      out.set(uid, [...(out.get(uid) ?? []), { code: r.code, title: r.title, dueAt: r.dueAt, status: r.status, priority: r.priority }]);
    }
    return out;
  }

  /** Bản xem trước cho chính người dùng (trang Cá nhân). */
  async preview(userId: number, now = new Date()) {
    const s = (await this.stats(now, userId)).get(userId) ?? { ...EMPTY };
    const items = (await this.focusItems([userId])).get(userId) ?? [];
    return { hasContent: digestHasContent(s), stats: s, ...composeDigest(s, items, now) };
  }

  private async send(userId: number, digest: { title: string; body: string }, now: Date) {
    await this.notifications.notify([userId], {
      title: digest.title,
      body: digest.body,
      level: 'INFO',
      link: '/cong-viec',
      module: 'TASK_DIGEST',
      entityId: new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10),
      externalKind: 'task.weeklyDigest',
    });
  }

  /** Gởi ngay cho chính mình (nút “Gửi thử” ở trang Cá nhân) — không đụng cờ chống trùng. */
  async sendTest(userId: number, now = new Date()) {
    const p = await this.preview(userId, now);
    await this.send(userId, p, now);
    return p;
  }

  /** Lượt chạy định kỳ. `force` bỏ qua kiểm tra ngày/giờ (dùng cho kiểm thử). */
  async run(now = new Date(), opts: { force?: boolean } = {}): Promise<{ sent: number; skipped: number }> {
    const cfg = await this.config();
    if (!cfg.enabled) return { sent: 0, skipped: 0 };
    const dayStart = opts.force ? localDayStart(now) : TaskDigestService.dueWindow(now, cfg.weekday, cfg.hour);
    if (!dayStart) return { sent: 0, skipped: 0 };

    const pending = await this.db.db
      .select({ id: users.id })
      .from(users)
      .where(and(isNull(users.deletedAt), eq(users.active, true), eq(users.taskDigestEnabled, true),
        or(isNull(users.taskDigestSentAt), lt(users.taskDigestSentAt, dayStart))));
    if (!pending.length) return { sent: 0, skipped: 0 };
    const pendingIds = new Set(pending.map((u) => u.id));
    const all = await this.stats(now);
    const targets = [...all.entries()].filter(([uid, s]) => pendingIds.has(uid) && digestHasContent(s));
    const items = await this.focusItems(targets.map(([uid]) => uid));

    let sent = 0;
    for (const [uid, s] of targets) {
      const [claimed] = await this.db.db
        .update(users)
        .set({ taskDigestSentAt: now })
        .where(and(eq(users.id, uid), or(isNull(users.taskDigestSentAt), lt(users.taskDigestSentAt, dayStart))))
        .returning({ id: users.id });
      if (!claimed) continue;
      await this.send(uid, composeDigest(s, items.get(uid) ?? [], now), now);
      sent++;
    }
    if (sent) this.logger.log(`Đã gởi tổng hợp công việc tuần cho ${sent} người`);
    return { sent, skipped: pending.length - sent };
  }

  async setEnabled(userId: number, enabled: boolean) {
    await this.db.db.update(users).set({ taskDigestEnabled: enabled }).where(eq(users.id, userId));
    return this.myStatus(userId);
  }

  async myStatus(userId: number) {
    const cfg = await this.config();
    const [u] = await this.db.db
      .select({ enabled: users.taskDigestEnabled, sentAt: users.taskDigestSentAt, hasTelegram: sql<boolean>`coalesce(${users.telegramChatId}, '') <> ''` })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return {
      enabled: u?.enabled ?? true,
      lastSentAt: u?.sentAt ?? null,
      hasTelegram: !!u?.hasTelegram,
      globalEnabled: cfg.enabled,
      schedule: `${cfg.weekdayLabel} hàng tuần, lúc ${String(cfg.hour).padStart(2, '0')}:00`,
    };
  }
}
