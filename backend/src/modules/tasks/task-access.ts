/**
 * Phạm vi truy cập phân hệ công việc dựa trên AccessContext.
 *
 * Trả về `null` = toàn viện; mảng = các khoa được phép; mảng rỗng = không có quyền theo khoa
 * (người dùng vẫn thao tác được các việc liên quan trực tiếp đến mình).
 */
import type { AccessContext } from '../../common/types/access-context';

export const TASK_PERMS = {
  assign: 'task.assign',
  manage: 'task.manage',
  report: 'task.report',
  export: 'task.export',
} as const;

export function hasPerm(user: AccessContext, code: string): boolean {
  return user.isSuperAdmin || user.permissions.includes(code);
}

/** Danh sách khoa mà quyền `code` có hiệu lực. */
export function deptScope(user: AccessContext, code: string): number[] | null {
  if (user.isSuperAdmin) return null;
  if (!user.permissions.includes(code)) return [];
  if (user.dataScope === 'ALL') return null;
  const set = new Set<number>(user.departmentIds);
  if (user.departmentId) set.add(user.departmentId);
  return [...set];
}

export function inScope(scope: number[] | null, departmentId: number | null | undefined): boolean {
  if (scope === null) return true;
  if (departmentId === null || departmentId === undefined) return false;
  return scope.includes(departmentId);
}

/** Phạm vi được XEM công việc theo khoa: hợp của quyền quản lý và quyền báo cáo. */
export function viewScope(user: AccessContext): number[] | null {
  const manage = deptScope(user, TASK_PERMS.manage);
  const report = deptScope(user, TASK_PERMS.report);
  if (manage === null || report === null) return null;
  return [...new Set([...manage, ...report])];
}
