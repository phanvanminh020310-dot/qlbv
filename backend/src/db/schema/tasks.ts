/**
 * Phân hệ QUẢN LÝ CÔNG VIỆC — giao việc, thực hiện, duyệt kết quả, dự án nhiều thành viên.
 * Cấu trúc bảng khớp migration `0044_quan_ly_cong_viec.sql`.
 */
import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { departments } from './org';
import { users } from './system';

export const TASK_STATUSES = [
  'DRAFT',
  'ASSIGNED',
  'ACCEPTED',
  'IN_PROGRESS',
  'ON_HOLD',
  'SUBMITTED',
  'RETURNED',
  'DONE',
  'CANCELLED',
  'DECLINED',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const PROJECT_STATUSES = ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface TaskRecurrence {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  interval: number;
  /** YYYY-MM-DD — ngừng sinh lần tiếp sau ngày này */
  until?: string | null;
}

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const taskProjects = pgTable('task_projects', {
  id: serial('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  description: text('description').default('').notNull(),
  departmentId: integer('department_id').references(() => departments.id, { onDelete: 'set null' }),
  ownerId: integer('owner_id').references(() => users.id, { onDelete: 'set null' }),
  status: text('status').$type<ProjectStatus>().default('ACTIVE').notNull(),
  priority: text('priority').$type<TaskPriority>().default('NORMAL').notNull(),
  startDate: date('start_date'),
  dueDate: date('due_date'),
  color: text('color').default('#0f766e').notNull(),
  archived: boolean('archived').default(false).notNull(),
  completedAt: ts('completed_at'),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').defaultNow().notNull(),
  updatedAt: ts('updated_at').defaultNow().notNull(),
  deletedAt: ts('deleted_at'),
});

export const taskProjectMembers = pgTable(
  'task_project_members',
  {
    projectId: integer('project_id').notNull().references(() => taskProjects.id, { onDelete: 'cascade' }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<'MANAGER' | 'MEMBER' | 'VIEWER'>().default('MEMBER').notNull(),
    addedBy: integer('added_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
);

export const taskTemplates = pgTable('task_templates', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  title: text('title').default('').notNull(),
  description: text('description').default('').notNull(),
  priority: text('priority').$type<TaskPriority>().default('NORMAL').notNull(),
  estimateHours: numeric('estimate_hours', { precision: 8, scale: 2 }),
  dueDays: integer('due_days'),
  checklist: jsonb('checklist').$type<string[]>().default([]).notNull(),
  labels: text('labels').array().default([]).notNull(),
  departmentId: integer('department_id').references(() => departments.id, { onDelete: 'set null' }),
  active: boolean('active').default(true).notNull(),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').defaultNow().notNull(),
  updatedAt: ts('updated_at').defaultNow().notNull(),
});

export const tasks = pgTable('tasks', {
  id: serial('id').primaryKey(),
  code: text('code').notNull(),
  title: text('title').notNull(),
  description: text('description').default('').notNull(),
  projectId: integer('project_id').references(() => taskProjects.id, { onDelete: 'set null' }),
  parentId: integer('parent_id'),
  departmentId: integer('department_id').references(() => departments.id, { onDelete: 'set null' }),
  assignerId: integer('assigner_id').references(() => users.id, { onDelete: 'set null' }),
  assigneeId: integer('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  reviewerId: integer('reviewer_id').references(() => users.id, { onDelete: 'set null' }),
  status: text('status').$type<TaskStatus>().default('ASSIGNED').notNull(),
  priority: text('priority').$type<TaskPriority>().default('NORMAL').notNull(),
  startDate: date('start_date'),
  dueAt: ts('due_at'),
  estimateHours: numeric('estimate_hours', { precision: 8, scale: 2 }),
  progress: integer('progress').default(0).notNull(),
  labels: text('labels').array().default([]).notNull(),
  resultContent: text('result_content').default('').notNull(),
  submissionCount: integer('submission_count').default(0).notNull(),
  returnCount: integer('return_count').default(0).notNull(),
  statusReason: text('status_reason').default('').notNull(),
  assignedAt: ts('assigned_at'),
  acceptedAt: ts('accepted_at'),
  startedAt: ts('started_at'),
  submittedAt: ts('submitted_at'),
  completedAt: ts('completed_at'),
  cancelledAt: ts('cancelled_at'),
  approvedBy: integer('approved_by').references(() => users.id, { onDelete: 'set null' }),
  recurrence: jsonb('recurrence').$type<TaskRecurrence | null>(),
  recurrenceSourceId: integer('recurrence_source_id'),
  templateId: integer('template_id').references(() => taskTemplates.id, { onDelete: 'set null' }),
  dueRemindedAt: ts('due_reminded_at'),
  overdueNotifiedAt: ts('overdue_notified_at'),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').defaultNow().notNull(),
  updatedAt: ts('updated_at').defaultNow().notNull(),
  deletedAt: ts('deleted_at'),
});

export const taskWatchers = pgTable(
  'task_watchers',
  {
    taskId: integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.userId] })],
);

export const taskDependencies = pgTable(
  'task_dependencies',
  {
    taskId: integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    dependsOnId: integer('depends_on_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.dependsOnId] })],
);

export const taskChecklistItems = pgTable('task_checklist_items', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  done: boolean('done').default(false).notNull(),
  doneBy: integer('done_by').references(() => users.id, { onDelete: 'set null' }),
  doneAt: ts('done_at'),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: ts('created_at').defaultNow().notNull(),
});

export const taskComments = pgTable('task_comments', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  fullName: text('full_name').default('').notNull(),
  content: text('content').notNull(),
  mentions: integer('mentions').array().default([]).notNull(),
  createdAt: ts('created_at').defaultNow().notNull(),
  updatedAt: ts('updated_at').defaultNow().notNull(),
  deletedAt: ts('deleted_at'),
});

export const taskAttachments = pgTable('task_attachments', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  commentId: integer('comment_id').references(() => taskComments.id, { onDelete: 'set null' }),
  kind: text('kind').$type<'REFERENCE' | 'RESULT' | 'COMMENT'>().default('REFERENCE').notNull(),
  submissionNo: integer('submission_no').default(0).notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').default(0).notNull(),
  storagePath: text('storage_path').notNull(),
  uploadedBy: integer('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  fullName: text('full_name').default('').notNull(),
  createdAt: ts('created_at').defaultNow().notNull(),
  deletedAt: ts('deleted_at'),
});

export const taskWorklogs = pgTable('task_worklogs', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  fullName: text('full_name').default('').notNull(),
  workDate: date('work_date').notNull(),
  hours: numeric('hours', { precision: 6, scale: 2 }).default('0').notNull(),
  content: text('content').default('').notNull(),
  progress: integer('progress'),
  createdAt: ts('created_at').defaultNow().notNull(),
  deletedAt: ts('deleted_at'),
});

export const taskLogs = pgTable('task_logs', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  username: text('username').default('').notNull(),
  fullName: text('full_name').default('').notNull(),
  action: text('action').notNull(),
  fromStatus: text('from_status').default('').notNull(),
  toStatus: text('to_status').default('').notNull(),
  note: text('note').default('').notNull(),
  changes: jsonb('changes').$type<Record<string, [unknown, unknown]> | null>(),
  ip: text('ip').default('').notNull(),
  createdAt: ts('created_at').defaultNow().notNull(),
});

export type Task = typeof tasks.$inferSelect;
export type TaskProject = typeof taskProjects.$inferSelect;
