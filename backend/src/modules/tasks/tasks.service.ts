/**
 * Phân hệ QUẢN LÝ CÔNG VIỆC — nghiệp vụ lõi.
 *
 * Mọi thay đổi đều: kiểm tra quyền theo vai trò trên từng công việc → ghi CSDL trong giao dịch
 * (khóa lạc quan theo trạng thái) → ghi nhật ký `task_logs` → thông báo web + Telegram → phát realtime.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';
import type { AccessContext, ClientMeta } from '../../common/types/access-context';
import { DbService } from '../../db/db.service';
import {
  auditLogs,
  departments,
  taskAttachments,
  taskChecklistItems,
  taskComments,
  taskDependencies,
  taskLogs,
  taskProjectMembers,
  taskProjects,
  taskTemplates,
  taskWatchers,
  taskWorklogs,
  tasks,
  users,
  type Task,
  type TaskPriority,
  type TaskRecurrence,
  type TaskStatus,
} from '../../db/schema';
import { TASK_PRIORITIES, TASK_STATUSES } from '../../db/schema/tasks';
import { NotificationCenterService } from '../notifications/notification-center.service';
import type { NotifyEventKind } from '../notify-channels/notify-channels.module';
import { RealtimeService } from '../realtime/realtime.service';
import { TASK_PERMS, deptScope, hasPerm, inScope, viewScope } from './task-access';
import { prepareTaskFiles, removeStoredFile, resolveTaskFile, writeTaskFile, type PreparedTaskFile } from './task-files';
import {
  FINAL_STATUSES,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  TRANSITIONS,
  allowedActions,
  canPerform,
  isTaskManager,
  nextOccurrence,
  type TaskAction,
  type TaskActorRoles,
} from './task-workflow';
import type {
  ChecklistItemDto,
  CreateTaskDto,
  TaskCommentDto,
  TaskFileDto,
  TaskTemplateDto,
  TaskWorklogDto,
  TransitionTaskDto,
  UpdateChecklistItemDto,
  UpdateTaskDto,
} from './tasks.dto';

type Tx = Parameters<Parameters<DbService['transaction']>[0]>[0];
type Executor = DbService['db'] | Tx;

const assigneeU = alias(users, 'task_assignee');
const assignerU = alias(users, 'task_assigner');
const reviewerU = alias(users, 'task_reviewer');

const TZ = 'Asia/Ho_Chi_Minh';

export interface TaskListQuery {
  view?: string;
  status?: string;
  priority?: string;
  departmentId?: string;
  projectId?: string;
  assigneeId?: string;
  assignerId?: string;
  parentId?: string;
  label?: string;
  q?: string;
  due?: string;
  from?: string;
  to?: string;
  includeSubtasks?: string;
  sort?: string;
  page?: string;
  pageSize?: string;
}

export interface TaskContext {
  task: Task;
  watcherIds: number[];
  projectOwnerId: number | null;
  projectMemberRole: string | null;
  roles: TaskActorRoles;
  canView: boolean;
}

const intOrNull = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const csv = (v?: string): string[] => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

export function normalizeLabels(labels?: string[] | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels ?? []) {
    const label = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push(label);
    if (out.length >= 20) break;
  }
  return out;
}

export function parseDueAt(value: string | null | undefined): Date | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const raw = String(value).trim();
  // Chỉ có ngày → hết ngày theo giờ Việt Nam (23:59)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T23:59:00+07:00`) : new Date(raw);
  if (Number.isNaN(date.getTime())) throw new BadRequestException('Hạn chót không hợp lệ');
  return date;
}

const fmtDue = (d: Date | null | undefined): string => {
  if (!d) return '';
  return new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
};

@Injectable()
export class TasksService {
  private readonly logger = new Logger('Tasks');

  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationCenterService,
    private readonly realtime: RealtimeService,
  ) {}

  /* ====================================================================== Truy cập */

  /** Điều kiện SQL: công việc người dùng được thấy. */
  private visibilityCondition(user: AccessContext): SQL | undefined {
    if (user.isSuperAdmin) return undefined;
    const uid = user.id;
    const participant = sql`(${tasks.assigneeId} = ${uid} or ${tasks.assignerId} = ${uid} or ${tasks.reviewerId} = ${uid} or ${tasks.createdBy} = ${uid}
      or exists (select 1 from task_watchers tw where tw.task_id = ${tasks.id} and tw.user_id = ${uid})
      or exists (select 1 from task_project_members tm where tm.project_id = ${tasks.projectId} and tm.user_id = ${uid})
      or exists (select 1 from task_projects tp where tp.id = ${tasks.projectId} and tp.owner_id = ${uid}))`;
    const scope = viewScope(user);
    const draftGuard = sql`(${tasks.status} <> 'DRAFT' or ${tasks.createdBy} = ${uid} or ${tasks.assignerId} = ${uid})`;
    if (scope === null) return draftGuard;
    if (scope.length === 0) return and(participant, draftGuard);
    return and(or(participant, inArray(tasks.departmentId, scope)), draftGuard);
  }

  async loadContext(user: AccessContext, id: number, executor: Executor = this.db.db): Promise<TaskContext> {
    const [task] = await executor.select().from(tasks).where(and(eq(tasks.id, id), isNull(tasks.deletedAt))).limit(1);
    if (!task) throw new NotFoundException('Không tìm thấy công việc');
    const watcherRows = await executor.select({ userId: taskWatchers.userId }).from(taskWatchers).where(eq(taskWatchers.taskId, id));
    const watcherIds = watcherRows.map((r) => r.userId);
    let projectOwnerId: number | null = null;
    let projectMemberRole: string | null = null;
    if (task.projectId) {
      const [project] = await executor.select({ ownerId: taskProjects.ownerId }).from(taskProjects).where(eq(taskProjects.id, task.projectId)).limit(1);
      projectOwnerId = project?.ownerId ?? null;
      const [member] = await executor
        .select({ role: taskProjectMembers.role })
        .from(taskProjectMembers)
        .where(and(eq(taskProjectMembers.projectId, task.projectId), eq(taskProjectMembers.userId, user.id)))
        .limit(1);
      projectMemberRole = member?.role ?? null;
    }
    const uid = user.id;
    const roles: TaskActorRoles = {
      isAssignee: task.assigneeId === uid,
      isAssigner: task.assignerId === uid || task.createdBy === uid,
      isReviewer: (task.reviewerId ?? task.assignerId) === uid,
      managesScope: user.isSuperAdmin || inScope(deptScope(user, TASK_PERMS.manage), task.departmentId),
      isProjectManager: projectOwnerId === uid || projectMemberRole === 'MANAGER',
    };
    const related =
      roles.isAssignee || roles.isAssigner || roles.isReviewer || watcherIds.includes(uid) || projectOwnerId === uid || projectMemberRole !== null;
    let canView = user.isSuperAdmin || related || inScope(viewScope(user), task.departmentId);
    if (task.status === 'DRAFT' && !(roles.isAssigner || roles.managesScope || user.isSuperAdmin)) canView = false;
    return { task, watcherIds, projectOwnerId, projectMemberRole, roles, canView };
  }

  private async requireView(user: AccessContext, id: number, executor?: Executor): Promise<TaskContext> {
    const ctx = await this.loadContext(user, id, executor);
    if (!ctx.canView) throw new ForbiddenException('Bạn không có quyền xem công việc này');
    return ctx;
  }

  private async requireManager(user: AccessContext, id: number, executor?: Executor): Promise<TaskContext> {
    const ctx = await this.requireView(user, id, executor);
    if (!isTaskManager(ctx.roles)) throw new ForbiddenException('Chỉ người giao việc, người duyệt hoặc quản lý mới thực hiện được thao tác này');
    return ctx;
  }

  /** Người được giao, hoặc người điều hành công việc. */
  private requireWorker(ctx: TaskContext): void {
    if (!ctx.roles.isAssignee && !isTaskManager(ctx.roles)) {
      throw new ForbiddenException('Chỉ người thực hiện hoặc người quản lý công việc mới thực hiện được thao tác này');
    }
  }

  private participants(ctx: TaskContext): number[] {
    const t = ctx.task;
    return [...new Set([t.assigneeId, t.assignerId, t.reviewerId, t.createdBy, ...ctx.watcherIds].filter((v): v is number => !!v))];
  }

  /* ====================================================================== Danh sách */

  async list(user: AccessContext, q: TaskListQuery) {
    const uid = user.id;
    const where: SQL[] = [isNull(tasks.deletedAt)];
    const visibility = this.visibilityCondition(user);
    if (visibility) where.push(visibility);

    switch (q.view) {
      case 'mine':
        where.push(eq(tasks.assigneeId, uid));
        break;
      case 'assigned':
        where.push(or(eq(tasks.assignerId, uid), eq(tasks.createdBy, uid)) as SQL);
        break;
      case 'review':
        where.push(sql`coalesce(${tasks.reviewerId}, ${tasks.assignerId}) = ${uid}`);
        break;
      case 'watching':
        where.push(sql`exists (select 1 from task_watchers tw2 where tw2.task_id = ${tasks.id} and tw2.user_id = ${uid})`);
        break;
      default:
        break;
    }
    const statuses = csv(q.status).filter((s): s is TaskStatus => (TASK_STATUSES as readonly string[]).includes(s));
    if (statuses.length) where.push(inArray(tasks.status, statuses));
    const priorities = csv(q.priority).filter((s): s is TaskPriority => (TASK_PRIORITIES as readonly string[]).includes(s));
    if (priorities.length) where.push(inArray(tasks.priority, priorities));
    const departmentId = intOrNull(q.departmentId);
    if (departmentId) where.push(eq(tasks.departmentId, departmentId));
    const projectId = intOrNull(q.projectId);
    if (projectId) where.push(eq(tasks.projectId, projectId));
    const assigneeId = intOrNull(q.assigneeId);
    if (assigneeId) where.push(eq(tasks.assigneeId, assigneeId));
    const assignerId = intOrNull(q.assignerId);
    if (assignerId) where.push(eq(tasks.assignerId, assignerId));
    const parentId = intOrNull(q.parentId);
    if (parentId) where.push(eq(tasks.parentId, parentId));
    else if (q.includeSubtasks === '0') where.push(isNull(tasks.parentId));
    if (q.label?.trim()) where.push(sql`${q.label.trim()} = any(${tasks.labels})`);
    if (q.q?.trim()) {
      const like = `%${q.q.trim()}%`;
      where.push(or(ilike(tasks.title, like), ilike(tasks.code, like), ilike(tasks.description, like)) as SQL);
    }
    const open = sql`${tasks.status} not in ('DONE', 'CANCELLED', 'DRAFT')`;
    switch (q.due) {
      case 'overdue':
        where.push(and(open, sql`${tasks.dueAt} < now()`) as SQL);
        break;
      case 'today':
        where.push(sql`(${tasks.dueAt} at time zone ${TZ})::date = (now() at time zone ${TZ})::date`);
        break;
      case 'week':
        where.push(and(open, sql`${tasks.dueAt} >= now() and ${tasks.dueAt} < now() + interval '7 days'`) as SQL);
        break;
      case 'none':
        where.push(isNull(tasks.dueAt));
        break;
      default:
        break;
    }
    if (q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) where.push(sql`(coalesce(${tasks.assignedAt}, ${tasks.createdAt}) at time zone ${TZ})::date >= ${q.from}::date`);
    if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) where.push(sql`(coalesce(${tasks.assignedAt}, ${tasks.createdAt}) at time zone ${TZ})::date <= ${q.to}::date`);

    const condition = and(...where);
    const page = Math.max(1, intOrNull(q.page) ?? 1);
    const pageSize = Math.min(500, Math.max(1, intOrNull(q.pageSize) ?? 50));
    const priorityRank = sql`case ${tasks.priority} when 'URGENT' then 0 when 'HIGH' then 1 when 'NORMAL' then 2 else 3 end`;
    const order =
      q.sort === 'due'
        ? [sql`${tasks.dueAt} asc nulls last`, priorityRank]
        : q.sort === 'priority'
          ? [priorityRank, sql`${tasks.dueAt} asc nulls last`]
          : q.sort === 'created'
            ? [desc(tasks.createdAt)]
            : [desc(tasks.updatedAt)];

    const [countRow] = await this.db.db.select({ total: sql<number>`count(*)::int` }).from(tasks).where(condition);
    const rows = await this.db.db
      .select(this.listColumns())
      .from(tasks)
      .leftJoin(assigneeU, eq(assigneeU.id, tasks.assigneeId))
      .leftJoin(assignerU, eq(assignerU.id, tasks.assignerId))
      .leftJoin(reviewerU, eq(reviewerU.id, tasks.reviewerId))
      .leftJoin(departments, eq(departments.id, tasks.departmentId))
      .leftJoin(taskProjects, eq(taskProjects.id, tasks.projectId))
      .where(condition)
      .orderBy(...order)
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const now = Date.now();
    return {
      items: rows.map((r) => this.decorateRow(r, now)),
      total: countRow?.total ?? 0,
      page,
      pageSize,
    };
  }

  private listColumns() {
    return {
      id: tasks.id,
      code: tasks.code,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      progress: tasks.progress,
      labels: tasks.labels,
      startDate: tasks.startDate,
      dueAt: tasks.dueAt,
      projectId: tasks.projectId,
      parentId: tasks.parentId,
      departmentId: tasks.departmentId,
      assigneeId: tasks.assigneeId,
      assignerId: tasks.assignerId,
      reviewerId: tasks.reviewerId,
      returnCount: tasks.returnCount,
      assignedAt: tasks.assignedAt,
      submittedAt: tasks.submittedAt,
      completedAt: tasks.completedAt,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      createdBy: tasks.createdBy,
      recurrence: tasks.recurrence,
      assigneeName: assigneeU.fullName,
      assignerName: assignerU.fullName,
      reviewerName: reviewerU.fullName,
      departmentName: departments.name,
      projectName: taskProjects.name,
      projectCode: taskProjects.code,
      projectColor: taskProjects.color,
      checklistTotal: sql<number>`(select count(*)::int from task_checklist_items c where c.task_id = ${tasks.id})`,
      checklistDone: sql<number>`(select count(*)::int from task_checklist_items c where c.task_id = ${tasks.id} and c.done)`,
      subtaskTotal: sql<number>`(select count(*)::int from tasks s where s.parent_id = ${tasks.id} and s.deleted_at is null and s.status <> 'CANCELLED')`,
      subtaskDone: sql<number>`(select count(*)::int from tasks s where s.parent_id = ${tasks.id} and s.deleted_at is null and s.status = 'DONE')`,
      commentCount: sql<number>`(select count(*)::int from task_comments m where m.task_id = ${tasks.id} and m.deleted_at is null)`,
      attachmentCount: sql<number>`(select count(*)::int from task_attachments a where a.task_id = ${tasks.id} and a.deleted_at is null)`,
    };
  }

  private decorateRow<T extends { status: TaskStatus; priority: TaskPriority; dueAt: Date | null; completedAt: Date | null }>(r: T, now: number) {
    const due = r.dueAt ? new Date(r.dueAt).getTime() : null;
    const overdue = due !== null && !FINAL_STATUSES.includes(r.status) && r.status !== 'DRAFT' && due < now;
    const late = r.status === 'DONE' && due !== null && r.completedAt !== null && new Date(r.completedAt).getTime() > due;
    return {
      ...r,
      statusLabel: TASK_STATUS_LABEL[r.status] ?? r.status,
      priorityLabel: TASK_PRIORITY_LABEL[r.priority] ?? r.priority,
      overdue,
      late,
    };
  }

  /** Bảng Kanban — tối đa 500 việc theo bộ lọc, nhóm theo trạng thái ở giao diện. */
  async board(user: AccessContext, q: TaskListQuery) {
    const result = await this.list(user, { ...q, page: '1', pageSize: '500', sort: q.sort ?? 'priority' });
    return { items: result.items, total: result.total, truncated: result.total > result.items.length };
  }

  /* ====================================================================== Chi tiết */

  async detail(user: AccessContext, id: number) {
    const ctx = await this.requireView(user, id);
    const [row] = await this.db.db
      .select({ ...this.listColumns(), description: tasks.description, resultContent: tasks.resultContent, statusReason: tasks.statusReason,
        estimateHours: tasks.estimateHours, submissionCount: tasks.submissionCount, acceptedAt: tasks.acceptedAt, startedAt: tasks.startedAt,
        cancelledAt: tasks.cancelledAt, approvedBy: tasks.approvedBy, templateId: tasks.templateId, recurrenceSourceId: tasks.recurrenceSourceId })
      .from(tasks)
      .leftJoin(assigneeU, eq(assigneeU.id, tasks.assigneeId))
      .leftJoin(assignerU, eq(assignerU.id, tasks.assignerId))
      .leftJoin(reviewerU, eq(reviewerU.id, tasks.reviewerId))
      .leftJoin(departments, eq(departments.id, tasks.departmentId))
      .leftJoin(taskProjects, eq(taskProjects.id, tasks.projectId))
      .where(eq(tasks.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Không tìm thấy công việc');

    const [checklist, subtasks, deps, dependents, watchers, attachments, parent] = await Promise.all([
      this.db.db.select().from(taskChecklistItems).where(eq(taskChecklistItems.taskId, id)).orderBy(asc(taskChecklistItems.sortOrder), asc(taskChecklistItems.id)),
      this.db.db
        .select({ id: tasks.id, code: tasks.code, title: tasks.title, status: tasks.status, priority: tasks.priority, dueAt: tasks.dueAt,
          completedAt: tasks.completedAt, progress: tasks.progress, assigneeId: tasks.assigneeId, assigneeName: assigneeU.fullName })
        .from(tasks)
        .leftJoin(assigneeU, eq(assigneeU.id, tasks.assigneeId))
        .where(and(eq(tasks.parentId, id), isNull(tasks.deletedAt)))
        .orderBy(asc(tasks.id)),
      this.db.db
        .select({ id: tasks.id, code: tasks.code, title: tasks.title, status: tasks.status })
        .from(taskDependencies)
        .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnId))
        .where(and(eq(taskDependencies.taskId, id), isNull(tasks.deletedAt))),
      this.db.db
        .select({ id: tasks.id, code: tasks.code, title: tasks.title, status: tasks.status })
        .from(taskDependencies)
        .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
        .where(and(eq(taskDependencies.dependsOnId, id), isNull(tasks.deletedAt))),
      this.db.db
        .select({ id: users.id, fullName: users.fullName, username: users.username })
        .from(taskWatchers)
        .innerJoin(users, eq(users.id, taskWatchers.userId))
        .where(eq(taskWatchers.taskId, id)),
      this.listAttachmentRows(id),
      ctx.task.parentId
        ? this.db.db.select({ id: tasks.id, code: tasks.code, title: tasks.title, status: tasks.status }).from(tasks).where(eq(tasks.id, ctx.task.parentId)).limit(1)
        : Promise.resolve([]),
    ]);
    const now = Date.now();
    const manager = isTaskManager(ctx.roles);
    const people = { assigneeId: ctx.task.assigneeId, assignerId: ctx.task.assignerId, reviewerId: ctx.task.reviewerId };
    const final = FINAL_STATUSES.includes(ctx.task.status);
    const participants = await this.participantDirectory(ctx);
    return {
      ...this.decorateRow(row, now),
      checklist,
      subtasks: subtasks.map((s) => this.decorateRow(s, now)),
      dependencies: deps.map((d) => ({ ...d, statusLabel: TASK_STATUS_LABEL[d.status] })),
      dependents: dependents.map((d) => ({ ...d, statusLabel: TASK_STATUS_LABEL[d.status] })),
      watchers,
      attachments: attachments.map((a) => ({ ...a, canDelete: !final && (manager || a.uploadedBy === user.id) })),
      parent: parent[0] ?? null,
      participants,
      viewer: {
        ...ctx.roles,
        isManager: manager,
        isWatching: ctx.watcherIds.includes(user.id),
        allowedActions: allowedActions(ctx.task.status, ctx.roles, people),
        canEdit: manager && !final,
        canUpdateProgress: (manager || ctx.roles.isAssignee) && !final,
        canWorklog: ctx.roles.isAssignee || manager,
        canChecklist: (ctx.roles.isAssignee || manager) && !final,
        canUpload: (ctx.roles.isAssignee || manager) && !final,
        canAddSubtask: (ctx.roles.isAssignee || manager) && !final,
        canComment: true,
        canDelete: manager && (ctx.task.status === 'DRAFT' || ctx.task.status === 'CANCELLED'),
      },
    };
  }

  /** Danh bạ người liên quan — dùng gợi ý @nhắc tên trong khung trao đổi. */
  private async participantDirectory(ctx: TaskContext) {
    const ids = new Set(this.participants(ctx));
    if (ctx.task.projectId) {
      const members = await this.db.db.select({ userId: taskProjectMembers.userId }).from(taskProjectMembers).where(eq(taskProjectMembers.projectId, ctx.task.projectId));
      for (const m of members) ids.add(m.userId);
      if (ctx.projectOwnerId) ids.add(ctx.projectOwnerId);
    }
    if (ids.size === 0) return [];
    return this.db.db
      .select({ id: users.id, fullName: users.fullName, username: users.username, title: users.title })
      .from(users)
      .where(and(inArray(users.id, [...ids]), isNull(users.deletedAt)))
      .orderBy(asc(users.fullName));
  }

  /* ====================================================================== Tạo mới */

  async create(user: AccessContext, dto: CreateTaskDto, client?: ClientMeta) {
    const title0 = dto.title?.trim();
    // Mẫu công việc: điền các trường còn trống
    let template: typeof taskTemplates.$inferSelect | null = null;
    if (dto.templateId) {
      const [tpl] = await this.db.db.select().from(taskTemplates).where(and(eq(taskTemplates.id, dto.templateId), eq(taskTemplates.active, true))).limit(1);
      if (!tpl) throw new BadRequestException('Mẫu công việc không tồn tại hoặc đã ngừng dùng');
      template = tpl;
    }
    const title = title0 || template?.title?.trim() || '';
    if (title.length < 2) throw new BadRequestException('Tiêu đề công việc tối thiểu 2 ký tự');

    const draft = dto.draft === true;
    const assigneeIds = [...new Set((dto.assigneeIds?.length ? dto.assigneeIds : dto.assigneeId ? [dto.assigneeId] : []).filter((v) => Number.isInteger(v) && v > 0))];
    if (!draft && assigneeIds.length === 0) throw new BadRequestException('Vui lòng chọn người thực hiện');

    // Dự án & việc cha
    let project: typeof taskProjects.$inferSelect | null = null;
    let projectManager = false;
    if (dto.projectId) {
      const [p] = await this.db.db.select().from(taskProjects).where(and(eq(taskProjects.id, dto.projectId), isNull(taskProjects.deletedAt))).limit(1);
      if (!p) throw new BadRequestException('Dự án không tồn tại');
      if (p.archived || p.status === 'CANCELLED' || p.status === 'COMPLETED') throw new BadRequestException('Dự án đã kết thúc/lưu trữ — không thêm việc mới');
      project = p;
      projectManager = await this.isProjectManager(user, p);
    }
    let parentCtx: TaskContext | null = null;
    if (dto.parentId) {
      parentCtx = await this.requireView(user, dto.parentId);
      if (FINAL_STATUSES.includes(parentCtx.task.status)) throw new BadRequestException('Việc cha đã kết thúc — không thêm việc con');
      if (parentCtx.task.parentId) {
        const [grand] = await this.db.db.select({ parentId: tasks.parentId }).from(tasks).where(eq(tasks.id, parentCtx.task.parentId)).limit(1);
        if (grand?.parentId) throw new BadRequestException('Chỉ hỗ trợ tối đa 3 cấp việc (việc → việc con → việc con cấp 2)');
      }
      if (!project && parentCtx.task.projectId) {
        const [p] = await this.db.db.select().from(taskProjects).where(eq(taskProjects.id, parentCtx.task.projectId)).limit(1);
        project = p ?? null;
        if (p) projectManager = await this.isProjectManager(user, p);
      }
    }
    const parentManager = parentCtx ? isTaskManager(parentCtx.roles) : false;
    const parentAssignee = parentCtx ? parentCtx.roles.isAssignee : false;

    // Người thực hiện: kiểm tra phạm vi giao việc
    const assignees = assigneeIds.length
      ? await this.db.db
          .select({ id: users.id, fullName: users.fullName, departmentId: users.departmentId, active: users.active })
          .from(users)
          .where(and(inArray(users.id, assigneeIds), isNull(users.deletedAt)))
      : [];
    if (assignees.length !== assigneeIds.length || assignees.some((a) => !a.active)) {
      throw new BadRequestException('Người thực hiện không tồn tại hoặc đã ngừng hoạt động');
    }
    const projectMemberIds = project ? await this.projectMemberIds(project.id) : new Set<number>();
    for (const a of assignees) {
      await this.assertCanAssign(user, a, { projectManager, projectMemberIds, parentManager, parentAssignee });
    }

    // Người duyệt
    const reviewerId = dto.reviewerId ?? null;
    if (reviewerId) {
      const [rv] = await this.db.db.select({ id: users.id, active: users.active }).from(users).where(and(eq(users.id, reviewerId), isNull(users.deletedAt))).limit(1);
      if (!rv?.active) throw new BadRequestException('Người duyệt không tồn tại hoặc đã ngừng hoạt động');
    }

    // Khoa của công việc
    let departmentId = dto.departmentId ?? project?.departmentId ?? parentCtx?.task.departmentId ?? null;
    if (dto.departmentId && !user.isSuperAdmin) {
      const assignScope = deptScope(user, TASK_PERMS.assign);
      const own = dto.departmentId === user.departmentId;
      if (!own && !inScope(assignScope, dto.departmentId) && !projectManager) {
        throw new ForbiddenException('Khoa/phòng của công việc nằm ngoài phạm vi giao việc của bạn');
      }
    }

    const startDate = dto.startDate ?? null;
    let dueAt = parseDueAt(dto.dueAt);
    if (!dueAt && template?.dueDays) dueAt = new Date(Date.now() + template.dueDays * 86400_000);
    if (startDate && dueAt && new Date(`${startDate}T00:00:00+07:00`).getTime() > dueAt.getTime()) {
      throw new BadRequestException('Hạn chót phải sau ngày bắt đầu');
    }
    const priority = dto.priority ?? template?.priority ?? 'NORMAL';
    const estimate = dto.estimateHours ?? (template?.estimateHours ? Number(template.estimateHours) : null);
    const labels = normalizeLabels(dto.labels?.length ? dto.labels : template?.labels);
    const checklist = (dto.checklist?.length ? dto.checklist : template?.checklist ?? []).map((c) => String(c).trim()).filter(Boolean).slice(0, 100);
    const description = dto.description ?? template?.description ?? '';
    const recurrence = this.normalizeRecurrence(dto.recurrence);
    const files = prepareTaskFiles(dto.files);

    // Phụ thuộc: chỉ được trỏ tới việc nhìn thấy
    const dependsOnIds = [...new Set(dto.dependsOnIds ?? [])];
    for (const depId of dependsOnIds) await this.requireView(user, depId);
    const watcherIds = [...new Set(dto.watcherIds ?? [])];
    if (watcherIds.length) {
      const found = await this.db.db.select({ id: users.id }).from(users).where(and(inArray(users.id, watcherIds), isNull(users.deletedAt)));
      if (found.length !== watcherIds.length) throw new BadRequestException('Người theo dõi không hợp lệ');
    }

    const targets: Array<{ id: number | null; fullName: string; departmentId: number | null }> = assignees.length
      ? assignees.map((a) => ({ id: a.id, fullName: a.fullName, departmentId: a.departmentId }))
      : [{ id: null, fullName: '', departmentId: null }];

    const created = await this.db.transaction(async (tx) => {
      const out: Task[] = [];
      for (const target of targets) {
        const selfTask = target.id === user.id;
        const status: TaskStatus = draft ? 'DRAFT' : selfTask ? 'ACCEPTED' : 'ASSIGNED';
        const now = new Date();
        const [row] = await tx
          .insert(tasks)
          .values({
            code: `TMP-${randomUUID()}`,
            title,
            description,
            projectId: project?.id ?? null,
            parentId: parentCtx?.task.id ?? null,
            departmentId: departmentId ?? target.departmentId ?? user.departmentId ?? null,
            assignerId: user.id,
            assigneeId: target.id,
            reviewerId: reviewerId ?? user.id,
            status,
            priority,
            startDate,
            dueAt,
            estimateHours: estimate === null || estimate === undefined ? null : String(estimate),
            labels,
            recurrence,
            templateId: template?.id ?? null,
            assignedAt: draft ? null : now,
            acceptedAt: !draft && selfTask ? now : null,
            createdBy: user.id,
          })
          .returning();
        const code = `CV-${now.getFullYear()}-${String(row!.id).padStart(5, '0')}`;
        const [saved] = await tx.update(tasks).set({ code }).where(eq(tasks.id, row!.id)).returning();
        if (checklist.length) {
          await tx.insert(taskChecklistItems).values(checklist.map((content, i) => ({ taskId: saved!.id, content, sortOrder: i })));
        }
        if (watcherIds.length) {
          await tx.insert(taskWatchers).values(watcherIds.map((userId) => ({ taskId: saved!.id, userId }))).onConflictDoNothing();
        }
        if (dependsOnIds.length) {
          await tx.insert(taskDependencies).values(dependsOnIds.map((dependsOnId) => ({ taskId: saved!.id, dependsOnId }))).onConflictDoNothing();
        }
        if (project && target.id && !projectMemberIds.has(target.id) && project.ownerId !== target.id) {
          await tx.insert(taskProjectMembers).values({ projectId: project.id, userId: target.id, role: 'MEMBER', addedBy: user.id }).onConflictDoNothing();
        }
        await this.writeLog(tx, saved!.id, user, draft ? 'CREATE_DRAFT' : 'CREATE', '', status,
          draft ? 'Tạo nháp công việc' : selfTask ? 'Tạo việc cá nhân' : `Giao việc cho ${target.fullName}`, null, client);
        out.push(saved!);
      }
      return out;
    });

    for (const task of created) {
      await this.storeFiles(task.id, files, user, 'REFERENCE', 0, null);
      if (task.status === 'ASSIGNED' && task.assigneeId && task.assigneeId !== user.id) {
        await this.notify([task.assigneeId], task, {
          title: 'Bạn được giao công việc mới',
          body: `${task.code} · ${task.title}${task.dueAt ? ` — Hạn: ${fmtDue(task.dueAt)}` : ''} · Người giao: ${user.fullName}`,
          level: task.priority === 'URGENT' ? 'WARNING' : 'INFO',
          kind: 'task.assigned',
        });
      }
      if (watcherIds.length) {
        await this.notify(watcherIds.filter((w) => w !== user.id), task, { title: 'Bạn được thêm theo dõi công việc', body: `${task.code} · ${task.title}`, level: 'INFO' });
      }
      this.publish(task, 'created');
    }
    const first = created[0]!;
    return { id: first.id, code: first.code, ids: created.map((t) => t.id), items: created.map((t) => ({ id: t.id, code: t.code, assigneeId: t.assigneeId })) };
  }

  private normalizeRecurrence(r?: { freq: 'DAILY' | 'WEEKLY' | 'MONTHLY'; interval: number; until?: string | null } | null): TaskRecurrence | null {
    if (!r) return null;
    if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(r.freq)) return null;
    return { freq: r.freq, interval: Math.max(1, Math.min(365, Math.floor(r.interval) || 1)), until: r.until || null };
  }

  private async isProjectManager(user: AccessContext, project: typeof taskProjects.$inferSelect): Promise<boolean> {
    if (user.isSuperAdmin || project.ownerId === user.id || project.createdBy === user.id) return true;
    if (inScope(deptScope(user, TASK_PERMS.manage), project.departmentId)) return true;
    const [member] = await this.db.db
      .select({ role: taskProjectMembers.role })
      .from(taskProjectMembers)
      .where(and(eq(taskProjectMembers.projectId, project.id), eq(taskProjectMembers.userId, user.id)))
      .limit(1);
    return member?.role === 'MANAGER';
  }

  private async projectMemberIds(projectId: number): Promise<Set<number>> {
    const rows = await this.db.db.select({ userId: taskProjectMembers.userId }).from(taskProjectMembers).where(eq(taskProjectMembers.projectId, projectId));
    return new Set(rows.map((r) => r.userId));
  }

  /**
   * Quy tắc giao việc:
   *  - Ai cũng tự giao việc cho chính mình (việc cá nhân).
   *  - Có quyền task.assign: giao cho nhân viên thuộc khoa trong phạm vi (ALL = toàn viện).
   *  - Quản lý dự án: giao cho thành viên dự án.
   *  - Người quản lý việc cha / người thực hiện việc cha: giao việc con cho chính mình hoặc trong phạm vi.
   */
  private async assertCanAssign(
    user: AccessContext,
    assignee: { id: number; fullName: string; departmentId: number | null },
    ctx: { projectManager: boolean; projectMemberIds: Set<number>; parentManager: boolean; parentAssignee: boolean },
  ): Promise<void> {
    if (assignee.id === user.id || user.isSuperAdmin) return;
    if (hasPerm(user, TASK_PERMS.assign) && inScope(deptScope(user, TASK_PERMS.assign), assignee.departmentId)) return;
    if (ctx.projectManager && ctx.projectMemberIds.has(assignee.id)) return;
    if (ctx.parentManager && ctx.projectMemberIds.has(assignee.id)) return;
    throw new ForbiddenException(`Bạn không có quyền giao việc cho ${assignee.fullName} (ngoài phạm vi khoa/phòng hoặc dự án được quản lý)`);
  }

  /* ====================================================================== Cập nhật */

  async update(user: AccessContext, id: number, dto: UpdateTaskDto, client?: ClientMeta) {
    const ctx = await this.requireView(user, id);
    const t = ctx.task;
    const manager = isTaskManager(ctx.roles);
    if (FINAL_STATUSES.includes(t.status)) throw new BadRequestException('Công việc đã kết thúc — hãy “Mở lại” trước khi sửa');
    const onlyProgress = Object.keys(dto).every((k) => k === 'progress' || (dto as Record<string, unknown>)[k] === undefined);
    if (!manager && !(ctx.roles.isAssignee && onlyProgress)) {
      throw new ForbiddenException('Chỉ người giao việc, người duyệt hoặc quản lý mới sửa được công việc');
    }

    const patch: Partial<typeof tasks.$inferInsert> = {};
    const changes: Record<string, [unknown, unknown]> = {};
    const setField = <K extends keyof typeof tasks.$inferInsert>(key: K, label: string, next: (typeof tasks.$inferInsert)[K], prev: unknown) => {
      const a = prev instanceof Date ? prev.toISOString() : prev ?? null;
      const b = next instanceof Date ? next.toISOString() : next ?? null;
      if (JSON.stringify(a) === JSON.stringify(b)) return;
      patch[key] = next;
      changes[label] = [a, b];
    };

    if (dto.title !== undefined) setField('title', 'Tiêu đề', dto.title.trim(), t.title);
    if (dto.description !== undefined) setField('description', 'Mô tả', dto.description, t.description);
    if (dto.priority !== undefined) setField('priority', 'Ưu tiên', dto.priority, t.priority);
    if (dto.startDate !== undefined) setField('startDate', 'Ngày bắt đầu', dto.startDate || null, t.startDate);
    if (dto.dueAt !== undefined) {
      const due = parseDueAt(dto.dueAt);
      setField('dueAt', 'Hạn chót', due, t.dueAt);
      if (changes['Hạn chót']) {
        patch.dueRemindedAt = null;
        patch.overdueNotifiedAt = null;
      }
    }
    if (dto.estimateHours !== undefined) setField('estimateHours', 'Giờ ước lượng', dto.estimateHours === null ? null : String(dto.estimateHours), t.estimateHours);
    if (dto.progress !== undefined) setField('progress', 'Tiến độ (%)', dto.progress, t.progress);
    if (dto.labels !== undefined) setField('labels', 'Nhãn', normalizeLabels(dto.labels), t.labels);
    if (dto.recurrence !== undefined) setField('recurrence', 'Lặp lại', this.normalizeRecurrence(dto.recurrence), t.recurrence);
    if (dto.projectId !== undefined && dto.projectId !== t.projectId) {
      if (dto.projectId) {
        const [p] = await this.db.db.select().from(taskProjects).where(and(eq(taskProjects.id, dto.projectId), isNull(taskProjects.deletedAt))).limit(1);
        if (!p) throw new BadRequestException('Dự án không tồn tại');
        if (!(await this.isProjectManager(user, p)) && !hasPerm(user, TASK_PERMS.assign)) throw new ForbiddenException('Bạn không quản lý dự án này');
      }
      setField('projectId', 'Dự án', dto.projectId ?? null, t.projectId);
    }
    const startCheck = (patch.startDate !== undefined ? patch.startDate : t.startDate) as string | null;
    const dueCheck = (patch.dueAt !== undefined ? patch.dueAt : t.dueAt) as Date | null;
    if (startCheck && dueCheck && new Date(`${startCheck}T00:00:00+07:00`).getTime() > new Date(dueCheck).getTime()) {
      throw new BadRequestException('Hạn chót phải sau ngày bắt đầu');
    }

    let reassignedFrom: number | null = null;
    if (dto.assigneeId !== undefined && dto.assigneeId !== t.assigneeId) {
      if (['SUBMITTED', 'DONE', 'CANCELLED'].includes(t.status)) {
        throw new BadRequestException('Không đổi người thực hiện khi công việc đang chờ duyệt hoặc đã kết thúc');
      }
      if (!dto.assigneeId) throw new BadRequestException('Vui lòng chọn người thực hiện');
      const [a] = await this.db.db
        .select({ id: users.id, fullName: users.fullName, departmentId: users.departmentId, active: users.active })
        .from(users)
        .where(and(eq(users.id, dto.assigneeId), isNull(users.deletedAt)))
        .limit(1);
      if (!a?.active) throw new BadRequestException('Người thực hiện không tồn tại hoặc đã ngừng hoạt động');
      const projectMemberIds = t.projectId ? await this.projectMemberIds(t.projectId) : new Set<number>();
      await this.assertCanAssign(user, a, { projectManager: ctx.roles.isProjectManager, projectMemberIds, parentManager: false, parentAssignee: false });
      reassignedFrom = t.assigneeId;
      setField('assigneeId', 'Người thực hiện', a.id, t.assigneeId);
      if (t.status !== 'DRAFT') {
        patch.status = a.id === user.id ? 'ACCEPTED' : 'ASSIGNED';
        patch.assignedAt = new Date();
        patch.acceptedAt = a.id === user.id ? new Date() : null;
        patch.statusReason = '';
      }
    }
    if (dto.reviewerId !== undefined && dto.reviewerId !== t.reviewerId) {
      if (dto.reviewerId) {
        const [rv] = await this.db.db.select({ id: users.id, active: users.active }).from(users).where(and(eq(users.id, dto.reviewerId), isNull(users.deletedAt))).limit(1);
        if (!rv?.active) throw new BadRequestException('Người duyệt không tồn tại hoặc đã ngừng hoạt động');
      }
      setField('reviewerId', 'Người duyệt', dto.reviewerId ?? null, t.reviewerId);
    }

    if (Object.keys(changes).length === 0) return this.detail(user, id);
    patch.updatedAt = new Date();
    const [saved] = await this.db.db.update(tasks).set(patch).where(and(eq(tasks.id, id), eq(tasks.status, t.status))).returning();
    if (!saved) throw new ConflictException('Công việc vừa được người khác cập nhật, vui lòng tải lại');
    await this.writeLog(this.db.db, id, user, reassignedFrom !== null || changes['Người thực hiện'] ? 'REASSIGN' : 'UPDATE', t.status, saved.status,
      `Cập nhật: ${Object.keys(changes).join(', ')}`, changes, client);

    if (changes['Người thực hiện'] && saved.assigneeId && saved.assigneeId !== user.id && saved.status !== 'DRAFT') {
      await this.notify([saved.assigneeId], saved, {
        title: 'Bạn được giao công việc',
        body: `${saved.code} · ${saved.title}${saved.dueAt ? ` — Hạn: ${fmtDue(saved.dueAt)}` : ''} · Người giao: ${user.fullName}`,
        level: 'INFO',
        kind: 'task.assigned',
      });
      if (reassignedFrom && reassignedFrom !== user.id) {
        await this.notify([reassignedFrom], saved, { title: 'Công việc đã chuyển cho người khác', body: `${saved.code} · ${saved.title}`, level: 'INFO' });
      }
    } else if (changes['Hạn chót'] || changes['Ưu tiên']) {
      const targets = [saved.assigneeId].filter((v): v is number => !!v && v !== user.id);
      await this.notify(targets, saved, {
        title: 'Công việc được điều chỉnh',
        body: `${saved.code} · ${Object.keys(changes).join(', ')}${saved.dueAt ? ` — Hạn mới: ${fmtDue(saved.dueAt)}` : ''}`,
        level: 'INFO',
      });
    }
    this.publish(saved, 'updated', ctx.watcherIds);
    return this.detail(user, id);
  }

  /** Xóa mềm — chỉ việc nháp hoặc đã hủy. */
  async remove(user: AccessContext, id: number, client?: ClientMeta) {
    const ctx = await this.requireManager(user, id);
    if (!['DRAFT', 'CANCELLED'].includes(ctx.task.status)) throw new BadRequestException('Chỉ xóa được công việc nháp hoặc đã hủy');
    await this.db.db.update(tasks).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(tasks.id, id));
    await this.writeLog(this.db.db, id, user, 'DELETE', ctx.task.status, ctx.task.status, 'Xóa công việc', null, client);
    this.publish(ctx.task, 'deleted', ctx.watcherIds);
    return { ok: true, id };
  }

  /* ====================================================================== Chuyển trạng thái */

  async transition(user: AccessContext, id: number, dto: TransitionTaskDto, client?: ClientMeta) {
    const action = dto.action as TaskAction;
    const rule = TRANSITIONS[action];
    if (!rule) throw new BadRequestException('Thao tác không hợp lệ');
    const ctx = await this.requireView(user, id);
    const t = ctx.task;
    const people = { assigneeId: t.assigneeId, assignerId: t.assignerId, reviewerId: t.reviewerId };
    if (!rule.from.includes(t.status)) {
      throw new BadRequestException(`Không thể “${rule.label}” khi công việc đang ở trạng thái “${TASK_STATUS_LABEL[t.status]}”`);
    }
    if (!canPerform(action, t.status, ctx.roles, people)) {
      if ((action === 'approve' || action === 'return') && ctx.roles.isAssignee) {
        throw new ForbiddenException('Người thực hiện không tự duyệt/trả lại kết quả của chính mình');
      }
      throw new ForbiddenException(`Bạn không có quyền “${rule.label}” công việc này`);
    }
    const reason = (dto.reason ?? '').trim();
    if (rule.reasonRequired && !reason) throw new BadRequestException(`Vui lòng nhập lý do “${rule.label}”`);

    if (action === 'start') {
      const blocking = await this.db.db
        .select({ code: tasks.code })
        .from(taskDependencies)
        .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnId))
        .where(and(eq(taskDependencies.taskId, id), isNull(tasks.deletedAt), ne(tasks.status, 'DONE'), ne(tasks.status, 'CANCELLED')));
      if (blocking.length) {
        throw new BadRequestException(`Chưa thể bắt đầu: còn việc tiên quyết chưa hoàn thành (${blocking.map((b) => b.code).join(', ')})`);
      }
    }
    if (action === 'submit' || action === 'approve') {
      const openSubs = await this.db.db
        .select({ code: tasks.code })
        .from(tasks)
        .where(and(eq(tasks.parentId, id), isNull(tasks.deletedAt), sql`${tasks.status} not in ('DONE', 'CANCELLED')`));
      if (openSubs.length) {
        throw new BadRequestException(`Còn ${openSubs.length} việc con chưa hoàn thành (${openSubs.slice(0, 5).map((s) => s.code).join(', ')}) — hoàn thành hoặc hủy trước`);
      }
    }
    let files: PreparedTaskFile[] = [];
    const resultContent = (dto.resultContent ?? '').trim();
    if (action === 'submit') {
      files = prepareTaskFiles(dto.files);
      if (!resultContent && files.length === 0) throw new BadRequestException('Nhập nội dung kết quả hoặc đính kèm tệp kết quả trước khi gửi duyệt');
    }

    const now = new Date();
    const patch: Partial<typeof tasks.$inferInsert> = { status: rule.to, updatedAt: now };
    switch (action) {
      case 'assign':
        patch.assignedAt = now;
        patch.statusReason = '';
        if (t.assigneeId === user.id) {
          patch.status = 'ACCEPTED';
          patch.acceptedAt = now;
        }
        break;
      case 'accept':
        patch.acceptedAt = now;
        patch.statusReason = '';
        break;
      case 'decline':
      case 'hold':
      case 'cancel':
        patch.statusReason = reason;
        if (action === 'cancel') patch.cancelledAt = now;
        break;
      case 'start':
        patch.startedAt = t.startedAt ?? now;
        patch.statusReason = '';
        break;
      case 'submit':
        patch.submittedAt = now;
        patch.submissionCount = t.submissionCount + 1;
        patch.resultContent = resultContent;
        patch.progress = 100;
        patch.statusReason = '';
        break;
      case 'approve':
        patch.completedAt = now;
        patch.approvedBy = user.id;
        patch.progress = 100;
        patch.statusReason = reason;
        break;
      case 'return':
        patch.returnCount = t.returnCount + 1;
        patch.statusReason = reason;
        patch.completedAt = null;
        break;
      case 'reopen':
        patch.completedAt = null;
        patch.cancelledAt = null;
        patch.approvedBy = null;
        patch.statusReason = reason;
        break;
    }

    const saved = await this.db.transaction(async (tx) => {
      const [row] = await tx.update(tasks).set(patch).where(and(eq(tasks.id, id), eq(tasks.status, t.status), isNull(tasks.deletedAt))).returning();
      if (!row) throw new ConflictException('Công việc vừa được người khác cập nhật, vui lòng tải lại');
      const note = [rule.label, reason ? `Lý do: ${reason}` : '', action === 'submit' && resultContent ? `Kết quả: ${resultContent.slice(0, 500)}` : '']
        .filter(Boolean)
        .join(' — ');
      await this.writeLog(tx, id, user, action.toUpperCase(), t.status, row.status, note, null, client);
      return row;
    });
    if (files.length) await this.storeFiles(id, files, user, 'RESULT', saved.submissionCount, null);
    if (action === 'approve' && saved.recurrence) await this.spawnRecurrence(user, saved, client);
    await this.notifyTransition(user, ctx, saved, action, reason);
    this.publish(saved, `status:${saved.status}`, ctx.watcherIds);
    return this.detail(user, id);
  }

  private async notifyTransition(user: AccessContext, ctx: TaskContext, task: Task, action: TaskAction, reason: string) {
    const by = user.fullName;
    const head = `${task.code} · ${task.title}`;
    const managers = [task.reviewerId ?? task.assignerId, task.assignerId].filter((v): v is number => !!v && v !== user.id);
    const assignee = [task.assigneeId].filter((v): v is number => !!v && v !== user.id);
    const watchers = ctx.watcherIds.filter((w) => w !== user.id);
    const reasonText = reason ? ` — Lý do: ${reason}` : '';
    switch (action) {
      case 'assign':
        await this.notify(assignee, task, { title: 'Bạn được giao công việc mới', body: `${head}${task.dueAt ? ` — Hạn: ${fmtDue(task.dueAt)}` : ''} · Người giao: ${by}`, level: 'INFO', kind: 'task.assigned' });
        break;
      case 'accept':
        await this.notify(managers, task, { title: 'Công việc đã được nhận', body: `${by} đã nhận việc: ${head}`, level: 'INFO', kind: 'task.statusChanged' });
        break;
      case 'decline':
        await this.notify(managers, task, { title: 'Công việc bị từ chối nhận', body: `${by} từ chối: ${head}${reasonText}`, level: 'WARNING', kind: 'task.statusChanged' });
        break;
      case 'start':
        await this.notify(managers, task, { title: 'Công việc bắt đầu thực hiện', body: `${by} đang làm: ${head}`, level: 'INFO' });
        break;
      case 'hold': {
        const targets = ctx.roles.isAssignee ? managers : assignee;
        await this.notify(targets, task, { title: 'Công việc tạm hoãn', body: `${head}${reasonText}`, level: 'WARNING', kind: 'task.statusChanged' });
        break;
      }
      case 'submit':
        await this.notify([task.reviewerId ?? task.assignerId].filter((v): v is number => !!v && v !== user.id), task, {
          title: 'Công việc chờ bạn duyệt',
          body: `${by} đã gửi kết quả: ${head}${task.submissionCount > 1 ? ` (lần ${task.submissionCount})` : ''}`,
          level: 'INFO',
          kind: 'task.submitted',
        });
        break;
      case 'approve':
        await this.notify(assignee, task, { title: 'Công việc đã được duyệt hoàn thành', body: `${head} · Người duyệt: ${by}`, level: 'SUCCESS', kind: 'task.approved' });
        break;
      case 'return':
        await this.notify(assignee, task, { title: 'Công việc bị trả lại — cần làm lại', body: `${head}${reasonText}`, level: 'WARNING', kind: 'task.returned' });
        break;
      case 'cancel':
        await this.notify([...new Set([...assignee, ...managers])], task, { title: 'Công việc đã bị hủy', body: `${head}${reasonText}`, level: 'WARNING', kind: 'task.cancelled' });
        break;
      case 'reopen':
        await this.notify(assignee, task, { title: 'Công việc được mở lại', body: `${head}${reasonText}`, level: 'WARNING', kind: 'task.returned' });
        break;
    }
    const primary = new Set([...managers, ...assignee]);
    const extra = watchers.filter((w) => !primary.has(w));
    if (extra.length) {
      await this.notify(extra, task, { title: `Công việc theo dõi: ${TRANSITIONS[action].label}`, body: `${head} — ${by} ${TRANSITIONS[action].verb}${reasonText}`, level: 'INFO' });
    }
  }

  /** Việc lặp lại: khi duyệt hoàn thành thì sinh lần kế tiếp. */
  private async spawnRecurrence(user: AccessContext, task: Task, client?: ClientMeta): Promise<Task | null> {
    const rec = task.recurrence;
    if (!rec) return null;
    const base = task.dueAt ?? new Date();
    const nextDue = nextOccurrence(new Date(base), rec.freq, rec.interval);
    if (rec.until && nextDue.getTime() > new Date(`${rec.until}T23:59:59+07:00`).getTime()) return null;
    const shiftMs = nextDue.getTime() - new Date(base).getTime();
    const nextStart = task.startDate ? new Date(new Date(`${task.startDate}T00:00:00Z`).getTime() + shiftMs).toISOString().slice(0, 10) : null;
    const checklist = await this.db.db.select({ content: taskChecklistItems.content, sortOrder: taskChecklistItems.sortOrder }).from(taskChecklistItems).where(eq(taskChecklistItems.taskId, task.id));
    const watchers = await this.db.db.select({ userId: taskWatchers.userId }).from(taskWatchers).where(eq(taskWatchers.taskId, task.id));
    const next = await this.db.transaction(async (tx) => {
      const now = new Date();
      const selfTask = task.assigneeId !== null && task.assigneeId === task.assignerId;
      const [row] = await tx
        .insert(tasks)
        .values({
          code: `TMP-${randomUUID()}`,
          title: task.title,
          description: task.description,
          projectId: task.projectId,
          parentId: null,
          departmentId: task.departmentId,
          assignerId: task.assignerId,
          assigneeId: task.assigneeId,
          reviewerId: task.reviewerId,
          status: selfTask ? 'ACCEPTED' : 'ASSIGNED',
          priority: task.priority,
          startDate: nextStart,
          dueAt: nextDue,
          estimateHours: task.estimateHours,
          labels: task.labels,
          recurrence: task.recurrence,
          recurrenceSourceId: task.recurrenceSourceId ?? task.id,
          templateId: task.templateId,
          assignedAt: now,
          acceptedAt: selfTask ? now : null,
          createdBy: task.createdBy,
        })
        .returning();
      const [saved] = await tx.update(tasks).set({ code: `CV-${now.getFullYear()}-${String(row!.id).padStart(5, '0')}` }).where(eq(tasks.id, row!.id)).returning();
      if (checklist.length) await tx.insert(taskChecklistItems).values(checklist.map((c) => ({ taskId: saved!.id, content: c.content, sortOrder: c.sortOrder })));
      if (watchers.length) await tx.insert(taskWatchers).values(watchers.map((w) => ({ taskId: saved!.id, userId: w.userId }))).onConflictDoNothing();
      await this.writeLog(tx, saved!.id, user, 'RECUR', '', saved!.status, `Tự sinh từ việc lặp lại ${task.code}`, null, client);
      return saved!;
    });
    if (next.assigneeId && next.status === 'ASSIGNED') {
      await this.notify([next.assigneeId], next, { title: 'Công việc định kỳ mới', body: `${next.code} · ${next.title} — Hạn: ${fmtDue(next.dueAt)}`, level: 'INFO', kind: 'task.assigned' });
    }
    this.publish(next, 'created');
    return next;
  }

  /* ====================================================================== Trao đổi (chat) */

  async listComments(user: AccessContext, id: number) {
    await this.requireView(user, id);
    const rows = await this.db.db
      .select()
      .from(taskComments)
      .where(and(eq(taskComments.taskId, id), isNull(taskComments.deletedAt)))
      .orderBy(asc(taskComments.createdAt), asc(taskComments.id));
    const files = await this.db.db
      .select({ id: taskAttachments.id, commentId: taskAttachments.commentId, fileName: taskAttachments.fileName, mimeType: taskAttachments.mimeType, sizeBytes: taskAttachments.sizeBytes })
      .from(taskAttachments)
      .where(and(eq(taskAttachments.taskId, id), eq(taskAttachments.kind, 'COMMENT'), isNull(taskAttachments.deletedAt)));
    const ctx = await this.loadContext(user, id);
    const manager = isTaskManager(ctx.roles);
    return rows.map((c) => ({
      ...c,
      mine: c.userId === user.id,
      canDelete: c.userId === user.id || manager,
      files: files.filter((f) => f.commentId === c.id),
    }));
  }

  async addComment(user: AccessContext, id: number, dto: TaskCommentDto, client?: ClientMeta) {
    const ctx = await this.requireView(user, id);
    const content = (dto.content ?? '').trim();
    const files = prepareTaskFiles(dto.files);
    if (!content && files.length === 0) throw new BadRequestException('Nhập nội dung tin nhắn hoặc đính kèm tệp');
    const directory = await this.participantDirectory(ctx);
    const mentionNames = new Set([...content.matchAll(/@([A-Za-z0-9_.-]{2,64})/g)].map((m) => m[1]!.toLowerCase()));
    const mentions = directory.filter((p) => mentionNames.has(p.username.toLowerCase()) && p.id !== user.id).map((p) => p.id);
    const [comment] = await this.db.db
      .insert(taskComments)
      .values({ taskId: id, userId: user.id, fullName: user.fullName, content, mentions })
      .returning();
    if (files.length) await this.storeFiles(id, files, user, 'COMMENT', 0, comment!.id);
    await this.writeLog(this.db.db, id, user, 'COMMENT', ctx.task.status, ctx.task.status, content.slice(0, 300) || `Gửi ${files.length} tệp`, null, client);
    const head = `${ctx.task.code} · ${ctx.task.title}`;
    if (mentions.length) {
      await this.notify(mentions, ctx.task, { title: `${user.fullName} nhắc đến bạn`, body: `${head}: ${content.slice(0, 200)}`, level: 'INFO', kind: 'task.mention' });
    }
    const others = this.participants(ctx).filter((u) => u !== user.id && !mentions.includes(u));
    if (others.length) {
      await this.notify(others, ctx.task, { title: 'Tin nhắn mới trong công việc', body: `${user.fullName} — ${head}: ${content.slice(0, 160) || 'đã gửi tệp'}`, level: 'INFO' });
    }
    this.publish(ctx.task, 'comment', ctx.watcherIds);
    return { ...comment!, mine: true, canDelete: true, files: [] };
  }

  async deleteComment(user: AccessContext, id: number, commentId: number, client?: ClientMeta) {
    const ctx = await this.requireView(user, id);
    const [comment] = await this.db.db.select().from(taskComments).where(and(eq(taskComments.id, commentId), eq(taskComments.taskId, id), isNull(taskComments.deletedAt))).limit(1);
    if (!comment) throw new NotFoundException('Không tìm thấy tin nhắn');
    if (comment.userId !== user.id && !isTaskManager(ctx.roles)) throw new ForbiddenException('Chỉ người viết hoặc người quản lý công việc mới xóa được tin nhắn');
    await this.db.db.update(taskComments).set({ deletedAt: new Date() }).where(eq(taskComments.id, commentId));
    await this.writeLog(this.db.db, id, user, 'COMMENT_DELETE', ctx.task.status, ctx.task.status, `Xóa tin nhắn của ${comment.fullName}`, null, client);
    this.publish(ctx.task, 'comment', ctx.watcherIds);
    return { ok: true };
  }

  /* ====================================================================== Tệp đính kèm */

  private listAttachmentRows(taskId: number) {
    return this.db.db
      .select({
        id: taskAttachments.id,
        kind: taskAttachments.kind,
        submissionNo: taskAttachments.submissionNo,
        commentId: taskAttachments.commentId,
        fileName: taskAttachments.fileName,
        mimeType: taskAttachments.mimeType,
        sizeBytes: taskAttachments.sizeBytes,
        uploadedBy: taskAttachments.uploadedBy,
        fullName: taskAttachments.fullName,
        createdAt: taskAttachments.createdAt,
      })
      .from(taskAttachments)
      .where(and(eq(taskAttachments.taskId, taskId), isNull(taskAttachments.deletedAt)))
      .orderBy(asc(taskAttachments.createdAt), asc(taskAttachments.id));
  }

  private async storeFiles(taskId: number, files: PreparedTaskFile[], user: AccessContext, kind: 'REFERENCE' | 'RESULT' | 'COMMENT', submissionNo: number, commentId: number | null) {
    const out: number[] = [];
    for (const file of files) {
      const storagePath = await writeTaskFile(taskId, file);
      const [row] = await this.db.db
        .insert(taskAttachments)
        .values({ taskId, commentId, kind, submissionNo, fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.buffer.length, storagePath, uploadedBy: user.id, fullName: user.fullName })
        .returning({ id: taskAttachments.id });
      out.push(row!.id);
    }
    return out;
  }

  async uploadAttachments(user: AccessContext, id: number, filesDto: TaskFileDto[], client?: ClientMeta) {
    const ctx = await this.requireView(user, id);
    this.requireWorker(ctx);
    if (FINAL_STATUSES.includes(ctx.task.status)) throw new BadRequestException('Công việc đã kết thúc — không đính kèm thêm');
    const files = prepareTaskFiles(filesDto);
    if (files.length === 0) throw new BadRequestException('Chọn ít nhất một tệp');
    await this.storeFiles(id, files, user, 'REFERENCE', 0, null);
    await this.writeLog(this.db.db, id, user, 'ATTACHMENT', ctx.task.status, ctx.task.status, `Đính kèm: ${files.map((f) => f.fileName).join(', ')}`, null, client);
    this.publish(ctx.task, 'attachment', ctx.watcherIds);
    return this.listAttachmentRows(id);
  }

  async readAttachment(user: AccessContext, id: number, attachmentId: number) {
    await this.requireView(user, id);
    const [row] = await this.db.db
      .select()
      .from(taskAttachments)
      .where(and(eq(taskAttachments.id, attachmentId), eq(taskAttachments.taskId, id), isNull(taskAttachments.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Không tìm thấy tệp đính kèm');
    return { row: { ...row, storagePath: undefined }, absPath: resolveTaskFile(row.storagePath) };
  }

  async deleteAttachment(user: AccessContext, id: number, attachmentId: number, client?: ClientMeta) {
    const ctx = await this.requireView(user, id);
    const [row] = await this.db.db
      .select()
      .from(taskAttachments)
      .where(and(eq(taskAttachments.id, attachmentId), eq(taskAttachments.taskId, id), isNull(taskAttachments.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Không tìm thấy tệp đính kèm');
    if (FINAL_STATUSES.includes(ctx.task.status)) throw new BadRequestException('Công việc đã kết thúc — tệp được giữ làm hồ sơ');
    const manager = isTaskManager(ctx.roles);
    if (!manager && row.uploadedBy !== user.id) throw new ForbiddenException('Chỉ người tải tệp hoặc người quản lý công việc mới xóa được');
    if (!manager && row.kind === 'RESULT' && ctx.task.status === 'SUBMITTED') throw new BadRequestException('Kết quả đang chờ duyệt — không xóa tệp kết quả');
    await this.db.db.update(taskAttachments).set({ deletedAt: new Date() }).where(eq(taskAttachments.id, attachmentId));
    await removeStoredFile(row.storagePath);
    await this.writeLog(this.db.db, id, user, 'ATTACHMENT_DELETE', ctx.task.status, ctx.task.status, `Xóa tệp "${row.fileName}"`, null, client);
    this.publish(ctx.task, 'attachment', ctx.watcherIds);
    return { ok: true };
  }

  /* ====================================================================== Nhật ký công việc (worklog) */

  async listWorklogs(user: AccessContext, id: number) {
    await this.requireView(user, id);
    const rows = await this.db.db
      .select()
      .from(taskWorklogs)
      .where(and(eq(taskWorklogs.taskId, id), isNull(taskWorklogs.deletedAt)))
      .orderBy(desc(taskWorklogs.workDate), desc(taskWorklogs.id));
    const total = rows.reduce((s, r) => s + Number(r.hours || 0), 0);
    return { items: rows.map((r) => ({ ...r, hours: Number(r.hours), mine: r.userId === user.id })), totalHours: Math.round(total * 100) / 100 };
  }

  async addWorklog(user: AccessContext, id: number, dto: TaskWorklogDto, client?: ClientMeta) {
    const ctx = await this.requireView(user, id);
    this.requireWorker(ctx);
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    if (dto.workDate > today) throw new BadRequestException('Không ghi nhật ký cho ngày trong tương lai');
    const [row] = await this.db.db
      .insert(taskWorklogs)
      .values({ taskId: id, userId: user.id, fullName: user.fullName, workDate: dto.workDate, hours: String(dto.hours), content: dto.content.trim(), progress: dto.progress ?? null })
      .returning();
    if (dto.progress !== undefined && !FINAL_STATUSES.includes(ctx.task.status) && ctx.task.status !== 'SUBMITTED') {
      await this.db.db.update(tasks).set({ progress: dto.progress, updatedAt: new Date() }).where(eq(tasks.id, id));
    }
    await this.writeLog(this.db.db, id, user, 'WORKLOG', ctx.task.status, ctx.task.status,
      `Nhật ký ${dto.workDate}: ${dto.hours} giờ${dto.progress !== undefined ? `, tiến độ ${dto.progress}%` : ''} — ${dto.content.slice(0, 200)}`, null, client);
    this.publish(ctx.task, 'worklog', ctx.watcherIds);
    return { ...row!, hours: Number(row!.hours) };
  }

  async deleteWorklog(user: AccessContext, id: number, worklogId: number, client?: ClientMeta) {
    const ctx = await this.requireView(user, id);
    const [row] = await this.db.db.select().from(taskWorklogs).where(and(eq(taskWorklogs.id, worklogId), eq(taskWorklogs.taskId, id), isNull(taskWorklogs.deletedAt))).limit(1);
    if (!row) throw new NotFoundException('Không tìm thấy nhật ký');
    if (row.userId !== user.id && !isTaskManager(ctx.roles)) throw new ForbiddenException('Chỉ người ghi hoặc người quản lý mới xóa được nhật ký');
    await this.db.db.update(taskWorklogs).set({ deletedAt: new Date() }).where(eq(taskWorklogs.id, worklogId));
    await this.writeLog(this.db.db, id, user, 'WORKLOG_DELETE', ctx.task.status, ctx.task.status, `Xóa nhật ký ngày ${row.workDate}`, null, client);
    return { ok: true };
  }

  /* ====================================================================== Checklist */

  private async requireChecklistEditor(user: AccessContext, id: number) {
    const ctx = await this.requireView(user, id);
    this.requireWorker(ctx);
    if (FINAL_STATUSES.includes(ctx.task.status)) throw new BadRequestException('Công việc đã kết thúc');
    return ctx;
  }

  async addChecklist(user: AccessContext, id: number, dto: ChecklistItemDto, client?: ClientMeta) {
    const ctx = await this.requireChecklistEditor(user, id);
    const [max] = await this.db.db.select({ m: sql<number>`coalesce(max(${taskChecklistItems.sortOrder}), -1)::int` }).from(taskChecklistItems).where(eq(taskChecklistItems.taskId, id));
    const [row] = await this.db.db.insert(taskChecklistItems).values({ taskId: id, content: dto.content.trim(), sortOrder: (max?.m ?? -1) + 1 }).returning();
    await this.writeLog(this.db.db, id, user, 'CHECKLIST_ADD', ctx.task.status, ctx.task.status, `Thêm mục kiểm: ${dto.content.trim()}`, null, client);
    this.publish(ctx.task, 'checklist', ctx.watcherIds);
    return row;
  }

  async updateChecklist(user: AccessContext, id: number, itemId: number, dto: UpdateChecklistItemDto, client?: ClientMeta) {
    const ctx = await this.requireChecklistEditor(user, id);
    const [item] = await this.db.db.select().from(taskChecklistItems).where(and(eq(taskChecklistItems.id, itemId), eq(taskChecklistItems.taskId, id))).limit(1);
    if (!item) throw new NotFoundException('Không tìm thấy mục kiểm');
    const patch: Partial<typeof taskChecklistItems.$inferInsert> = {};
    if (dto.content !== undefined) patch.content = dto.content.trim();
    if (dto.done !== undefined && dto.done !== item.done) {
      patch.done = dto.done;
      patch.doneBy = dto.done ? user.id : null;
      patch.doneAt = dto.done ? new Date() : null;
    }
    if (Object.keys(patch).length === 0) return item;
    const [row] = await this.db.db.update(taskChecklistItems).set(patch).where(eq(taskChecklistItems.id, itemId)).returning();
    await this.writeLog(this.db.db, id, user, 'CHECKLIST', ctx.task.status, ctx.task.status,
      dto.done !== undefined ? `${dto.done ? 'Hoàn thành' : 'Bỏ hoàn thành'} mục: ${row!.content}` : `Sửa mục kiểm: ${row!.content}`, null, client);
    this.publish(ctx.task, 'checklist', ctx.watcherIds);
    return row;
  }

  async deleteChecklist(user: AccessContext, id: number, itemId: number, client?: ClientMeta) {
    const ctx = await this.requireChecklistEditor(user, id);
    const [item] = await this.db.db.delete(taskChecklistItems).where(and(eq(taskChecklistItems.id, itemId), eq(taskChecklistItems.taskId, id))).returning();
    if (!item) throw new NotFoundException('Không tìm thấy mục kiểm');
    await this.writeLog(this.db.db, id, user, 'CHECKLIST_DELETE', ctx.task.status, ctx.task.status, `Xóa mục kiểm: ${item.content}`, null, client);
    this.publish(ctx.task, 'checklist', ctx.watcherIds);
    return { ok: true };
  }

  /* ====================================================================== Người theo dõi & phụ thuộc */

  async setWatchers(user: AccessContext, id: number, ids: number[], client?: ClientMeta) {
    const ctx = await this.requireManager(user, id);
    const next = [...new Set(ids.filter((v) => Number.isInteger(v) && v > 0))];
    if (next.length) {
      const found = await this.db.db.select({ id: users.id }).from(users).where(and(inArray(users.id, next), isNull(users.deletedAt)));
      if (found.length !== next.length) throw new BadRequestException('Người theo dõi không hợp lệ');
    }
    const added = next.filter((u) => !ctx.watcherIds.includes(u));
    await this.db.transaction(async (tx) => {
      await tx.delete(taskWatchers).where(eq(taskWatchers.taskId, id));
      if (next.length) await tx.insert(taskWatchers).values(next.map((userId) => ({ taskId: id, userId }))).onConflictDoNothing();
      await this.writeLog(tx, id, user, 'WATCHERS', ctx.task.status, ctx.task.status, `Cập nhật người theo dõi (${next.length} người)`, { 'Người theo dõi': [ctx.watcherIds, next] }, client);
    });
    if (added.length) await this.notify(added.filter((u) => u !== user.id), ctx.task, { title: 'Bạn được thêm theo dõi công việc', body: `${ctx.task.code} · ${ctx.task.title}`, level: 'INFO' });
    return { ok: true, watcherIds: next };
  }

  async follow(user: AccessContext, id: number, on: boolean) {
    const ctx = await this.requireView(user, id);
    if (on) await this.db.db.insert(taskWatchers).values({ taskId: id, userId: user.id }).onConflictDoNothing();
    else await this.db.db.delete(taskWatchers).where(and(eq(taskWatchers.taskId, id), eq(taskWatchers.userId, user.id)));
    await this.writeLog(this.db.db, id, user, on ? 'FOLLOW' : 'UNFOLLOW', ctx.task.status, ctx.task.status, on ? 'Theo dõi công việc' : 'Bỏ theo dõi công việc', null);
    return { ok: true, watching: on };
  }

  async setDependencies(user: AccessContext, id: number, ids: number[], client?: ClientMeta) {
    const ctx = await this.requireManager(user, id);
    const next = [...new Set(ids.filter((v) => Number.isInteger(v) && v > 0))];
    if (next.includes(id)) throw new BadRequestException('Công việc không thể phụ thuộc chính nó');
    for (const dep of next) await this.requireView(user, dep);
    // Chặn vòng lặp: đi theo chuỗi phụ thuộc của từng việc tiên quyết, không được quay về việc hiện tại
    const visited = new Set<number>();
    const queue = [...next];
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur === id) throw new BadRequestException('Phụ thuộc tạo thành vòng lặp — hãy kiểm tra lại chuỗi việc tiên quyết');
      if (visited.has(cur)) continue;
      visited.add(cur);
      const rows = await this.db.db.select({ d: taskDependencies.dependsOnId }).from(taskDependencies).where(eq(taskDependencies.taskId, cur));
      queue.push(...rows.map((r) => r.d));
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(taskDependencies).where(eq(taskDependencies.taskId, id));
      if (next.length) await tx.insert(taskDependencies).values(next.map((dependsOnId) => ({ taskId: id, dependsOnId })));
      await this.writeLog(tx, id, user, 'DEPENDENCIES', ctx.task.status, ctx.task.status, `Cập nhật việc tiên quyết (${next.length})`, null, client);
    });
    return { ok: true, dependsOnIds: next };
  }

  /* ====================================================================== Lịch sử & audit */

  async history(user: AccessContext, id: number) {
    await this.requireView(user, id);
    const logs = await this.db.db.select().from(taskLogs).where(eq(taskLogs.taskId, id)).orderBy(desc(taskLogs.createdAt), desc(taskLogs.id)).limit(500);
    const audits = await this.db.db
      .select({ id: auditLogs.id, action: auditLogs.action, description: auditLogs.description, fullName: auditLogs.fullName, username: auditLogs.username, ip: auditLogs.ip, createdAt: auditLogs.createdAt })
      .from(auditLogs)
      .where(and(eq(auditLogs.module, 'TASK'), eq(auditLogs.entityId, String(id))))
      .orderBy(desc(auditLogs.createdAt))
      .limit(300);
    return {
      logs: logs.map((l) => ({ ...l, fromLabel: TASK_STATUS_LABEL[l.fromStatus as TaskStatus] ?? l.fromStatus, toLabel: TASK_STATUS_LABEL[l.toStatus as TaskStatus] ?? l.toStatus })),
      audits,
    };
  }

  /* ====================================================================== Danh mục phục vụ giao diện */

  /** Người có thể giao việc: theo phạm vi task.assign; luôn gồm bản thân; kèm thành viên dự án được quản lý. */
  async assignableUsers(user: AccessContext, q: { q?: string; departmentId?: string; projectId?: string }) {
    const scope = deptScope(user, TASK_PERMS.assign);
    const where: SQL[] = [isNull(users.deletedAt), eq(users.active, true)];
    const allowed: SQL[] = [eq(users.id, user.id)];
    if (scope === null) allowed.push(sql`true`);
    else if (scope.length) allowed.push(inArray(users.departmentId, scope));
    const projectId = intOrNull(q.projectId);
    if (projectId) {
      const [p] = await this.db.db.select().from(taskProjects).where(eq(taskProjects.id, projectId)).limit(1);
      if (p && (await this.isProjectManager(user, p))) {
        allowed.push(sql`exists (select 1 from task_project_members pm where pm.project_id = ${projectId} and pm.user_id = ${users.id})`);
      }
    }
    where.push(or(...allowed) as SQL);
    const departmentId = intOrNull(q.departmentId);
    if (departmentId) where.push(eq(users.departmentId, departmentId));
    if (q.q?.trim()) {
      const like = `%${q.q.trim()}%`;
      where.push(or(ilike(users.fullName, like), ilike(users.username, like), ilike(users.title, like)) as SQL);
    }
    const rows = await this.db.db
      .select({ id: users.id, fullName: users.fullName, username: users.username, title: users.title, departmentId: users.departmentId,
        departmentName: departments.name, hasTelegram: sql<boolean>`coalesce(${users.telegramChatId}, '') <> ''`, hasPhone: sql<boolean>`coalesce(${users.phone}, '') <> ''` })
      .from(users)
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(and(...where))
      .orderBy(asc(departments.sortOrder), asc(users.fullName))
      .limit(300);
    return rows;
  }

  async meta(user: AccessContext) {
    const assignScope = deptScope(user, TASK_PERMS.assign);
    const vScope = viewScope(user);
    const union = assignScope === null || vScope === null ? null : [...new Set([...assignScope, ...vScope, ...(user.departmentId ? [user.departmentId] : [])])];
    const deptWhere: SQL[] = [eq(departments.active, true)];
    if (union !== null) deptWhere.push(union.length ? inArray(departments.id, union) : sql`false`);
    const [depts, projects, templates, labelRows] = await Promise.all([
      this.db.db.select({ id: departments.id, name: departments.name, code: departments.code }).from(departments).where(and(...deptWhere)).orderBy(asc(departments.sortOrder), asc(departments.name)),
      this.listVisibleProjects(user),
      this.db.db
        .select()
        .from(taskTemplates)
        .where(and(eq(taskTemplates.active, true), union === null ? undefined : or(isNull(taskTemplates.departmentId), union.length ? inArray(taskTemplates.departmentId, union) : sql`false`, eq(taskTemplates.createdBy, user.id))))
        .orderBy(asc(taskTemplates.name)),
      this.db.db.execute(sql`select distinct unnest(labels) as label from tasks where deleted_at is null limit 200`),
    ]);
    const labelList = ((labelRows as unknown as { rows?: Array<{ label: string }> }).rows ?? (labelRows as unknown as Array<{ label: string }>)) ?? [];
    return {
      departments: depts,
      projects,
      templates,
      labels: (Array.isArray(labelList) ? labelList : []).map((r) => r.label).filter(Boolean).sort(),
      statuses: TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABEL[s] })),
      priorities: TASK_PRIORITIES.map((p) => ({ value: p, label: TASK_PRIORITY_LABEL[p] })),
      permissions: {
        canAssign: hasPerm(user, TASK_PERMS.assign),
        canManage: hasPerm(user, TASK_PERMS.manage),
        canReport: hasPerm(user, TASK_PERMS.report),
        canExport: hasPerm(user, TASK_PERMS.export),
        canPrint: hasPerm(user, 'print.render.export'),
        seesAll: vScope === null,
      },
    };
  }

  /** Dự án đang hoạt động mà người dùng thấy (thành viên/chủ/khoa trong phạm vi). */
  async listVisibleProjects(user: AccessContext) {
    const where: SQL[] = [isNull(taskProjects.deletedAt), eq(taskProjects.archived, false)];
    if (!user.isSuperAdmin) {
      const scope = viewScope(user);
      const assign = deptScope(user, TASK_PERMS.assign);
      const depts = scope === null || assign === null ? null : [...new Set([...scope, ...assign])];
      const mine = sql`(${taskProjects.ownerId} = ${user.id} or ${taskProjects.createdBy} = ${user.id}
        or exists (select 1 from task_project_members pm where pm.project_id = ${taskProjects.id} and pm.user_id = ${user.id}))`;
      if (depts !== null) where.push(depts.length ? (or(mine, inArray(taskProjects.departmentId, depts)) as SQL) : mine);
    }
    return this.db.db
      .select({ id: taskProjects.id, code: taskProjects.code, name: taskProjects.name, color: taskProjects.color, status: taskProjects.status, departmentId: taskProjects.departmentId, ownerId: taskProjects.ownerId })
      .from(taskProjects)
      .where(and(...where))
      .orderBy(desc(taskProjects.createdAt))
      .limit(500);
  }

  /** Tóm tắt cá nhân cho trang tổng quan — ai cũng xem được. */
  async mySummary(user: AccessContext) {
    const uid = user.id;
    const res = await this.db.db.execute(sql`
      select
        count(*) filter (where assignee_id = ${uid} and status not in ('DONE','CANCELLED','DRAFT'))::int as "myOpen",
        count(*) filter (where assignee_id = ${uid} and status = 'ASSIGNED')::int as "myToAccept",
        count(*) filter (where assignee_id = ${uid} and status in ('ACCEPTED','IN_PROGRESS','RETURNED'))::int as "myInProgress",
        count(*) filter (where assignee_id = ${uid} and status = 'RETURNED')::int as "myReturned",
        count(*) filter (where assignee_id = ${uid} and status = 'SUBMITTED')::int as "mySubmitted",
        count(*) filter (where assignee_id = ${uid} and status not in ('DONE','CANCELLED','DRAFT') and due_at < now())::int as "myOverdue",
        count(*) filter (where assignee_id = ${uid} and status not in ('DONE','CANCELLED','DRAFT')
          and (due_at at time zone ${TZ})::date = (now() at time zone ${TZ})::date)::int as "myDueToday",
        count(*) filter (where assignee_id = ${uid} and status = 'DONE'
          and completed_at >= date_trunc('month', now() at time zone ${TZ}) at time zone ${TZ})::int as "myDoneThisMonth",
        count(*) filter (where coalesce(reviewer_id, assigner_id) = ${uid} and status = 'SUBMITTED')::int as "toReview",
        count(*) filter (where (assigner_id = ${uid} or created_by = ${uid}) and status not in ('DONE','CANCELLED','DRAFT'))::int as "assignedOpen",
        count(*) filter (where (assigner_id = ${uid} or created_by = ${uid}) and status not in ('DONE','CANCELLED','DRAFT') and due_at < now())::int as "assignedOverdue"
      from tasks where deleted_at is null`);
    const rows = (res as unknown as { rows?: Record<string, number>[] }).rows ?? (res as unknown as Record<string, number>[]);
    const counts = rows[0] ?? {};
    const [overdue, upcoming, review, assigned, stats] = await Promise.all([
      this.list(user, { view: 'mine', due: 'overdue', sort: 'due', pageSize: '10' }),
      this.list(user, { view: 'mine', status: 'ASSIGNED,ACCEPTED,IN_PROGRESS,RETURNED,ON_HOLD', sort: 'due', pageSize: '10' }),
      this.list(user, { view: 'review', status: 'SUBMITTED', sort: 'due', pageSize: '10' }),
      this.list(user, { view: 'assigned', status: 'ASSIGNED,ACCEPTED,IN_PROGRESS,RETURNED,ON_HOLD,SUBMITTED,DECLINED', sort: 'due', pageSize: '10' }),
      this.myStats(uid),
    ]);
    return { counts, overdue: overdue.items, upcoming: upcoming.items, review: review.items, assigned: assigned.items, stats };
  }

  /** Thống kê cá nhân cho trang tổng quan: phân bố trạng thái/ưu tiên, xu hướng 30 ngày, tỷ lệ đúng hạn tháng này. */
  private async myStats(uid: number) {
    const rowsOf = <T>(res: unknown): T[] => ((res as { rows?: T[] }).rows ?? (res as T[])) ?? [];
    const [statusRes, priorityRes, assignedRes, doneRes, monthRes] = await Promise.all([
      this.db.db.execute(sql`select status, count(*)::int as n from tasks
        where deleted_at is null and assignee_id = ${uid} and status <> 'DRAFT' group by status`),
      this.db.db.execute(sql`select priority, count(*)::int as n from tasks
        where deleted_at is null and assignee_id = ${uid} and status not in ('DONE','CANCELLED','DRAFT') group by priority`),
      this.db.db.execute(sql`select to_char((coalesce(assigned_at, created_at) at time zone ${TZ})::date, 'YYYY-MM-DD') as d, count(*)::int as n
        from tasks where deleted_at is null and assignee_id = ${uid} and status <> 'DRAFT'
          and coalesce(assigned_at, created_at) >= now() - interval '30 days' group by 1`),
      this.db.db.execute(sql`select to_char((completed_at at time zone ${TZ})::date, 'YYYY-MM-DD') as d, count(*)::int as n,
          count(*) filter (where due_at is not null and completed_at > due_at)::int as late
        from tasks where deleted_at is null and assignee_id = ${uid} and status = 'DONE'
          and completed_at >= now() - interval '30 days' group by 1`),
      this.db.db.execute(sql`select count(*) filter (where due_at is not null)::int as "withDue",
          count(*) filter (where due_at is not null and completed_at <= due_at)::int as "onTime"
        from tasks where deleted_at is null and assignee_id = ${uid} and status = 'DONE'
          and completed_at >= date_trunc('month', now() at time zone ${TZ}) at time zone ${TZ}`),
    ]);
    const assignedMap = new Map(rowsOf<{ d: string; n: number }>(assignedRes).map((r) => [r.d, Number(r.n)]));
    const doneMap = new Map(rowsOf<{ d: string; n: number; late: number }>(doneRes).map((r) => [r.d, r]));
    const series: Array<{ date: string; label: string; assigned: number; done: number; late: number }> = [];
    const todayVn = new Date(Date.now() + 7 * 3600_000);
    for (let i = 29; i >= 0; i--) {
      const d = new Date(todayVn.getTime() - i * 86400_000).toISOString().slice(0, 10);
      const done = doneMap.get(d);
      series.push({ date: d, label: `${d.slice(8, 10)}/${d.slice(5, 7)}`, assigned: assignedMap.get(d) ?? 0, done: Number(done?.n ?? 0), late: Number(done?.late ?? 0) });
    }
    const month = rowsOf<{ withDue: number; onTime: number }>(monthRes)[0];
    const withDue = Number(month?.withDue ?? 0);
    return {
      byStatus: rowsOf<{ status: TaskStatus; n: number }>(statusRes).map((r) => ({ status: r.status, label: TASK_STATUS_LABEL[r.status] ?? r.status, count: Number(r.n) })),
      byPriority: rowsOf<{ priority: keyof typeof TASK_PRIORITY_LABEL; n: number }>(priorityRes).map((r) => ({ priority: r.priority, label: TASK_PRIORITY_LABEL[r.priority] ?? r.priority, count: Number(r.n) })),
      series,
      onTimeRateMonth: withDue ? Math.round((1000 * Number(month?.onTime ?? 0)) / withDue) / 1000 : null,
    };
  }

  /* ====================================================================== Mẫu công việc */

  async listTemplates(user: AccessContext) {
    const meta = await this.meta(user);
    return meta.templates;
  }

  async saveTemplate(user: AccessContext, id: number | null, dto: TaskTemplateDto) {
    if (!hasPerm(user, TASK_PERMS.assign)) throw new ForbiddenException('Cần quyền giao việc để quản lý mẫu công việc');
    if (dto.departmentId && !inScope(deptScope(user, TASK_PERMS.assign), dto.departmentId)) throw new ForbiddenException('Khoa/phòng ngoài phạm vi');
    const values = {
      name: dto.name.trim(),
      title: dto.title?.trim() ?? '',
      description: dto.description ?? '',
      priority: dto.priority ?? 'NORMAL',
      estimateHours: dto.estimateHours === undefined || dto.estimateHours === null ? null : String(dto.estimateHours),
      dueDays: dto.dueDays ?? null,
      checklist: (dto.checklist ?? []).map((c) => c.trim()).filter(Boolean),
      labels: normalizeLabels(dto.labels),
      departmentId: dto.departmentId ?? null,
      active: dto.active ?? true,
      updatedAt: new Date(),
    };
    if (id) {
      const [existing] = await this.db.db.select().from(taskTemplates).where(eq(taskTemplates.id, id)).limit(1);
      if (!existing) throw new NotFoundException('Không tìm thấy mẫu');
      if (!user.isSuperAdmin && existing.createdBy !== user.id && !inScope(deptScope(user, TASK_PERMS.manage), existing.departmentId)) {
        throw new ForbiddenException('Bạn không sửa được mẫu này');
      }
      const [row] = await this.db.db.update(taskTemplates).set(values).where(eq(taskTemplates.id, id)).returning();
      return row;
    }
    const [row] = await this.db.db.insert(taskTemplates).values({ ...values, createdBy: user.id }).returning();
    return row;
  }

  async deleteTemplate(user: AccessContext, id: number) {
    const [existing] = await this.db.db.select().from(taskTemplates).where(eq(taskTemplates.id, id)).limit(1);
    if (!existing) throw new NotFoundException('Không tìm thấy mẫu');
    if (!user.isSuperAdmin && existing.createdBy !== user.id && !inScope(deptScope(user, TASK_PERMS.manage), existing.departmentId)) {
      throw new ForbiddenException('Bạn không xóa được mẫu này');
    }
    await this.db.db.update(taskTemplates).set({ active: false, updatedAt: new Date() }).where(eq(taskTemplates.id, id));
    return { ok: true };
  }

  /* ====================================================================== Tiện ích nội bộ */

  async writeLog(
    executor: Executor,
    taskId: number,
    user: AccessContext | null,
    action: string,
    fromStatus: string,
    toStatus: string,
    note: string,
    changes: Record<string, [unknown, unknown]> | null,
    client?: ClientMeta,
  ): Promise<void> {
    await executor.insert(taskLogs).values({
      taskId,
      userId: user?.id ?? null,
      username: user?.username ?? 'he-thong',
      fullName: user?.fullName ?? 'Hệ thống',
      action,
      fromStatus,
      toStatus,
      note: note.slice(0, 4000),
      changes,
      ip: (client?.ip ?? '').slice(0, 64),
    });
  }

  async notify(
    userIds: number[],
    task: Pick<Task, 'id' | 'code'>,
    input: { title: string; body: string; level?: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR'; kind?: NotifyEventKind; link?: string; module?: string },
  ): Promise<void> {
    if (userIds.length === 0) return;
    try {
      await this.notifications.notify(userIds, {
        title: input.title,
        body: input.body,
        level: input.level ?? 'INFO',
        link: input.link ?? `/cong-viec/${task.id}`,
        module: input.module ?? 'TASK',
        entityId: String(task.id),
        externalKind: input.kind,
      });
    } catch (err) {
      this.logger.warn(`Không gởi được thông báo công việc ${task.code}: ${(err as Error).message}`);
    }
  }

  publish(task: Pick<Task, 'id' | 'assigneeId' | 'assignerId' | 'reviewerId' | 'createdBy' | 'departmentId' | 'status'>, type: string, watcherIds: number[] = []): void {
    const userIds = [...new Set([task.assigneeId, task.assignerId, task.reviewerId, task.createdBy, ...watcherIds].filter((v): v is number => !!v))];
    const data = { taskId: task.id, status: task.status };
    if (userIds.length) this.realtime.publish({ topic: 'tasks', type, userIds, data });
    this.realtime.publish({ topic: 'tasks', type, permissions: [TASK_PERMS.manage, TASK_PERMS.report], departmentId: task.departmentId, data });
  }
}
