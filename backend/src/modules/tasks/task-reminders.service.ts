/**
 * NHẮC HẠN & CẢNH BÁO QUÁ HẠN — chạy nền 10 phút/lần trong tiến trình API.
 *
 * Mỗi công việc chỉ nhắc trước hạn 1 lần và cảnh báo quá hạn 1 lần (cờ `due_reminded_at`,
 * `overdue_notified_at`); đổi hạn chót sẽ xoá cờ để nhắc lại theo hạn mới.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { tasks } from '../../db/schema';
import { SettingsService } from '../settings/settings.service';
import { TasksService } from './tasks.service';

const OPEN = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'ON_HOLD', 'RETURNED'] as const;
const fmt = (d: Date | null) =>
  d ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d) : '';

@Injectable()
export class TaskRemindersService {
  private readonly logger = new Logger('TaskReminders');
  private running = false;

  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
    private readonly tasksService: TasksService,
  ) {}

  @Interval('task-reminders', 10 * 60_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (err) {
      this.logger.warn(`Nhắc hạn công việc lỗi (bỏ qua): ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Trả về số thông báo nhắc trước hạn và cảnh báo quá hạn đã gởi. */
  async run(now = new Date()): Promise<{ dueSoon: number; overdue: number }> {
    const hoursBefore = Number(await this.settings.get<number>('task.reminder.hoursBefore', 24)) || 0;
    const overdueOn = (await this.settings.get<boolean>('task.overdue.notify', true)) !== false;
    let dueSoon = 0;
    let overdue = 0;

    if (hoursBefore > 0) {
      const horizon = new Date(now.getTime() + hoursBefore * 3600_000);
      const rows = await this.db.db
        .select()
        .from(tasks)
        .where(and(isNull(tasks.deletedAt), inArray(tasks.status, [...OPEN]), isNull(tasks.dueRemindedAt), sql`${tasks.dueAt} > ${now} and ${tasks.dueAt} <= ${horizon}`))
        .limit(500);
      for (const t of rows) {
        const [claimed] = await this.db.db.update(tasks).set({ dueRemindedAt: now }).where(and(eq(tasks.id, t.id), isNull(tasks.dueRemindedAt))).returning({ id: tasks.id });
        if (!claimed || !t.assigneeId) continue;
        await this.tasksService.notify([t.assigneeId], t, {
          title: 'Công việc sắp đến hạn',
          body: `${t.code} · ${t.title} — Hạn: ${fmt(t.dueAt)}`,
          level: 'WARNING',
          kind: 'task.dueSoon',
        });
        await this.tasksService.writeLog(this.db.db, t.id, null, 'REMIND_DUE', t.status, t.status, `Nhắc hạn trước ${hoursBefore} giờ`, null);
        dueSoon++;
      }
    }

    if (overdueOn) {
      const rows = await this.db.db
        .select()
        .from(tasks)
        .where(and(isNull(tasks.deletedAt), inArray(tasks.status, [...OPEN, 'SUBMITTED']), isNull(tasks.overdueNotifiedAt), sql`${tasks.dueAt} < ${now}`))
        .limit(500);
      for (const t of rows) {
        const [claimed] = await this.db.db.update(tasks).set({ overdueNotifiedAt: now }).where(and(eq(tasks.id, t.id), isNull(tasks.overdueNotifiedAt))).returning({ id: tasks.id });
        if (!claimed) continue;
        // Việc đang chờ duyệt: nhắc người duyệt; còn lại nhắc người thực hiện + người giao
        const targets = t.status === 'SUBMITTED' ? [t.reviewerId ?? t.assignerId] : [t.assigneeId, t.assignerId];
        await this.tasksService.notify([...new Set(targets.filter((v): v is number => !!v))], t, {
          title: t.status === 'SUBMITTED' ? 'Công việc quá hạn đang chờ duyệt' : 'Công việc đã quá hạn',
          body: `${t.code} · ${t.title} — Hạn: ${fmt(t.dueAt)}`,
          level: 'ERROR',
          kind: 'task.overdue',
        });
        await this.tasksService.writeLog(this.db.db, t.id, null, 'OVERDUE', t.status, t.status, 'Cảnh báo quá hạn', null);
        overdue++;
      }
    }
    if (dueSoon || overdue) this.logger.log(`Đã nhắc ${dueSoon} việc sắp đến hạn, ${overdue} việc quá hạn`);
    return { dueSoon, overdue };
  }
}
