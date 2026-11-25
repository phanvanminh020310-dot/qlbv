import { askPrintParams, missingParams, type PrintParamField } from '@/components/printing/print-params-dialog';
import { apiFetch } from '@/lib/api';

/* ================================================================ Kiểu dữ liệu */

export type TaskStatus = 'DRAFT' | 'ASSIGNED' | 'ACCEPTED' | 'DECLINED' | 'IN_PROGRESS' | 'ON_HOLD' | 'SUBMITTED' | 'RETURNED' | 'DONE' | 'CANCELLED';
export type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type TaskAction = 'assign' | 'accept' | 'decline' | 'start' | 'hold' | 'submit' | 'approve' | 'return' | 'cancel' | 'reopen';
export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';

export interface TaskRecurrence { freq: 'DAILY' | 'WEEKLY' | 'MONTHLY'; interval: number; until?: string | null }

export interface TaskRow {
  id: number;
  code: string;
  title: string;
  status: TaskStatus;
  statusLabel: string;
  priority: TaskPriority;
  priorityLabel: string;
  progress: number;
  labels: string[];
  startDate: string | null;
  dueAt: string | null;
  projectId: number | null;
  parentId: number | null;
  departmentId: number | null;
  assigneeId: number | null;
  assignerId: number | null;
  reviewerId: number | null;
  returnCount: number;
  assignedAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: number | null;
  recurrence: TaskRecurrence | null;
  assigneeName: string | null;
  assignerName: string | null;
  reviewerName: string | null;
  departmentName: string | null;
  projectName: string | null;
  projectCode: string | null;
  projectColor: string | null;
  checklistTotal: number;
  checklistDone: number;
  subtaskTotal: number;
  subtaskDone: number;
  commentCount: number;
  attachmentCount: number;
  overdue: boolean;
  late: boolean;
}

export interface TaskAttachment {
  id: number;
  kind: 'REFERENCE' | 'RESULT' | 'COMMENT';
  submissionNo: number;
  commentId: number | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: number | null;
  fullName: string;
  createdAt: string;
  canDelete?: boolean;
}

export interface TaskRef { id: number; code: string; title: string; status: TaskStatus; statusLabel?: string }
export interface TaskPerson { id: number; fullName: string; username: string; title?: string }

export interface TaskViewer {
  isAssignee: boolean;
  isAssigner: boolean;
  isReviewer: boolean;
  isCreator: boolean;
  managesScope: boolean;
  isProjectManager: boolean;
  isManager: boolean;
  isWatching: boolean;
  allowedActions: TaskAction[];
  canEdit: boolean;
  canUpdateProgress: boolean;
  canWorklog: boolean;
  canChecklist: boolean;
  canUpload: boolean;
  canAddSubtask: boolean;
  canComment: boolean;
  canDelete: boolean;
}

export interface TaskDetail extends TaskRow {
  description: string;
  resultContent: string;
  statusReason: string;
  estimateHours: string | null;
  submissionCount: number;
  acceptedAt: string | null;
  startedAt: string | null;
  cancelledAt: string | null;
  checklist: Array<{ id: number; content: string; done: boolean; doneAt: string | null; doneBy: number | null }>;
  subtasks: Array<TaskRef & { priority: TaskPriority; dueAt: string | null; progress: number; assigneeName: string | null; overdue: boolean; statusLabel: string }>;
  dependencies: TaskRef[];
  dependents: TaskRef[];
  watchers: TaskPerson[];
  attachments: TaskAttachment[];
  parent: TaskRef | null;
  participants: TaskPerson[];
  viewer: TaskViewer;
}

export interface TaskComment {
  id: number;
  userId: number | null;
  fullName: string;
  content: string;
  mentions: number[];
  createdAt: string;
  mine: boolean;
  canDelete: boolean;
  files: Array<{ id: number; fileName: string; mimeType: string; sizeBytes: number }>;
}

export interface TaskWorklog { id: number; userId: number; fullName: string; workDate: string; hours: number; content: string; createdAt: string; mine: boolean }

export interface TaskLog { id: number; action: string; fromStatus: string; toStatus: string; fromLabel: string; toLabel: string; note: string; fullName: string; createdAt: string; changes: Record<string, [unknown, unknown]> | null }

export interface TaskTemplate {
  id: number;
  name: string;
  title: string;
  description: string;
  priority: TaskPriority;
  estimateHours: string | null;
  dueDays: number | null;
  checklist: string[];
  labels: string[];
  departmentId: number | null;
  createdBy: number | null;
  active: boolean;
}

export interface TaskProjectLite { id: number; code: string; name: string; color: string; status: ProjectStatus; departmentId: number | null; ownerId: number | null }

export interface TaskMeta {
  departments: Array<{ id: number; name: string; code: string }>;
  projects: TaskProjectLite[];
  templates: TaskTemplate[];
  labels: string[];
  statuses: Array<{ value: TaskStatus; label: string }>;
  priorities: Array<{ value: TaskPriority; label: string }>;
  permissions: { canAssign: boolean; canManage: boolean; canReport: boolean; canExport: boolean; canPrint: boolean; seesAll: boolean };
}

export interface AssignableUser { id: number; fullName: string; username: string; title: string; departmentId: number | null; departmentName: string | null; hasTelegram: boolean; hasPhone: boolean }

export interface TaskSummary {
  counts: Partial<Record<'myOpen' | 'myToAccept' | 'myInProgress' | 'myReturned' | 'mySubmitted' | 'myOverdue' | 'myDueToday' | 'myDoneThisMonth' | 'toReview' | 'assignedOpen' | 'assignedOverdue', number>>;
  overdue: TaskRow[];
  upcoming: TaskRow[];
  review: TaskRow[];
  /** Việc tôi đã giao còn đang mở */
  assigned: TaskRow[];
  stats: {
    byStatus: Array<{ status: TaskStatus; label: string; count: number }>;
    byPriority: Array<{ priority: TaskPriority; label: string; count: number }>;
    series: Array<{ date: string; label: string; assigned: number; done: number; late: number }>;
    onTimeRateMonth: number | null;
  };
}

export interface TaskFileInput { fileName: string; mimeType?: string; contentBase64: string }

export interface TaskInput {
  title: string;
  description?: string;
  assigneeId?: number | null;
  assigneeIds?: number[];
  reviewerId?: number | null;
  departmentId?: number | null;
  projectId?: number | null;
  parentId?: number | null;
  priority?: TaskPriority;
  startDate?: string | null;
  dueAt?: string | null;
  estimateHours?: number | null;
  labels?: string[];
  checklist?: string[];
  watcherIds?: number[];
  dependsOnIds?: number[];
  recurrence?: TaskRecurrence | null;
  templateId?: number | null;
  draft?: boolean;
  files?: TaskFileInput[];
}

export interface ProjectRow {
  id: number;
  code: string;
  name: string;
  description: string;
  status: ProjectStatus;
  statusLabel: string;
  priority: TaskPriority;
  color: string;
  startDate: string | null;
  dueDate: string | null;
  archived: boolean;
  departmentId: number | null;
  departmentName: string | null;
  ownerId: number | null;
  ownerName: string | null;
  memberCount: number;
  taskTotal: number;
  taskDone: number;
  taskOverdue: number;
  progress: number;
}

export interface ProjectStats { total: number; done: number; inProgress: number; waiting: number; submitted: number; overdue: number }
export interface ProjectMember {
  userId: number;
  role: 'MANAGER' | 'MEMBER' | 'VIEWER';
  fullName: string;
  username: string;
  title: string;
  departmentName: string | null;
  stats: ProjectStats;
  progress: number;
  tasks: Array<{ id: number; code: string; title: string; status: TaskStatus; statusLabel: string; dueAt: string | null; overdue: boolean; priority: TaskPriority; parentId: number | null }>;
}
export interface ProjectDetail extends Omit<ProjectRow, 'memberCount' | 'taskTotal' | 'taskDone' | 'taskOverdue'> {
  priorityLabel: string;
  members: ProjectMember[];
  tasks: TaskRow[];
  stats: ProjectStats;
  byStatus: Array<{ status: TaskStatus; label: string; count: number }>;
  unassigned: number;
  openCount: number;
  timeline: Array<{ id: number; code: string; title: string; status: TaskStatus; start: string | null; end: string | null; assigneeName: string | null; overdue: boolean; done: boolean; late: boolean }>;
  viewer: { canManage: boolean; memberRole: string | null; canAddTask: boolean };
}
export interface ProjectInput {
  name: string;
  description?: string;
  departmentId?: number | null;
  ownerId?: number | null;
  status?: ProjectStatus;
  priority?: TaskPriority;
  startDate?: string | null;
  dueDate?: string | null;
  color?: string;
  members?: Array<{ userId: number; role?: 'MANAGER' | 'MEMBER' | 'VIEWER' }>;
  archived?: boolean;
}

export interface PerfRow {
  key: number | null;
  name: string;
  extra: string;
  assigned: number;
  cancelled: number;
  done: number;
  onTime: number;
  late: number;
  open: number;
  overdue: number;
  submitted: number;
  returned: number;
  returnTimes: number;
  avgHours: number | null;
  hours: number;
  completionRate: number | null;
  onTimeRate: number | null;
  returnRate: number | null;
  score: number | null;
}
export interface ReportQuery { from?: string; to?: string; granularity?: 'day' | 'week' | 'month'; departmentId?: string; projectId?: string; assigneeId?: string }
export interface ReportOverview {
  period: { from: string; to: string; granularity: 'day' | 'week' | 'month' };
  kpi: PerfRow & { waiting: number; inProgress: number; onHold: number; declined: number };
  byStatus: Array<{ status: TaskStatus; label: string; count: number }>;
  byPriority: Array<{ priority: TaskPriority; label: string; count: number; overdue: number }>;
  byDepartment: PerfRow[];
  series: Array<{ bucket: string; label: string; assigned: number; done: number; onTime: number; late: number }>;
}
export interface ReportPerformance { period: ReportOverview['period']; people: PerfRow[]; departments: PerfRow[]; projects: PerfRow[]; formula: string }

/* ================================================================ Nhãn & màu */

export const STATUS_LABEL: Record<TaskStatus, string> = {
  DRAFT: 'Nháp',
  ASSIGNED: 'Chờ nhận',
  ACCEPTED: 'Đã nhận',
  DECLINED: 'Từ chối',
  IN_PROGRESS: 'Đang thực hiện',
  ON_HOLD: 'Tạm hoãn',
  SUBMITTED: 'Chờ duyệt',
  RETURNED: 'Làm lại',
  DONE: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
};
export const STATUS_TONE: Record<TaskStatus, 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'brand'> = {
  DRAFT: 'muted',
  ASSIGNED: 'info',
  ACCEPTED: 'brand',
  DECLINED: 'danger',
  IN_PROGRESS: 'brand',
  ON_HOLD: 'warning',
  SUBMITTED: 'warning',
  RETURNED: 'danger',
  DONE: 'success',
  CANCELLED: 'muted',
};
export const STATUS_COLOR: Record<TaskStatus, string> = {
  DRAFT: '#94a3b8',
  ASSIGNED: '#0ea5e9',
  ACCEPTED: '#14b8a6',
  DECLINED: '#ef4444',
  IN_PROGRESS: '#0f766e',
  ON_HOLD: '#f59e0b',
  SUBMITTED: '#a855f7',
  RETURNED: '#f97316',
  DONE: '#16a34a',
  CANCELLED: '#64748b',
};
export const PRIORITY_LABEL: Record<TaskPriority, string> = { LOW: 'Thấp', NORMAL: 'Bình thường', HIGH: 'Cao', URGENT: 'Khẩn' };
export const PRIORITY_TONE: Record<TaskPriority, 'muted' | 'default' | 'warning' | 'danger'> = { LOW: 'muted', NORMAL: 'default', HIGH: 'warning', URGENT: 'danger' };
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  PLANNING: 'Lập kế hoạch',
  ACTIVE: 'Đang thực hiện',
  ON_HOLD: 'Tạm dừng',
  COMPLETED: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
};

/** Hành động: nhãn, kiểu nút, có cần lý do không. Khớp TRANSITIONS phía máy chủ. */
export const ACTION_META: Record<TaskAction, { label: string; variant: 'default' | 'outline' | 'danger' | 'success' | 'subtle'; reason?: 'required' | 'optional'; to: TaskStatus }> = {
  assign: { label: 'Giao việc', variant: 'default', to: 'ASSIGNED' },
  accept: { label: 'Nhận việc', variant: 'success', to: 'ACCEPTED' },
  decline: { label: 'Từ chối', variant: 'danger', reason: 'required', to: 'DECLINED' },
  start: { label: 'Bắt đầu làm', variant: 'default', to: 'IN_PROGRESS' },
  hold: { label: 'Tạm hoãn', variant: 'outline', reason: 'required', to: 'ON_HOLD' },
  submit: { label: 'Gửi duyệt kết quả', variant: 'default', to: 'SUBMITTED' },
  approve: { label: 'Duyệt hoàn thành', variant: 'success', reason: 'optional', to: 'DONE' },
  return: { label: 'Trả lại làm lại', variant: 'danger', reason: 'required', to: 'RETURNED' },
  cancel: { label: 'Hủy việc', variant: 'outline', reason: 'required', to: 'CANCELLED' },
  reopen: { label: 'Mở lại', variant: 'outline', reason: 'required', to: 'RETURNED' },
};

/** Cột Kanban → hành động khi kéo thả (giống actionForMove phía máy chủ). */
export const KANBAN_COLUMNS: Array<{ key: string; label: string; statuses: TaskStatus[]; drop?: TaskStatus }> = [
  { key: 'todo', label: 'Chờ nhận', statuses: ['DRAFT', 'ASSIGNED', 'DECLINED'], drop: 'ACCEPTED' },
  { key: 'doing', label: 'Đang làm', statuses: ['ACCEPTED', 'IN_PROGRESS', 'RETURNED'], drop: 'IN_PROGRESS' },
  { key: 'hold', label: 'Tạm hoãn', statuses: ['ON_HOLD'], drop: 'ON_HOLD' },
  { key: 'review', label: 'Chờ duyệt', statuses: ['SUBMITTED'], drop: 'SUBMITTED' },
  { key: 'done', label: 'Hoàn thành', statuses: ['DONE'], drop: 'DONE' },
];

export function actionForMove(from: TaskStatus, to: TaskStatus): TaskAction | null {
  if (from === to) return null;
  if (to === 'ACCEPTED' && from === 'ASSIGNED') return 'accept';
  if (to === 'IN_PROGRESS' && ['ACCEPTED', 'RETURNED', 'ON_HOLD'].includes(from)) return 'start';
  if (to === 'ON_HOLD' && ['ACCEPTED', 'IN_PROGRESS'].includes(from)) return 'hold';
  if (to === 'SUBMITTED' && ['ACCEPTED', 'IN_PROGRESS', 'RETURNED'].includes(from)) return 'submit';
  if (to === 'DONE' && from === 'SUBMITTED') return 'approve';
  if (to === 'RETURNED' && from === 'SUBMITTED') return 'return';
  return null;
}

/* ================================================================ Tiện ích */

export const TASK_FILE_ACCEPT =
  '.png,.jpg,.jpeg,.gif,.webp,.heic,.heif,.pdf,.txt,.csv,.md,.rtf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.zip,.rar,.7z';
export const TASK_FILE_MAX_MB = 15;

export async function filesToPayload(files: File[]): Promise<TaskFileInput[]> {
  const out: TaskFileInput[] = [];
  for (const f of files) {
    if (f.size > TASK_FILE_MAX_MB * 1024 * 1024) throw new Error(`Tệp "${f.name}" vượt ${TASK_FILE_MAX_MB}MB`);
    const buf = await f.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    out.push({ fileName: f.name, mimeType: f.type || undefined, contentBase64: btoa(binary) });
  }
  return out;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const vnDate = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' });
const vnDateTime = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const vnFull = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (v?: string | null) => (v ? vnDate.format(new Date(v.length === 10 ? `${v}T00:00:00+07:00` : v)) : '');
export const fmtDateTime = (v?: string | null) => (v ? vnFull.format(new Date(v)) : '');
export const fmtShort = (v?: string | null) => (v ? vnDateTime.format(new Date(v)) : '');

/** Mô tả thời hạn ngắn gọn: "Quá hạn 2 ngày", "Còn 5 giờ", "Hôm nay 17:00". */
export function dueText(dueAt: string | null, status: TaskStatus, now = Date.now()): { text: string; tone: 'danger' | 'warning' | 'muted' | 'success' | 'default' } {
  if (!dueAt) return { text: 'Không hạn', tone: 'muted' };
  const due = new Date(dueAt).getTime();
  if (status === 'DONE') return { text: `Hạn ${fmtShort(dueAt)}`, tone: 'success' };
  if (status === 'CANCELLED') return { text: `Hạn ${fmtShort(dueAt)}`, tone: 'muted' };
  const diff = due - now;
  const abs = Math.abs(diff);
  const h = Math.round(abs / 3600_000);
  const d = Math.round(abs / 86400_000);
  if (diff < 0) return { text: `Quá hạn ${abs < 86400_000 ? `${Math.max(1, h)} giờ` : `${d} ngày`}`, tone: 'danger' };
  if (diff < 86400_000) return { text: `Còn ${Math.max(1, h)} giờ`, tone: 'warning' };
  if (diff < 3 * 86400_000) return { text: `Còn ${d} ngày`, tone: 'warning' };
  return { text: `Hạn ${fmtDate(dueAt)}`, tone: 'default' };
}

/** Giá trị cho <input type="datetime-local"> theo giờ Việt Nam. */
export function toLocalInput(iso?: string | null): string {
  if (!iso) return '';
  return new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 16);
}
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  return new Date(`${v}:00+07:00`).toISOString();
}
export const todayVN = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

/* ================================================================ API */

export type TaskListQuery = Partial<Record<'view' | 'status' | 'priority' | 'departmentId' | 'projectId' | 'assigneeId' | 'label' | 'q' | 'due' | 'from' | 'to' | 'includeSubtasks' | 'sort' | 'page' | 'pageSize' | 'parentId', string>>;

export const tasksApi = {
  meta: () => apiFetch<TaskMeta>('/tasks/meta'),
  summary: () => apiFetch<TaskSummary>('/tasks/summary'),
  assignable: (q: { q?: string; departmentId?: number | string; projectId?: number | string } = {}) => apiFetch<AssignableUser[]>(`/tasks/assignable-users${qs(q)}`),
  list: (q: TaskListQuery) => apiFetch<{ items: TaskRow[]; total: number; page: number; pageSize: number }>(`/tasks${qs(q)}`),
  board: (q: TaskListQuery) => apiFetch<{ items: TaskRow[]; total: number; truncated: boolean }>(`/tasks/board${qs(q)}`),
  detail: (id: number) => apiFetch<TaskDetail>(`/tasks/${id}`),
  create: (body: TaskInput) => apiFetch<{ id: number; code: string; ids: number[] }>('/tasks', { method: 'POST', body }),
  update: (id: number, body: Partial<TaskInput> & { progress?: number }) => apiFetch<TaskDetail>(`/tasks/${id}`, { method: 'PUT', body }),
  remove: (id: number) => apiFetch<{ ok: true }>(`/tasks/${id}`, { method: 'DELETE' }),
  transition: (id: number, body: { action: TaskAction; reason?: string; resultContent?: string; files?: TaskFileInput[] }) =>
    apiFetch<TaskDetail>(`/tasks/${id}/transition`, { method: 'POST', body }),
  history: (id: number) => apiFetch<{ logs: TaskLog[]; audits: Array<{ id: number; action: string; description: string; fullName: string; createdAt: string }> }>(`/tasks/${id}/history`),
  comments: (id: number) => apiFetch<TaskComment[]>(`/tasks/${id}/comments`),
  addComment: (id: number, body: { content: string; files?: TaskFileInput[] }) => apiFetch<TaskComment>(`/tasks/${id}/comments`, { method: 'POST', body }),
  deleteComment: (id: number, commentId: number) => apiFetch(`/tasks/${id}/comments/${commentId}`, { method: 'DELETE' }),
  upload: (id: number, files: TaskFileInput[]) => apiFetch(`/tasks/${id}/attachments`, { method: 'POST', body: { files } }),
  attachmentUrl: (id: number, attachmentId: number) => `/api/tasks/${id}/attachments/${attachmentId}`,
  deleteAttachment: (id: number, attachmentId: number) => apiFetch(`/tasks/${id}/attachments/${attachmentId}`, { method: 'DELETE' }),
  worklogs: (id: number) => apiFetch<{ items: TaskWorklog[]; totalHours: number }>(`/tasks/${id}/worklogs`),
  addWorklog: (id: number, body: { workDate: string; hours: number; content: string; progress?: number }) => apiFetch(`/tasks/${id}/worklogs`, { method: 'POST', body }),
  deleteWorklog: (id: number, worklogId: number) => apiFetch(`/tasks/${id}/worklogs/${worklogId}`, { method: 'DELETE' }),
  addChecklist: (id: number, content: string) => apiFetch(`/tasks/${id}/checklist`, { method: 'POST', body: { content } }),
  updateChecklist: (id: number, itemId: number, body: { content?: string; done?: boolean }) => apiFetch(`/tasks/${id}/checklist/${itemId}`, { method: 'PATCH', body }),
  deleteChecklist: (id: number, itemId: number) => apiFetch(`/tasks/${id}/checklist/${itemId}`, { method: 'DELETE' }),
  setWatchers: (id: number, ids: number[]) => apiFetch(`/tasks/${id}/watchers`, { method: 'PUT', body: { ids } }),
  follow: (id: number, on: boolean) => apiFetch(`/tasks/${id}/follow`, { method: on ? 'POST' : 'DELETE' }),
  setDependencies: (id: number, ids: number[]) => apiFetch(`/tasks/${id}/dependencies`, { method: 'PUT', body: { ids } }),
  templates: () => apiFetch<TaskTemplate[]>('/tasks/templates'),
  saveTemplate: (id: number | null, body: Partial<Omit<TaskTemplate, 'estimateHours'>> & { name: string; estimateHours?: number | null }) =>
    apiFetch<TaskTemplate>(id ? `/tasks/templates/${id}` : '/tasks/templates', { method: id ? 'PUT' : 'POST', body }),
  deleteTemplate: (id: number) => apiFetch(`/tasks/templates/${id}`, { method: 'DELETE' }),
  projects: (q: { q?: string; status?: string; archived?: string } = {}) => apiFetch<ProjectRow[]>(`/tasks/projects${qs(q)}`),
  project: (id: number) => apiFetch<ProjectDetail>(`/tasks/projects/${id}`),
  createProject: (body: ProjectInput) => apiFetch<{ id: number; code: string }>('/tasks/projects', { method: 'POST', body }),
  updateProject: (id: number, body: Partial<ProjectInput>) => apiFetch<ProjectDetail>(`/tasks/projects/${id}`, { method: 'PUT', body }),
  setProjectMembers: (id: number, members: ProjectInput['members']) => apiFetch<ProjectDetail>(`/tasks/projects/${id}/members`, { method: 'PUT', body: { members } }),
  deleteProject: (id: number) => apiFetch(`/tasks/projects/${id}`, { method: 'DELETE' }),
  reportOverview: (q: ReportQuery) => apiFetch<ReportOverview>(`/tasks/reports/overview${qs({ ...q })}`),
  reportPerformance: (q: ReportQuery) => apiFetch<ReportPerformance>(`/tasks/reports/performance${qs({ ...q })}`),
  reportExportPath: (q: ReportQuery, format: 'xlsx' | 'csv' | 'docx' | 'json') => `/tasks/reports/export${qs({ ...q, format })}`,
};

export const taskKeys = {
  all: ['tasks'] as const,
  meta: ['tasks', 'meta'] as const,
  summary: ['tasks', 'summary'] as const,
  list: (q: unknown) => ['tasks', 'list', q] as const,
  board: (q: unknown) => ['tasks', 'board', q] as const,
  detail: (id: number) => ['tasks', 'detail', id] as const,
  comments: (id: number) => ['tasks', 'comments', id] as const,
  worklogs: (id: number) => ['tasks', 'worklogs', id] as const,
  history: (id: number) => ['tasks', 'history', id] as const,
  projects: (q: unknown) => ['tasks', 'projects', q] as const,
  project: (id: number) => ['tasks', 'project', id] as const,
  report: (kind: string, q: unknown) => ['tasks', 'report', kind, q] as const,
  templates: ['tasks', 'templates'] as const,
};

/* ================================================================ In ấn (mẫu in dùng nguồn SQL) */

export const TASK_PRINT_DOCS = {
  slip: 'CV_PHIEU_GIAO_VIEC',
  situation: 'CV_BAO_CAO_TINH_HINH',
  performance: 'CV_HIEU_SUAT_NHAN_VIEN',
} as const;

/** Tìm mẫu in đang áp dụng theo loại chứng từ rồi kết xuất PDF ở tab mới.
 *  Nếu mẫu (đã được quản trị sửa) khai báo thêm tham số bắt buộc chưa có giá trị → hỏi người dùng trước khi in. */
export async function printTaskDocument(docType: string, params: Record<string, unknown>, departmentId?: number | null): Promise<void> {
  let win = typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null;
  try {
    const found = await apiFetch<{ found: boolean; id?: number; name?: string; params?: PrintParamField[] }>(
      `/print/resolve/${encodeURIComponent(docType)}${departmentId ? `?departmentId=${departmentId}` : ''}`,
    );
    if (!found.found || !found.id) throw new Error('Chưa có mẫu in đang áp dụng cho loại chứng từ này (Quản trị → Thiết kế bản in)');
    let values = params;
    if (missingParams(found.params ?? [], params).length) {
      win?.close();
      win = null;
      const asked = await askPrintParams(found.name ?? docType, found.params ?? [], params);
      if (!asked) return;
      values = asked;
      win = window.open('about:blank', '_blank');
    }
    const res = await apiFetch<Response>(`/print/templates/${found.id}/render`, { method: 'POST', body: { params: values }, raw: true });
    const blob = await res.blob();
    if (blob.type && !blob.type.includes('pdf')) throw new Error(await blob.text());
    const url = URL.createObjectURL(blob);
    if (win) win.location.href = url;
    else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (err) {
    win?.close();
    throw err;
  }
}
