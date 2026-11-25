/**
 * BÁO CÁO – THỐNG KÊ CÔNG VIỆC: tổng quan, chuỗi thời gian ngày/tuần/tháng, hiệu suất theo
 * nhân viên/khoa/dự án, xuất Excel (nhiều sheet), CSV, Word, JSON.
 *
 * Nhóm kỳ báo cáo theo NGÀY GIAO việc (cohort) để các tỷ lệ nhất quán; số việc hoàn thành
 * trên chuỗi thời gian tính theo ngày duyệt hoàn thành.
 */
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { sql, type SQL } from 'drizzle-orm';
import * as ExcelJS from 'exceljs';
import type { AccessContext } from '../../common/types/access-context';
import { DbService } from '../../db/db.service';
import type { TaskPriority, TaskStatus } from '../../db/schema';
import { TASK_PERMS, deptScope, inScope } from './task-access';
import { TASK_PRIORITY_LABEL, TASK_STATUS_LABEL, performanceScore } from './task-workflow';
import type { TaskReportQueryDto } from './tasks.dto';

const TZ = 'Asia/Ho_Chi_Minh';

type Granularity = 'day' | 'week' | 'month';

export interface PerfRow {
  key: number | null;
  name: string;
  extra: string;
  assigned: number;
  cancelled: number;
  done: number;
  onTime: number;
  late: number;
  doneWithDue: number;
  open: number;
  overdue: number;
  submitted: number;
  everSubmitted: number;
  returned: number;
  returnTimes: number;
  avgHours: number | null;
  hours: number;
  completionRate: number | null;
  onTimeRate: number | null;
  returnRate: number | null;
  score: number | null;
}

type DetailRow = Record<string, unknown> & { statusLabel: string; priorityLabel: string; evaluation: string };

const ymdLocal = (d = new Date()) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const addDays = (ymd: string, delta: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

/** Ngày bắt đầu bucket (khớp date_trunc của PostgreSQL: tuần bắt đầu Thứ Hai). */
export function bucketStart(ymd: string, g: Granularity): string {
  if (g === 'day') return ymd;
  if (g === 'month') return `${ymd.slice(0, 7)}-01`;
  const d = new Date(`${ymd}T00:00:00Z`);
  const wd = d.getUTCDay() || 7;
  return addDays(ymd, 1 - wd);
}

export function buildBuckets(from: string, to: string, g: Granularity): string[] {
  const out: string[] = [];
  let cur = bucketStart(from, g);
  const end = bucketStart(to, g);
  let guard = 0;
  while (cur <= end && guard++ < 2000) {
    out.push(cur);
    if (g === 'day') cur = addDays(cur, 1);
    else if (g === 'week') cur = addDays(cur, 7);
    else {
      const d = new Date(`${cur}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      cur = d.toISOString().slice(0, 10);
    }
  }
  return out;
}

export function bucketLabel(b: string, g: Granularity): string {
  if (g === 'month') return `${b.slice(5, 7)}/${b.slice(0, 4)}`;
  if (g === 'week') return `Tuần ${b.slice(8, 10)}/${b.slice(5, 7)}`;
  return `${b.slice(8, 10)}/${b.slice(5, 7)}`;
}

const rowsOf = <T>(res: unknown): T[] => {
  const r = res as { rows?: T[] };
  return Array.isArray(r?.rows) ? r.rows : Array.isArray(res) ? (res as T[]) : [];
};
const num = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v));
const rate = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);
const pct = (v: number | null): string => (v === null ? '—' : `${Math.round(v * 1000) / 10}%`);
const fmtDateTime = (v: unknown): string => {
  if (!v) return '';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
};

@Injectable()
export class TaskReportsService {
  constructor(private readonly db: DbService) {}

  private filters(user: AccessContext, q: TaskReportQueryDto) {
    const scope = deptScope(user, TASK_PERMS.report);
    if (scope !== null && scope.length === 0) throw new ForbiddenException('Bạn không có quyền xem báo cáo công việc');
    const to = q.to ?? ymdLocal();
    const from = q.from ?? addDays(to, -29);
    if (from > to) throw new BadRequestException('Từ ngày phải trước đến ngày');
    const days = (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400_000;
    if (days > 366 * 5) throw new BadRequestException('Khoảng thời gian tối đa 5 năm');
    let granularity: Granularity = q.granularity ?? (days > 120 ? 'month' : days > 31 ? 'week' : 'day');
    if (granularity === 'day' && days > 400) granularity = 'week';
    const departmentId = q.departmentId ? Number(q.departmentId) : null;
    if (departmentId && !inScope(scope, departmentId)) throw new ForbiddenException('Khoa/phòng ngoài phạm vi báo cáo của bạn');
    const projectId = q.projectId ? Number(q.projectId) : null;
    const assigneeId = q.assigneeId ? Number(q.assigneeId) : null;

    const base: SQL[] = [sql`t.deleted_at is null`, sql`t.status <> 'DRAFT'`];
    if (scope !== null) base.push(sql`t.department_id in (${sql.join(scope.map((id) => sql`${id}`), sql`, `)})`);
    if (departmentId) base.push(sql`t.department_id = ${departmentId}`);
    if (projectId) base.push(sql`t.project_id = ${projectId}`);
    if (assigneeId) base.push(sql`t.assignee_id = ${assigneeId}`);
    const cohort = sql`(coalesce(t.assigned_at, t.created_at) at time zone ${TZ})::date between ${from}::date and ${to}::date`;
    return {
      scopeWhere: sql.join(base, sql` and `),
      where: sql.join([...base, cohort], sql` and `),
      from,
      to,
      granularity,
      departmentId,
      projectId,
      assigneeId,
    };
  }

  private aggColumns() {
    return sql`
      count(*)::int as "assigned",
      count(*) filter (where t.status = 'CANCELLED')::int as "cancelled",
      count(*) filter (where t.status = 'DONE')::int as "done",
      count(*) filter (where t.status = 'DONE' and t.due_at is not null and t.completed_at <= t.due_at)::int as "onTime",
      count(*) filter (where t.status = 'DONE' and t.due_at is not null and t.completed_at > t.due_at)::int as "late",
      count(*) filter (where t.status = 'DONE' and t.due_at is not null)::int as "doneWithDue",
      count(*) filter (where t.status not in ('DONE', 'CANCELLED'))::int as "open",
      count(*) filter (where t.status not in ('DONE', 'CANCELLED') and t.due_at < now())::int as "overdue",
      count(*) filter (where t.status = 'SUBMITTED')::int as "submitted",
      count(*) filter (where t.submission_count > 0)::int as "everSubmitted",
      count(*) filter (where t.return_count > 0)::int as "returned",
      coalesce(sum(t.return_count), 0)::int as "returnTimes",
      round(((avg(extract(epoch from (t.completed_at - coalesce(t.assigned_at, t.created_at))) / 3600) filter (where t.status = 'DONE')))::numeric, 1) as "avgHours",
      coalesce(sum(coalesce(wl.h, 0)), 0)::float8 as "hours",
      count(*) filter (where t.status = 'ASSIGNED')::int as "waiting",
      count(*) filter (where t.status in ('ACCEPTED', 'IN_PROGRESS', 'RETURNED'))::int as "inProgress",
      count(*) filter (where t.status = 'ON_HOLD')::int as "onHold",
      count(*) filter (where t.status = 'DECLINED')::int as "declined"`;
  }

  private worklogJoin() {
    return sql`left join (select task_id, sum(hours) as h from task_worklogs where deleted_at is null group by task_id) wl on wl.task_id = t.id`;
  }

  private toPerf(r: Record<string, unknown>, key: number | null, name: string, extra = ''): PerfRow {
    const assigned = num(r['assigned']);
    const cancelled = num(r['cancelled']);
    const done = num(r['done']);
    const onTime = num(r['onTime']);
    const doneWithDue = num(r['doneWithDue']);
    const everSubmitted = num(r['everSubmitted']);
    const returned = num(r['returned']);
    const completionRate = rate(done, assigned - cancelled);
    const onTimeRate = rate(onTime, doneWithDue);
    const returnRate = rate(returned, everSubmitted);
    return {
      key,
      name,
      extra,
      assigned,
      cancelled,
      done,
      onTime,
      late: num(r['late']),
      doneWithDue,
      open: num(r['open']),
      overdue: num(r['overdue']),
      submitted: num(r['submitted']),
      everSubmitted,
      returned,
      returnTimes: num(r['returnTimes']),
      avgHours: r['avgHours'] === null || r['avgHours'] === undefined ? null : Number(r['avgHours']),
      hours: Math.round(num(r['hours']) * 100) / 100,
      completionRate,
      onTimeRate,
      returnRate,
      score: performanceScore({ onTimeRate, completionRate, returnRate }),
    };
  }

  async overview(user: AccessContext, q: TaskReportQueryDto) {
    const f = this.filters(user, q);
    const [kpiRes, statusRes, priorityRes, deptRes, assignedSeries, doneSeries] = await Promise.all([
      this.db.db.execute(sql`select ${this.aggColumns()} from tasks t ${this.worklogJoin()} where ${f.where}`),
      this.db.db.execute(sql`select t.status, count(*)::int as n from tasks t where ${f.where} group by t.status`),
      this.db.db.execute(sql`select t.priority, count(*)::int as n,
        count(*) filter (where t.status not in ('DONE','CANCELLED') and t.due_at < now())::int as overdue from tasks t where ${f.where} group by t.priority`),
      this.db.db.execute(sql`select t.department_id as id, coalesce(d.name, '(Chưa gán khoa)') as name, ${this.aggColumns()}
        from tasks t ${this.worklogJoin()} left join departments d on d.id = t.department_id where ${f.where}
        group by t.department_id, d.name order by count(*) desc limit 30`),
      this.db.db.execute(sql`select to_char(date_trunc(${f.granularity}::text, (coalesce(t.assigned_at, t.created_at) at time zone ${TZ})), 'YYYY-MM-DD') as bucket,
        count(*)::int as n from tasks t where ${f.where} group by 1`),
      this.db.db.execute(sql`select to_char(date_trunc(${f.granularity}::text, (t.completed_at at time zone ${TZ})), 'YYYY-MM-DD') as bucket,
        count(*)::int as done, count(*) filter (where t.due_at is not null and t.completed_at <= t.due_at)::int as "onTime",
        count(*) filter (where t.due_at is not null and t.completed_at > t.due_at)::int as "late"
        from tasks t where ${f.scopeWhere} and t.status = 'DONE'
          and (t.completed_at at time zone ${TZ})::date between ${f.from}::date and ${f.to}::date group by 1`),
    ]);
    const kpiRow = rowsOf<Record<string, unknown>>(kpiRes)[0] ?? {};
    const kpi = this.toPerf(kpiRow, null, 'Tổng');
    const assignedMap = new Map(rowsOf<{ bucket: string; n: number }>(assignedSeries).map((r) => [r.bucket, num(r.n)]));
    const doneMap = new Map(rowsOf<{ bucket: string; done: number; onTime: number; late: number }>(doneSeries).map((r) => [r.bucket, r]));
    const series = buildBuckets(f.from, f.to, f.granularity).map((b) => {
      const d = doneMap.get(b);
      return { bucket: b, label: bucketLabel(b, f.granularity), assigned: assignedMap.get(b) ?? 0, done: num(d?.done), onTime: num(d?.onTime), late: num(d?.late) };
    });
    return {
      period: { from: f.from, to: f.to, granularity: f.granularity },
      kpi: {
        ...kpi,
        waiting: num(kpiRow['waiting']),
        inProgress: num(kpiRow['inProgress']),
        onHold: num(kpiRow['onHold']),
        declined: num(kpiRow['declined']),
      },
      byStatus: rowsOf<{ status: TaskStatus; n: number }>(statusRes).map((r) => ({ status: r.status, label: TASK_STATUS_LABEL[r.status] ?? r.status, count: num(r.n) })),
      byPriority: rowsOf<{ priority: TaskPriority; n: number; overdue: number }>(priorityRes).map((r) => ({
        priority: r.priority,
        label: TASK_PRIORITY_LABEL[r.priority] ?? r.priority,
        count: num(r.n),
        overdue: num(r.overdue),
      })),
      byDepartment: rowsOf<Record<string, unknown>>(deptRes).map((r) => this.toPerf(r, r['id'] === null ? null : num(r['id']), String(r['name'] ?? ''))),
      series,
    };
  }

  async performance(user: AccessContext, q: TaskReportQueryDto) {
    const f = this.filters(user, q);
    const [peopleRes, deptRes, projectRes] = await Promise.all([
      this.db.db.execute(sql`select t.assignee_id as id, u.full_name as name, u.title as title, coalesce(d.name, '') as dept, ${this.aggColumns()}
        from tasks t ${this.worklogJoin()} join users u on u.id = t.assignee_id left join departments d on d.id = u.department_id
        where ${f.where} group by t.assignee_id, u.full_name, u.title, d.name order by u.full_name`),
      this.db.db.execute(sql`select t.department_id as id, coalesce(d.name, '(Chưa gán khoa)') as name, ${this.aggColumns()}
        from tasks t ${this.worklogJoin()} left join departments d on d.id = t.department_id
        where ${f.where} group by t.department_id, d.name order by d.name nulls last`),
      this.db.db.execute(sql`select t.project_id as id, p.code as code, p.name as name, ${this.aggColumns()}
        from tasks t ${this.worklogJoin()} join task_projects p on p.id = t.project_id
        where ${f.where} group by t.project_id, p.code, p.name order by p.name`),
    ]);
    const people = rowsOf<Record<string, unknown>>(peopleRes)
      .map((r) => this.toPerf(r, num(r['id']), String(r['name'] ?? ''), [r['title'], r['dept']].filter(Boolean).join(' · ')))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.done - a.done);
    return {
      period: { from: f.from, to: f.to, granularity: f.granularity },
      people,
      departments: rowsOf<Record<string, unknown>>(deptRes).map((r) => this.toPerf(r, r['id'] === null ? null : num(r['id']), String(r['name'] ?? ''))),
      projects: rowsOf<Record<string, unknown>>(projectRes).map((r) => this.toPerf(r, num(r['id']), String(r['name'] ?? ''), String(r['code'] ?? ''))),
      formula: 'Điểm hiệu suất = 50% × tỷ lệ đúng hạn + 30% × tỷ lệ hoàn thành + 20% × (1 − tỷ lệ bị trả lại)',
    };
  }

  /**
   * KHỐI LƯỢNG CÔNG VIỆC HIỆN TẠI theo người thực hiện (không theo kỳ) — giúp người giao việc
   * phân bổ cân bằng. Ai có quyền giao việc / quản lý / báo cáo đều xem được trong phạm vi khoa.
   * Có chọn khoa (hoặc phạm vi giới hạn theo khoa) thì liệt kê cả người đang rảnh (0 việc).
   */
  async workload(user: AccessContext, q: { departmentId?: string; projectId?: string }) {
    const scopes = [deptScope(user, TASK_PERMS.assign), deptScope(user, TASK_PERMS.manage), deptScope(user, TASK_PERMS.report)];
    const scope = scopes.some((s) => s === null) ? null : [...new Set(scopes.flatMap((s) => s ?? []))];
    if (scope !== null && scope.length === 0) throw new ForbiddenException('Cần quyền giao việc, quản lý hoặc báo cáo công việc để xem khối lượng');
    const departmentId = q.departmentId && /^\d+$/.test(q.departmentId) ? Number(q.departmentId) : null;
    if (departmentId && !inScope(scope, departmentId)) throw new ForbiddenException('Khoa/phòng ngoài phạm vi của bạn');
    const projectId = q.projectId && /^\d+$/.test(q.projectId) ? Number(q.projectId) : null;

    const userWhere: SQL[] = [sql`u.deleted_at is null`, sql`u.active`];
    if (departmentId) userWhere.push(sql`u.department_id = ${departmentId}`);
    else if (scope !== null) userWhere.push(sql`u.department_id in (${sql.join(scope.map((id) => sql`${id}`), sql`, `)})`);
    const projTask = projectId ? sql` and project_id = ${projectId}` : sql``;
    // Người rảnh (0 việc) chỉ liệt kê khi danh sách người đã được giới hạn (theo khoa / thành viên dự án)
    const includeIdle = projectId
      ? sql`(agg.uid is not null or exists (select 1 from task_project_members pm where pm.project_id = ${projectId} and pm.user_id = u.id))`
      : departmentId || scope !== null ? sql`true` : sql`agg.uid is not null`;

    const res = await this.db.db.execute(sql`
      with agg as (
        select assignee_id as uid,
          count(*) filter (where status = 'ASSIGNED')::int as "waiting",
          count(*) filter (where status in ('ACCEPTED', 'IN_PROGRESS', 'RETURNED'))::int as "inProgress",
          count(*) filter (where status = 'ON_HOLD')::int as "onHold",
          count(*) filter (where status = 'SUBMITTED')::int as "submitted",
          count(*) filter (where status <> 'SUBMITTED' and due_at < now())::int as "overdue",
          count(*) filter (where status <> 'SUBMITTED' and due_at >= now() and due_at < now() + interval '7 days')::int as "dueWeek",
          count(*) filter (where status <> 'SUBMITTED' and priority in ('URGENT', 'HIGH'))::int as "urgent",
          coalesce(sum(estimate_hours * (100 - progress) / 100.0) filter (where status <> 'SUBMITTED'), 0)::float8 as "remainingHours",
          count(*) filter (where status <> 'SUBMITTED' and estimate_hours is null)::int as "noEstimate"
        from tasks
        where deleted_at is null and assignee_id is not null
          and status in ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'RETURNED', 'ON_HOLD', 'SUBMITTED')${projTask}
        group by assignee_id
      ),
      done as (
        select assignee_id as uid, count(*)::int as n,
          count(*) filter (where due_at is not null and completed_at <= due_at)::int as "onTime",
          count(*) filter (where due_at is not null)::int as "withDue"
        from tasks where deleted_at is null and status = 'DONE' and completed_at >= now() - interval '30 days'${projTask}
        group by assignee_id
      ),
      wl as (
        select user_id as uid, sum(hours)::float8 as h from task_worklogs
        where deleted_at is null and work_date >= ((now() at time zone ${TZ})::date - 6)
        group by user_id
      )
      select u.id, u.full_name as "name", u.title, coalesce(d.name, '') as "dept",
        coalesce(agg.waiting, 0) as "waiting", coalesce(agg."inProgress", 0) as "inProgress", coalesce(agg."onHold", 0) as "onHold",
        coalesce(agg.submitted, 0) as "submitted", coalesce(agg.overdue, 0) as "overdue", coalesce(agg."dueWeek", 0) as "dueWeek",
        coalesce(agg.urgent, 0) as "urgent", coalesce(agg."remainingHours", 0) as "remainingHours", coalesce(agg."noEstimate", 0) as "noEstimate",
        coalesce(done.n, 0) as "done30", coalesce(done."onTime", 0) as "onTime30", coalesce(done."withDue", 0) as "withDue30",
        coalesce(wl.h, 0) as "hours7"
      from users u
      left join departments d on d.id = u.department_id
      left join agg on agg.uid = u.id
      left join done on done.uid = u.id
      left join wl on wl.uid = u.id
      where ${sql.join(userWhere, sql` and `)} and ${includeIdle}
      order by (coalesce(agg.waiting, 0) + coalesce(agg."inProgress", 0) + coalesce(agg."onHold", 0)) desc, u.full_name
      limit 500`);

    const people = rowsOf<Record<string, unknown>>(res).map((r) => {
      const waiting = num(r['waiting']);
      const inProgress = num(r['inProgress']);
      const onHold = num(r['onHold']);
      return {
        userId: num(r['id']),
        name: String(r['name'] ?? ''),
        extra: [r['title'], r['dept']].filter(Boolean).join(' · '),
        waiting,
        inProgress,
        onHold,
        submitted: num(r['submitted']),
        active: waiting + inProgress + onHold,
        overdue: num(r['overdue']),
        dueWeek: num(r['dueWeek']),
        urgent: num(r['urgent']),
        remainingHours: Math.round(num(r['remainingHours']) * 10) / 10,
        noEstimate: num(r['noEstimate']),
        done30: num(r['done30']),
        onTimeRate30: rate(num(r['onTime30']), num(r['withDue30'])),
        hours7: Math.round(num(r['hours7']) * 10) / 10,
        level: 'normal' as 'idle' | 'low' | 'normal' | 'high',
      };
    });
    const busy = people.filter((p) => p.active > 0);
    const avg = busy.length ? people.reduce((a, p) => a + p.active, 0) / Math.max(1, people.length) : 0;
    for (const p of people) {
      if (p.active === 0) p.level = 'idle';
      else if (p.active >= Math.max(avg * 1.5, avg + 3)) p.level = 'high';
      else if (p.active <= avg * 0.5) p.level = 'low';
    }
    return {
      people,
      totals: {
        people: people.length,
        active: people.reduce((a, p) => a + p.active, 0),
        overdue: people.reduce((a, p) => a + p.overdue, 0),
        submitted: people.reduce((a, p) => a + p.submitted, 0),
        idle: people.filter((p) => p.level === 'idle').length,
        high: people.filter((p) => p.level === 'high').length,
        avgActive: Math.round(avg * 10) / 10,
      },
      note: 'Việc đang xử lý = chờ nhận + đang làm (kể cả bị trả lại) + tạm hoãn; việc đã gửi duyệt hiển thị riêng. “Quá tải” khi số việc đang xử lý ≥ max(1,5 × trung bình, trung bình + 3).',
    };
  }

  /** Danh sách chi tiết công việc trong kỳ (phục vụ xuất tệp). */
  async details(user: AccessContext, q: TaskReportQueryDto, limit = 20000) {
    const f = this.filters(user, q);
    const res = await this.db.db.execute(sql`
      select t.id, t.code, t.title, t.status, t.priority, coalesce(d.name, '') as dept, coalesce(p.name, '') as project,
        coalesce(ua.full_name, '') as assignee, coalesce(ug.full_name, '') as assigner, coalesce(ur.full_name, '') as reviewer,
        coalesce(t.assigned_at, t.created_at) as assigned_at, t.due_at, t.completed_at, t.progress, t.return_count,
        array_to_string(t.labels, ', ') as labels, coalesce(wl.h, 0)::float8 as hours, t.status_reason,
        (t.status not in ('DONE','CANCELLED') and t.due_at < now()) as overdue,
        (t.status = 'DONE' and t.due_at is not null and t.completed_at <= t.due_at) as on_time,
        (t.status = 'DONE' and t.due_at is not null and t.completed_at > t.due_at) as late
      from tasks t ${this.worklogJoin()}
      left join departments d on d.id = t.department_id
      left join task_projects p on p.id = t.project_id
      left join users ua on ua.id = t.assignee_id
      left join users ug on ug.id = t.assigner_id
      left join users ur on ur.id = t.reviewer_id
      where ${f.where}
      order by coalesce(t.assigned_at, t.created_at) desc
      limit ${limit}`);
    return rowsOf<Record<string, unknown>>(res).map(
      (r): DetailRow => ({
        ...r,
        statusLabel: TASK_STATUS_LABEL[r['status'] as TaskStatus] ?? String(r['status']),
        priorityLabel: TASK_PRIORITY_LABEL[r['priority'] as TaskPriority] ?? String(r['priority']),
        evaluation: r['overdue'] ? 'Quá hạn' : r['on_time'] ? 'Đúng hạn' : r['late'] ? 'Trễ hạn' : '',
      }),
    );
  }

  /* ================================================================== Xuất tệp */

  async export(user: AccessContext, q: TaskReportQueryDto): Promise<{ buffer: Buffer; fileName: string; mime: string }> {
    const format = q.format ?? 'xlsx';
    const [overview, perf, details] = await Promise.all([this.overview(user, q), this.performance(user, q), this.details(user, q)]);
    const stamp = `${overview.period.from}_${overview.period.to}`;
    if (format === 'json') {
      return {
        buffer: Buffer.from(JSON.stringify({ exportedAt: new Date().toISOString(), overview, performance: perf, details }, null, 2), 'utf8'),
        fileName: `bao-cao-cong-viec_${stamp}.json`,
        mime: 'application/json; charset=utf-8',
      };
    }
    if (format === 'csv') {
      const head = ['Mã', 'Tiêu đề', 'Trạng thái', 'Ưu tiên', 'Khoa/phòng', 'Dự án', 'Người thực hiện', 'Người giao', 'Người duyệt', 'Ngày giao', 'Hạn chót',
        'Ngày hoàn thành', 'Đánh giá', 'Tiến độ (%)', 'Số lần trả lại', 'Giờ công', 'Nhãn', 'Lý do/ghi chú'];
      const cell = (v: unknown) => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [head.map(cell).join(',')];
      for (const r of details) {
        lines.push([r['code'], r['title'], r.statusLabel, r.priorityLabel, r['dept'], r['project'], r['assignee'], r['assigner'], r['reviewer'],
          fmtDateTime(r['assigned_at']), fmtDateTime(r['due_at']), fmtDateTime(r['completed_at']), r.evaluation, r['progress'], r['return_count'],
          r['hours'], r['labels'], r['status_reason']].map(cell).join(','));
      }
      return { buffer: Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8'), fileName: `cong-viec_${stamp}.csv`, mime: 'text/csv; charset=utf-8' };
    }
    if (format === 'docx') return this.exportDocx(overview, perf, stamp);
    return this.exportXlsx(overview, perf, details, stamp);
  }

  private async exportXlsx(
    overview: Awaited<ReturnType<TaskReportsService['overview']>>,
    perf: Awaited<ReturnType<TaskReportsService['performance']>>,
    details: Awaited<ReturnType<TaskReportsService['details']>>,
    stamp: string,
  ) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'QLBV';
    wb.created = new Date();
    const headerStyle = (row: ExcelJS.Row) => {
      row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      row.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
        c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      });
      row.height = 30;
    };
    const borderAll = (ws: ExcelJS.Worksheet, fromRow: number) => {
      ws.eachRow((row, n) => {
        if (n < fromRow) return;
        row.eachCell((c) => {
          c.border = { top: { style: 'thin', color: { argb: 'FFCBD5E1' } }, bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } }, left: { style: 'thin', color: { argb: 'FFCBD5E1' } }, right: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
        });
      });
    };
    const title = (ws: ExcelJS.Worksheet, text: string, span: number) => {
      ws.mergeCells(1, 1, 1, span);
      const c = ws.getCell(1, 1);
      c.value = text;
      c.font = { bold: true, size: 14, color: { argb: 'FF0F766E' } };
      ws.mergeCells(2, 1, 2, span);
      ws.getCell(2, 1).value = `Kỳ báo cáo: ${overview.period.from.split('-').reverse().join('/')} – ${overview.period.to.split('-').reverse().join('/')} · Xuất lúc ${fmtDateTime(new Date())}`;
      ws.getCell(2, 1).font = { italic: true, color: { argb: 'FF64748B' } };
    };

    // Sheet tổng quan
    const s1 = wb.addWorksheet('Tổng quan');
    title(s1, 'BÁO CÁO TỔNG QUAN CÔNG VIỆC', 4);
    const k = overview.kpi;
    const kpis: Array<[string, string | number]> = [
      ['Tổng số việc được giao', k.assigned], ['Hoàn thành', k.done], ['Đúng hạn', k.onTime], ['Trễ hạn', k.late], ['Đang mở', k.open],
      ['Chờ nhận', k.waiting], ['Đang làm/làm lại', k.inProgress], ['Chờ duyệt', k.submitted], ['Tạm hoãn', k.onHold], ['Từ chối', k.declined],
      ['Quá hạn (đang mở)', k.overdue], ['Đã hủy', k.cancelled], ['Số việc bị trả lại', k.returned], ['Tỷ lệ hoàn thành', pct(k.completionRate)],
      ['Tỷ lệ đúng hạn', pct(k.onTimeRate)], ['Tỷ lệ bị trả lại', pct(k.returnRate)], ['Thời gian hoàn thành TB (giờ)', k.avgHours ?? '—'],
      ['Tổng giờ công ghi nhận', k.hours], ['Điểm hiệu suất chung', k.score ?? '—'],
    ];
    s1.addRow([]);
    s1.getRow(3).values = ['Chỉ tiêu', 'Giá trị'];
    headerStyle(s1.getRow(3));
    for (const [label, value] of kpis) s1.addRow([label, value]);
    s1.addRow([]);
    const st = s1.addRow(['Trạng thái', 'Số việc', '', 'Ưu tiên', 'Số việc', 'Quá hạn']);
    headerStyle(st);
    const maxLen = Math.max(overview.byStatus.length, overview.byPriority.length);
    for (let i = 0; i < maxLen; i++) {
      const s = overview.byStatus[i];
      const p = overview.byPriority[i];
      s1.addRow([s?.label ?? '', s?.count ?? '', '', p?.label ?? '', p?.count ?? '', p?.overdue ?? '']);
    }
    s1.columns = [{ width: 34 }, { width: 16 }, { width: 4 }, { width: 18 }, { width: 12 }, { width: 12 }];
    borderAll(s1, 4);

    const perfHead = ['STT', 'Tên', 'Thông tin', 'Được giao', 'Hoàn thành', 'Đúng hạn', 'Trễ hạn', 'Đang mở', 'Quá hạn', 'Chờ duyệt', 'Bị trả lại (việc)',
      'Số lần trả lại', 'Đã hủy', 'TB giờ hoàn thành', 'Giờ công', 'Tỷ lệ hoàn thành', 'Tỷ lệ đúng hạn', 'Tỷ lệ trả lại', 'Điểm hiệu suất'];
    const perfSheet = (name: string, heading: string, rows: PerfRow[]) => {
      const ws = wb.addWorksheet(name);
      title(ws, heading, perfHead.length);
      ws.addRow([]);
      ws.getRow(3).values = perfHead;
      headerStyle(ws.getRow(3));
      rows.forEach((r, i) => {
        const row = ws.addRow([i + 1, r.name, r.extra, r.assigned, r.done, r.onTime, r.late, r.open, r.overdue, r.submitted, r.returned, r.returnTimes, r.cancelled,
          r.avgHours ?? '', r.hours, r.completionRate ?? '', r.onTimeRate ?? '', r.returnRate ?? '', r.score ?? '']);
        for (const c of [16, 17, 18]) row.getCell(c).numFmt = '0.0%';
      });
      ws.columns = perfHead.map((h, i) => ({ width: i === 1 ? 28 : i === 2 ? 30 : Math.max(10, Math.min(16, h.length + 2)) }));
      ws.views = [{ state: 'frozen', ySplit: 3, xSplit: 2 }];
      ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: perfHead.length } };
      borderAll(ws, 4);
    };
    perfSheet('Theo nhân viên', 'HIỆU SUẤT THEO NHÂN VIÊN', perf.people);
    perfSheet('Theo khoa phòng', 'HIỆU SUẤT THEO KHOA/PHÒNG', perf.departments);
    perfSheet('Theo dự án', 'TIẾN ĐỘ THEO DỰ ÁN', perf.projects);

    const s5 = wb.addWorksheet('Theo thời gian');
    title(s5, `XU HƯỚNG THEO ${overview.period.granularity === 'day' ? 'NGÀY' : overview.period.granularity === 'week' ? 'TUẦN' : 'THÁNG'}`, 5);
    s5.addRow([]);
    s5.getRow(3).values = ['Kỳ', 'Giao mới', 'Hoàn thành', 'Đúng hạn', 'Trễ hạn'];
    headerStyle(s5.getRow(3));
    for (const r of overview.series) s5.addRow([r.label, r.assigned, r.done, r.onTime, r.late]);
    s5.columns = [{ width: 16 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }];
    borderAll(s5, 4);

    const s6 = wb.addWorksheet('Chi tiết công việc');
    const detailHead = ['Mã', 'Tiêu đề', 'Trạng thái', 'Ưu tiên', 'Khoa/phòng', 'Dự án', 'Người thực hiện', 'Người giao', 'Người duyệt', 'Ngày giao', 'Hạn chót',
      'Ngày hoàn thành', 'Đánh giá', 'Tiến độ (%)', 'Số lần trả lại', 'Giờ công', 'Nhãn', 'Lý do/ghi chú'];
    title(s6, 'DANH SÁCH CHI TIẾT CÔNG VIỆC', detailHead.length);
    s6.addRow([]);
    s6.getRow(3).values = detailHead;
    headerStyle(s6.getRow(3));
    for (const r of details) {
      const row = s6.addRow([r['code'], r['title'], r.statusLabel, r.priorityLabel, r['dept'], r['project'], r['assignee'], r['assigner'], r['reviewer'],
        fmtDateTime(r['assigned_at']), fmtDateTime(r['due_at']), fmtDateTime(r['completed_at']), r.evaluation, r['progress'], r['return_count'], r['hours'],
        r['labels'], r['status_reason']]);
      if (r.evaluation === 'Quá hạn' || r.evaluation === 'Trễ hạn') row.getCell(13).font = { color: { argb: 'FFDC2626' }, bold: true };
      if (r.evaluation === 'Đúng hạn') row.getCell(13).font = { color: { argb: 'FF059669' }, bold: true };
    }
    s6.columns = detailHead.map((h, i) => ({ width: i === 1 ? 44 : [4, 5, 6, 7, 8].includes(i) ? 22 : Math.max(11, h.length + 2) }));
    s6.views = [{ state: 'frozen', ySplit: 3 }];
    s6.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: detailHead.length } };
    borderAll(s6, 4);

    return {
      buffer: Buffer.from(await wb.xlsx.writeBuffer()),
      fileName: `bao-cao-cong-viec_${stamp}.xlsx`,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  private async exportDocx(
    overview: Awaited<ReturnType<TaskReportsService['overview']>>,
    perf: Awaited<ReturnType<TaskReportsService['performance']>>,
    stamp: string,
  ) {
    const border = { style: BorderStyle.SINGLE, size: 4, color: '94A3B8' };
    const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
    const cell = (text: string | number, opts: { bold?: boolean; fill?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) =>
      new TableCell({
        shading: opts.fill ? { fill: opts.fill } : undefined,
        children: [new Paragraph({ alignment: opts.align ?? AlignmentType.LEFT, children: [new TextRun({ text: String(text), bold: opts.bold, size: 18, color: opts.fill === '0F766E' ? 'FFFFFF' : undefined })] })],
      });
    const table = (head: string[], rows: Array<Array<string | number>>) =>
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders,
        rows: [
          new TableRow({ tableHeader: true, children: head.map((h) => cell(h, { bold: true, fill: '0F766E', align: AlignmentType.CENTER })) }),
          ...rows.map((r) => new TableRow({ children: r.map((v, i) => cell(v, { align: i < 2 ? AlignmentType.LEFT : AlignmentType.CENTER })) })),
        ],
      });
    const k = overview.kpi;
    const period = `${overview.period.from.split('-').reverse().join('/')} – ${overview.period.to.split('-').reverse().join('/')}`;
    const perfRows = (list: PerfRow[]) =>
      list.slice(0, 200).map((r, i) => [i + 1, r.name, r.assigned, r.done, r.onTime, r.late, r.overdue, r.returned, pct(r.completionRate), pct(r.onTimeRate), r.score ?? '—']);
    const perfHead = ['STT', 'Tên', 'Giao', 'Xong', 'Đúng hạn', 'Trễ', 'Quá hạn', 'Trả lại', 'Hoàn thành', 'Đúng hạn %', 'Điểm'];
    const doc = new Document({
      creator: 'QLBV',
      title: 'Báo cáo công việc',
      sections: [
        {
          properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
          children: [
            new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'BÁO CÁO TÌNH HÌNH THỰC HIỆN CÔNG VIỆC', bold: true, size: 32 })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Kỳ báo cáo: ${period}`, italics: true })] }),
            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('1. Chỉ tiêu tổng hợp')] }),
            table(['Chỉ tiêu', 'Giá trị', 'Chỉ tiêu', 'Giá trị'], [
              ['Được giao', k.assigned, 'Hoàn thành', k.done],
              ['Đúng hạn', k.onTime, 'Trễ hạn', k.late],
              ['Đang mở', k.open, 'Quá hạn', k.overdue],
              ['Chờ duyệt', k.submitted, 'Bị trả lại', k.returned],
              ['Tỷ lệ hoàn thành', pct(k.completionRate), 'Tỷ lệ đúng hạn', pct(k.onTimeRate)],
              ['TB giờ hoàn thành', k.avgHours ?? '—', 'Điểm hiệu suất', k.score ?? '—'],
            ]),
            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('2. Hiệu suất theo nhân viên')] }),
            table(perfHead, perfRows(perf.people)),
            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('3. Theo khoa/phòng')] }),
            table(perfHead, perfRows(perf.departments)),
            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('4. Theo dự án')] }),
            table(perfHead, perfRows(perf.projects)),
            new Paragraph({ children: [new TextRun({ text: perf.formula, italics: true, size: 18 })] }),
          ],
        },
      ],
    });
    return {
      buffer: Buffer.from(await Packer.toBuffer(doc)),
      fileName: `bao-cao-cong-viec_${stamp}.docx`,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
}
