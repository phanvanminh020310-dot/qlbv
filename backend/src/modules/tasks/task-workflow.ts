/**
 * MÁY TRẠNG THÁI CÔNG VIỆC — thuần logic, không phụ thuộc CSDL để kiểm thử độc lập.
 *
 *  Nháp → Đã giao → Đã nhận → Đang làm → Chờ duyệt → Hoàn thành
 *                 ↘ Từ chối        ↘ Tạm hoãn   ↘ Trả lại (làm lại)
 *  Mọi trạng thái chưa kết thúc → Đã hủy;  Hoàn thành/Đã hủy → (Mở lại) → Trả lại
 */
import type { TaskPriority, TaskStatus } from '../../db/schema/tasks';

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  DRAFT: 'Nháp',
  ASSIGNED: 'Chờ nhận',
  ACCEPTED: 'Đã nhận',
  IN_PROGRESS: 'Đang làm',
  ON_HOLD: 'Tạm hoãn',
  SUBMITTED: 'Chờ duyệt',
  RETURNED: 'Trả lại',
  DONE: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
  DECLINED: 'Từ chối',
};

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: 'Thấp',
  NORMAL: 'Bình thường',
  HIGH: 'Cao',
  URGENT: 'Khẩn',
};

/** Trạng thái đã kết thúc — không còn tính là việc đang mở. */
export const FINAL_STATUSES: TaskStatus[] = ['DONE', 'CANCELLED'];
/** Trạng thái đang mở (tính vào khối lượng, quá hạn). */
export const OPEN_STATUSES: TaskStatus[] = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'ON_HOLD', 'SUBMITTED', 'RETURNED', 'DECLINED'];

export const TASK_ACTIONS = [
  'assign',
  'accept',
  'decline',
  'start',
  'hold',
  'submit',
  'approve',
  'return',
  'cancel',
  'reopen',
] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];

/** Ai được thực hiện: người thực hiện, người quản lý (giao/duyệt/quản lý khoa) hoặc cả hai. */
type Actor = 'assignee' | 'manager' | 'either';

export interface TransitionRule {
  from: TaskStatus[];
  to: TaskStatus;
  actor: Actor;
  reasonRequired: boolean;
  label: string;
  /** Câu mô tả cho nhật ký/thông báo */
  verb: string;
}

export const TRANSITIONS: Record<TaskAction, TransitionRule> = {
  assign: { from: ['DRAFT', 'DECLINED'], to: 'ASSIGNED', actor: 'manager', reasonRequired: false, label: 'Giao việc', verb: 'đã giao việc' },
  accept: { from: ['ASSIGNED'], to: 'ACCEPTED', actor: 'assignee', reasonRequired: false, label: 'Nhận việc', verb: 'đã nhận việc' },
  decline: { from: ['ASSIGNED'], to: 'DECLINED', actor: 'assignee', reasonRequired: true, label: 'Từ chối', verb: 'đã từ chối nhận việc' },
  start: { from: ['ACCEPTED', 'RETURNED', 'ON_HOLD'], to: 'IN_PROGRESS', actor: 'assignee', reasonRequired: false, label: 'Bắt đầu làm', verb: 'đã bắt đầu thực hiện' },
  hold: { from: ['ACCEPTED', 'IN_PROGRESS'], to: 'ON_HOLD', actor: 'either', reasonRequired: true, label: 'Tạm hoãn', verb: 'đã tạm hoãn' },
  submit: { from: ['ACCEPTED', 'IN_PROGRESS', 'RETURNED'], to: 'SUBMITTED', actor: 'assignee', reasonRequired: false, label: 'Gửi duyệt', verb: 'đã gửi kết quả chờ duyệt' },
  approve: { from: ['SUBMITTED'], to: 'DONE', actor: 'manager', reasonRequired: false, label: 'Duyệt hoàn thành', verb: 'đã duyệt hoàn thành' },
  return: { from: ['SUBMITTED'], to: 'RETURNED', actor: 'manager', reasonRequired: true, label: 'Trả lại', verb: 'đã trả lại yêu cầu làm lại' },
  cancel: { from: ['DRAFT', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'ON_HOLD', 'SUBMITTED', 'RETURNED', 'DECLINED'], to: 'CANCELLED', actor: 'manager', reasonRequired: true, label: 'Hủy công việc', verb: 'đã hủy công việc' },
  reopen: { from: ['DONE', 'CANCELLED'], to: 'RETURNED', actor: 'manager', reasonRequired: true, label: 'Mở lại', verb: 'đã mở lại công việc' },
};

/** Vai trò của một người dùng đối với một công việc cụ thể. */
export interface TaskActorRoles {
  isAssignee: boolean;
  isAssigner: boolean;
  isReviewer: boolean;
  /** Có quyền task.manage trong phạm vi khoa của công việc (hoặc quản trị tối cao) */
  managesScope: boolean;
  /** Quản lý dự án chứa công việc (chủ dự án hoặc thành viên vai trò MANAGER) */
  isProjectManager: boolean;
}

export interface TaskPeople {
  assigneeId: number | null;
  assignerId: number | null;
  reviewerId: number | null;
}

/** Người có quyền điều hành công việc: giao, duyệt, sửa, hủy. */
export function isTaskManager(roles: TaskActorRoles): boolean {
  return roles.isAssigner || roles.isReviewer || roles.managesScope || roles.isProjectManager;
}

/**
 * Người thực hiện không được tự duyệt việc của mình — trừ khi chính họ vừa giao
 * vừa duyệt (việc cá nhân tự đặt cho mình).
 */
export function canSelfApprove(people: TaskPeople): boolean {
  const { assigneeId, assignerId, reviewerId } = people;
  if (!assigneeId) return false;
  return assigneeId === (reviewerId ?? assignerId) && (assignerId === null || assignerId === assigneeId);
}

/** Kiểm tra quyền của một thao tác (chưa xét điều kiện dữ liệu như việc con, phụ thuộc). */
export function canPerform(action: TaskAction, status: TaskStatus, roles: TaskActorRoles, people: TaskPeople): boolean {
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(status)) return false;
  const manager = isTaskManager(roles);
  if (action === 'approve' || action === 'return') {
    if (!manager) return false;
    // Người thực hiện không tự duyệt/trả lại kết quả của chính mình
    if (roles.isAssignee && !canSelfApprove(people)) return false;
    return true;
  }
  if (action === 'assign') return manager && !!people.assigneeId;
  switch (rule.actor) {
    case 'assignee':
      return roles.isAssignee;
    case 'manager':
      return manager;
    default:
      return roles.isAssignee || manager;
  }
}

/** Danh sách thao tác người dùng được phép làm ở trạng thái hiện tại. */
export function allowedActions(status: TaskStatus, roles: TaskActorRoles, people: TaskPeople): TaskAction[] {
  return TASK_ACTIONS.filter((action) => canPerform(action, status, roles, people));
}

/**
 * Kéo thả trên Kanban: tìm thao tác nghiệp vụ tương ứng khi thả từ cột `from` sang cột `to`.
 * Trả về null nếu không có đường chuyển hợp lệ.
 */
export function actionForMove(from: TaskStatus, to: TaskStatus): TaskAction | null {
  if (from === to) return null;
  for (const action of TASK_ACTIONS) {
    const rule = TRANSITIONS[action];
    if (rule.to === to && rule.from.includes(from)) return action;
  }
  return null;
}

/** Tính hạn chót kế tiếp cho việc lặp lại. */
export function nextOccurrence(base: Date, freq: 'DAILY' | 'WEEKLY' | 'MONTHLY', interval: number): Date {
  const step = Math.max(1, Math.min(365, Math.floor(interval) || 1));
  const next = new Date(base.getTime());
  if (freq === 'DAILY') next.setUTCDate(next.getUTCDate() + step);
  else if (freq === 'WEEKLY') next.setUTCDate(next.getUTCDate() + 7 * step);
  else {
    const day = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + step);
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(day, lastDay));
  }
  return next;
}

/** Điểm hiệu suất 0–100 = 50% đúng hạn + 30% hoàn thành + 20% (1 − tỷ lệ trả lại). */
export function performanceScore(input: { onTimeRate: number | null; completionRate: number | null; returnRate: number | null }): number | null {
  const { onTimeRate, completionRate, returnRate } = input;
  if (completionRate === null) return null;
  const onTime = onTimeRate ?? completionRate;
  const ret = returnRate ?? 0;
  const score = 50 * onTime + 30 * completionRate + 20 * (1 - ret);
  return Math.round(Math.max(0, Math.min(100, score)) * 10) / 10;
}

/* ------------------------------------------------------------------ Tệp đính kèm */

/** Đuôi tệp được phép → các MIME chấp nhận (trình duyệt có thể báo MIME khác nhau). */
export const TASK_FILE_TYPES: Record<string, { mime: string; magic?: 'png' | 'jpeg' | 'gif' | 'webp' | 'pdf' | 'zip' | 'ole' | 'rar' | '7z' | 'ftyp' | 'text' }> = {
  '.png': { mime: 'image/png', magic: 'png' },
  '.jpg': { mime: 'image/jpeg', magic: 'jpeg' },
  '.jpeg': { mime: 'image/jpeg', magic: 'jpeg' },
  '.gif': { mime: 'image/gif', magic: 'gif' },
  '.webp': { mime: 'image/webp', magic: 'webp' },
  '.heic': { mime: 'image/heic', magic: 'ftyp' },
  '.heif': { mime: 'image/heif', magic: 'ftyp' },
  '.pdf': { mime: 'application/pdf', magic: 'pdf' },
  '.txt': { mime: 'text/plain', magic: 'text' },
  '.csv': { mime: 'text/csv', magic: 'text' },
  '.md': { mime: 'text/markdown', magic: 'text' },
  '.rtf': { mime: 'application/rtf', magic: 'text' },
  '.doc': { mime: 'application/msword', magic: 'ole' },
  '.xls': { mime: 'application/vnd.ms-excel', magic: 'ole' },
  '.ppt': { mime: 'application/vnd.ms-powerpoint', magic: 'ole' },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: 'zip' },
  '.xlsx': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: 'zip' },
  '.pptx': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', magic: 'zip' },
  '.odt': { mime: 'application/vnd.oasis.opendocument.text', magic: 'zip' },
  '.ods': { mime: 'application/vnd.oasis.opendocument.spreadsheet', magic: 'zip' },
  '.odp': { mime: 'application/vnd.oasis.opendocument.presentation', magic: 'zip' },
  '.zip': { mime: 'application/zip', magic: 'zip' },
  '.rar': { mime: 'application/vnd.rar', magic: 'rar' },
  '.7z': { mime: 'application/x-7z-compressed', magic: '7z' },
};

export const TASK_FILE_MAX_BYTES = 15 * 1024 * 1024;
export const TASK_FILES_PER_REQUEST = 10;

/** Kiểm tra chữ ký đầu tệp khớp đuôi tệp — chống đổi đuôi tệp thực thi. */
export function fileSignatureMatches(ext: string, buffer: Buffer): boolean {
  const spec = TASK_FILE_TYPES[ext];
  if (!spec) return false;
  const hex = buffer.subarray(0, 8).toString('hex');
  const ascii = buffer.subarray(0, 12).toString('latin1');
  switch (spec.magic) {
    case 'png': return hex.startsWith('89504e470d0a1a0a');
    case 'jpeg': return hex.startsWith('ffd8ff');
    case 'gif': return ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a');
    case 'webp': return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
    case 'ftyp': return ascii.slice(4, 8) === 'ftyp';
    case 'pdf': return ascii.startsWith('%PDF');
    case 'zip': return hex.startsWith('504b0304') || hex.startsWith('504b0506');
    case 'ole': return hex.startsWith('d0cf11e0a1b11ae1');
    case 'rar': return ascii.startsWith('Rar!');
    case '7z': return hex.startsWith('377abcaf271c');
    case 'text': {
      // Tệp văn bản không chứa byte NUL và không phải tệp thực thi MZ/ELF
      const head = buffer.subarray(0, 4096);
      if (head.includes(0)) return false;
      return !(ascii.startsWith('MZ') || hex.startsWith('7f454c46'));
    }
    default: return false;
  }
}
