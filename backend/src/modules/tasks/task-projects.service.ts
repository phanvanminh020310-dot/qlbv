/**
 * DỰ ÁN — nhóm công việc nhiều thành viên, thấy rõ ai làm việc gì và tiến độ chung.
 */
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import type { AccessContext } from '../../common/types/access-context';
import { DbService } from '../../db/db.service';
import { departments, taskProjectMembers, taskProjects, tasks, users, type TaskProject, type TaskStatus } from '../../db/schema';
import { TASK_PERMS, deptScope, hasPerm, inScope, viewScope } from './task-access';
import { FINAL_STATUSES, TASK_PRIORITY_LABEL, TASK_STATUS_LABEL } from './task-workflow';
import type { CreateProjectDto, ProjectMemberDto, UpdateProjectDto } from './tasks.dto';
import { TasksService } from './tasks.service';

export const PROJECT_STATUS_LABEL: Record<string, string> = {
  PLANNING: 'Lập kế hoạch',
  ACTIVE: 'Đang thực hiện',
  ON_HOLD: 'Tạm dừng',
  COMPLETED: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
};

@Injectable()
export class TaskProjectsService {
  constructor(
    private readonly db: DbService,
    private readonly tasksService: TasksService,
  ) {}

  private async access(user: AccessContext, project: TaskProject) {
    const [member] = await this.db.db
      .select({ role: taskProjectMembers.role })
      .from(taskProjectMembers)
      .where(and(eq(taskProjectMembers.projectId, project.id), eq(taskProjectMembers.userId, user.id)))
      .limit(1);
    const isOwner = project.ownerId === user.id || project.createdBy === user.id;
    const managesScope = user.isSuperAdmin || inScope(deptScope(user, TASK_PERMS.manage), project.departmentId);
    const canManage = isOwner || managesScope || member?.role === 'MANAGER';
    const canView =
      canManage || !!member || inScope(viewScope(user), project.departmentId) || inScope(deptScope(user, TASK_PERMS.assign), project.departmentId);
    return { canManage, canView, memberRole: member?.role ?? null, isOwner };
  }

  private async load(id: number): Promise<TaskProject> {
    const [project] = await this.db.db.select().from(taskProjects).where(and(eq(taskProjects.id, id), isNull(taskProjects.deletedAt))).limit(1);
    if (!project) throw new NotFoundException('Không tìm thấy dự án');
    return project;
  }

  async list(user: AccessContext, q: { q?: string; status?: string; archived?: string }) {
    const where: SQL[] = [isNull(taskProjects.deletedAt)];
    if (q.archived !== '1') where.push(eq(taskProjects.archived, false));
    if (q.status) where.push(eq(taskProjects.status, q.status as TaskProject['status']));
    if (q.q?.trim()) {
      const like = `%${q.q.trim()}%`;
      where.push(or(ilike(taskProjects.name, like), ilike(taskProjects.code, like), ilike(taskProjects.description, like)) as SQL);
    }
    if (!user.isSuperAdmin) {
      const scope = viewScope(user);
      const assign = deptScope(user, TASK_PERMS.assign);
      const depts = scope === null || assign === null ? null : [...new Set([...scope, ...assign])];
      const mine = sql`(${taskProjects.ownerId} = ${user.id} or ${taskProjects.createdBy} = ${user.id}
        or exists (select 1 from task_project_members pm where pm.project_id = ${taskProjects.id} and pm.user_id = ${user.id}))`;
      if (depts !== null) where.push(depts.length ? (or(mine, inArray(taskProjects.departmentId, depts)) as SQL) : mine);
    }
    const rows = await this.db.db
      .select({
        id: taskProjects.id,
        code: taskProjects.code,
        name: taskProjects.name,
        description: taskProjects.description,
        status: taskProjects.status,
        priority: taskProjects.priority,
        color: taskProjects.color,
        startDate: taskProjects.startDate,
        dueDate: taskProjects.dueDate,
        archived: taskProjects.archived,
        departmentId: taskProjects.departmentId,
        departmentName: departments.name,
        ownerId: taskProjects.ownerId,
        ownerName: users.fullName,
        createdAt: taskProjects.createdAt,
        memberCount: sql<number>`(select count(*)::int from task_project_members m where m.project_id = ${taskProjects.id})`,
        taskTotal: sql<number>`(select count(*)::int from tasks t where t.project_id = ${taskProjects.id} and t.deleted_at is null and t.status not in ('CANCELLED','DRAFT'))`,
        taskDone: sql<number>`(select count(*)::int from tasks t where t.project_id = ${taskProjects.id} and t.deleted_at is null and t.status = 'DONE')`,
        taskOverdue: sql<number>`(select count(*)::int from tasks t where t.project_id = ${taskProjects.id} and t.deleted_at is null and t.status not in ('DONE','CANCELLED','DRAFT') and t.due_at < now())`,
      })
      .from(taskProjects)
      .leftJoin(departments, eq(departments.id, taskProjects.departmentId))
      .leftJoin(users, eq(users.id, taskProjects.ownerId))
      .where(and(...where))
      .orderBy(desc(taskProjects.createdAt))
      .limit(500);
    return rows.map((r) => ({
      ...r,
      statusLabel: PROJECT_STATUS_LABEL[r.status] ?? r.status,
      progress: r.taskTotal ? Math.round((1000 * r.taskDone) / r.taskTotal) / 10 : 0,
    }));
  }

  private async validateMembers(user: AccessContext, members: ProjectMemberDto[]) {
    const ids = [...new Set(members.map((m) => m.userId))];
    if (ids.length === 0) return new Map<number, { id: number; fullName: string; departmentId: number | null }>();
    const found = await this.db.db
      .select({ id: users.id, fullName: users.fullName, departmentId: users.departmentId, active: users.active })
      .from(users)
      .where(and(inArray(users.id, ids), isNull(users.deletedAt)));
    if (found.length !== ids.length || found.some((f) => !f.active)) throw new BadRequestException('Thành viên không tồn tại hoặc đã ngừng hoạt động');
    const scope = deptScope(user, TASK_PERMS.assign);
    for (const f of found) {
      if (f.id !== user.id && !user.isSuperAdmin && !inScope(scope, f.departmentId)) {
        throw new ForbiddenException(`${f.fullName} ngoài phạm vi khoa/phòng bạn được giao việc`);
      }
    }
    return new Map(found.map((f) => [f.id, f]));
  }

  async create(user: AccessContext, dto: CreateProjectDto) {
    if (!hasPerm(user, TASK_PERMS.assign)) throw new ForbiddenException('Cần quyền giao việc để tạo dự án');
    const departmentId = dto.departmentId ?? user.departmentId ?? null;
    if (departmentId && !user.isSuperAdmin && !inScope(deptScope(user, TASK_PERMS.assign), departmentId)) {
      throw new ForbiddenException('Khoa/phòng của dự án nằm ngoài phạm vi giao việc của bạn');
    }
    if (dto.startDate && dto.dueDate && dto.startDate > dto.dueDate) throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu');
    const ownerId = dto.ownerId ?? user.id;
    const members = [...(dto.members ?? [])];
    if (!members.some((m) => m.userId === ownerId)) members.push({ userId: ownerId, role: 'MANAGER' });
    const memberMap = await this.validateMembers(user, members);
    const project = await this.db.transaction(async (tx) => {
      const now = new Date();
      const [row] = await tx
        .insert(taskProjects)
        .values({
          code: `TMP-${randomUUID()}`,
          name: dto.name.trim(),
          description: dto.description ?? '',
          departmentId,
          ownerId,
          status: dto.status ?? 'ACTIVE',
          priority: dto.priority ?? 'NORMAL',
          startDate: dto.startDate ?? null,
          dueDate: dto.dueDate ?? null,
          color: dto.color ?? '#0f766e',
          createdBy: user.id,
        })
        .returning();
      const [saved] = await tx
        .update(taskProjects)
        .set({ code: `DA-${now.getFullYear()}-${String(row!.id).padStart(4, '0')}` })
        .where(eq(taskProjects.id, row!.id))
        .returning();
      const unique = new Map(members.map((m) => [m.userId, m]));
      await tx
        .insert(taskProjectMembers)
        .values([...unique.values()].map((m) => ({ projectId: saved!.id, userId: m.userId, role: m.userId === ownerId ? 'MANAGER' : (m.role ?? 'MEMBER'), addedBy: user.id })))
        .onConflictDoNothing();
      return saved!;
    });
    const notifyIds = [...memberMap.keys()].filter((id) => id !== user.id);
    await this.notifyMembers(notifyIds, project, user);
    return { id: project.id, code: project.code };
  }

  private async notifyMembers(userIds: number[], project: TaskProject, user: AccessContext) {
    if (!userIds.length) return;
    await this.tasksService
      .notify(userIds, { id: project.id, code: project.code }, {
        title: 'Bạn được thêm vào dự án',
        body: `${project.code} · ${project.name} — bởi ${user.fullName}`,
        level: 'INFO',
        kind: 'project.memberAdded',
        link: `/cong-viec/du-an/${project.id}`,
        module: 'TASK_PROJECT',
      })
      .catch(() => undefined);
  }

  async update(user: AccessContext, id: number, dto: UpdateProjectDto) {
    const project = await this.load(id);
    const acc = await this.access(user, project);
    if (!acc.canManage) throw new ForbiddenException('Chỉ quản lý dự án mới sửa được dự án');
    const patch: Partial<typeof taskProjects.$inferInsert> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.status !== undefined) {
      patch.status = dto.status;
      patch.completedAt = dto.status === 'COMPLETED' ? new Date() : null;
    }
    if (dto.priority !== undefined) patch.priority = dto.priority;
    if (dto.startDate !== undefined) patch.startDate = dto.startDate;
    if (dto.dueDate !== undefined) patch.dueDate = dto.dueDate;
    if (dto.color !== undefined) patch.color = dto.color;
    if (dto.archived !== undefined) patch.archived = dto.archived;
    if (dto.ownerId !== undefined && dto.ownerId !== project.ownerId) {
      if (dto.ownerId) {
        await this.validateMembers(user, [{ userId: dto.ownerId }]);
        await this.db.db.insert(taskProjectMembers).values({ projectId: id, userId: dto.ownerId, role: 'MANAGER', addedBy: user.id })
          .onConflictDoUpdate({ target: [taskProjectMembers.projectId, taskProjectMembers.userId], set: { role: 'MANAGER' } });
      }
      patch.ownerId = dto.ownerId;
    }
    const start = patch.startDate !== undefined ? patch.startDate : project.startDate;
    const due = patch.dueDate !== undefined ? patch.dueDate : project.dueDate;
    if (start && due && start > due) throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu');
    await this.db.db.update(taskProjects).set(patch).where(eq(taskProjects.id, id));
    return this.detail(user, id);
  }

  async setMembers(user: AccessContext, id: number, members: ProjectMemberDto[]) {
    const project = await this.load(id);
    const acc = await this.access(user, project);
    if (!acc.canManage) throw new ForbiddenException('Chỉ quản lý dự án mới cập nhật được thành viên');
    const current = await this.db.db.select().from(taskProjectMembers).where(eq(taskProjectMembers.projectId, id));
    const currentIds = new Set(current.map((c) => c.userId));
    const next = new Map(members.map((m) => [m.userId, m]));
    if (project.ownerId && !next.has(project.ownerId)) next.set(project.ownerId, { userId: project.ownerId, role: 'MANAGER' });
    const newcomers = [...next.values()].filter((m) => !currentIds.has(m.userId));
    await this.validateMembers(user, newcomers);
    await this.db.transaction(async (tx) => {
      const removed = current.filter((c) => !next.has(c.userId)).map((c) => c.userId);
      if (removed.length) await tx.delete(taskProjectMembers).where(and(eq(taskProjectMembers.projectId, id), inArray(taskProjectMembers.userId, removed)));
      for (const m of next.values()) {
        const role = m.userId === project.ownerId ? 'MANAGER' : (m.role ?? 'MEMBER');
        await tx
          .insert(taskProjectMembers)
          .values({ projectId: id, userId: m.userId, role, addedBy: user.id })
          .onConflictDoUpdate({ target: [taskProjectMembers.projectId, taskProjectMembers.userId], set: { role } });
      }
    });
    await this.notifyMembers(newcomers.map((m) => m.userId).filter((u) => u !== user.id), project, user);
    return this.detail(user, id);
  }

  async detail(user: AccessContext, id: number) {
    const project = await this.load(id);
    const acc = await this.access(user, project);
    if (!acc.canView) throw new ForbiddenException('Bạn không có quyền xem dự án này');
    const [dept] = project.departmentId
      ? await this.db.db.select({ name: departments.name }).from(departments).where(eq(departments.id, project.departmentId)).limit(1)
      : [];
    const memberRows = await this.db.db
      .select({ userId: taskProjectMembers.userId, role: taskProjectMembers.role, fullName: users.fullName, username: users.username, title: users.title,
        departmentName: departments.name })
      .from(taskProjectMembers)
      .innerJoin(users, eq(users.id, taskProjectMembers.userId))
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(eq(taskProjectMembers.projectId, id))
      .orderBy(asc(users.fullName));
    const taskRows = await this.tasksService.list(user, { projectId: String(id), pageSize: '500', sort: 'due' });
    const items = taskRows.items;
    const stat = (list: typeof items) => ({
      total: list.filter((t) => t.status !== 'CANCELLED' && t.status !== 'DRAFT').length,
      done: list.filter((t) => t.status === 'DONE').length,
      inProgress: list.filter((t) => ['ACCEPTED', 'IN_PROGRESS', 'RETURNED'].includes(t.status)).length,
      waiting: list.filter((t) => t.status === 'ASSIGNED').length,
      submitted: list.filter((t) => t.status === 'SUBMITTED').length,
      overdue: list.filter((t) => t.overdue).length,
    });
    const members = memberRows.map((m) => {
      const mine = items.filter((t) => t.assigneeId === m.userId);
      const s = stat(mine);
      return {
        ...m,
        stats: s,
        progress: s.total ? Math.round((1000 * s.done) / s.total) / 10 : 0,
        tasks: mine.map((t) => ({ id: t.id, code: t.code, title: t.title, status: t.status, statusLabel: t.statusLabel, dueAt: t.dueAt, overdue: t.overdue, priority: t.priority, parentId: t.parentId })),
      };
    });
    const overall = stat(items);
    const byStatus = Object.entries(
      items.reduce<Record<string, number>>((acc2, t) => {
        acc2[t.status] = (acc2[t.status] ?? 0) + 1;
        return acc2;
      }, {}),
    ).map(([status, count]) => ({ status, label: TASK_STATUS_LABEL[status as TaskStatus] ?? status, count }));
    const [owner] = project.ownerId ? await this.db.db.select({ fullName: users.fullName }).from(users).where(eq(users.id, project.ownerId)).limit(1) : [];
    return {
      ...project,
      statusLabel: PROJECT_STATUS_LABEL[project.status] ?? project.status,
      priorityLabel: TASK_PRIORITY_LABEL[project.priority] ?? project.priority,
      departmentName: dept?.name ?? '',
      ownerName: owner?.fullName ?? '',
      members,
      tasks: items,
      stats: overall,
      progress: overall.total ? Math.round((1000 * overall.done) / overall.total) / 10 : 0,
      byStatus,
      unassigned: items.filter((t) => !t.assigneeId).length,
      openCount: items.filter((t) => !FINAL_STATUSES.includes(t.status)).length,
      timeline: items
        .filter((t) => t.dueAt || t.startDate)
        .map((t) => ({ id: t.id, code: t.code, title: t.title, status: t.status, start: t.startDate ?? (t.assignedAt ? new Date(t.assignedAt).toISOString().slice(0, 10) : null),
          end: t.dueAt ? new Date(new Date(t.dueAt).getTime() + 7 * 3600_000).toISOString().slice(0, 10) : null, assigneeName: t.assigneeName, overdue: t.overdue,
          done: t.status === 'DONE', late: t.late })),
      viewer: { canManage: acc.canManage, memberRole: acc.memberRole, canAddTask: acc.canManage || hasPerm(user, TASK_PERMS.assign) },
    };
  }

  async remove(user: AccessContext, id: number) {
    const project = await this.load(id);
    const acc = await this.access(user, project);
    if (!acc.canManage) throw new ForbiddenException('Chỉ quản lý dự án mới xóa được dự án');
    const [open] = await this.db.db
      .select({ c: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.projectId, id), isNull(tasks.deletedAt), sql`${tasks.status} not in ('DONE','CANCELLED','DRAFT')`));
    if ((open?.c ?? 0) > 0) throw new BadRequestException(`Dự án còn ${open!.c} công việc đang mở — hãy hoàn thành/hủy hoặc lưu trữ dự án`);
    await this.db.db.update(taskProjects).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(taskProjects.id, id));
    return { ok: true };
  }
}
