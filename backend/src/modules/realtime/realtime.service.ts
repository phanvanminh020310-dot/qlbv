import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject, filter } from 'rxjs';
import type { AccessContext } from '../../common/types/access-context';

/**
 * Sự kiện realtime phát tới trình duyệt qua SSE.
 *
 * Phân phối theo "khán giả":
 *  - `userIds`     : chỉ những người dùng cụ thể (ví dụ thông báo cá nhân).
 *  - `permission`  : người dùng có quyền đó; kèm `departmentId` thì người bị
 *                    giới hạn phạm vi chỉ nhận sự kiện thuộc khoa mình.
 *  - không gì cả   : mọi kết nối (chỉ dùng cho sự kiện hệ thống vô danh).
 */
export interface RealtimeEvent {
  topic: string;
  type: string;
  at: string;
  departmentId?: number | null;
  userIds?: number[];
  permission?: string;
  data?: Record<string, unknown>;
}

/** Số kết nối SSE tối đa cho một người dùng (chống mở quá nhiều tab). */
const MAX_CONN_PER_USER = 6;

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger('Realtime');
  private readonly events$ = new Subject<RealtimeEvent>();
  private readonly connections = new Map<number, number>();

  /** Gọi từ các service nghiệp vụ sau khi thay đổi dữ liệu thành công. */
  publish(event: Omit<RealtimeEvent, 'at'>): void {
    this.events$.next({ ...event, at: new Date().toISOString() });
  }

  /** Kiểm tra một kết nối mới có được phép mở không. */
  tryAcquire(userId: number): boolean {
    const current = this.connections.get(userId) ?? 0;
    if (current >= MAX_CONN_PER_USER) return false;
    this.connections.set(userId, current + 1);
    return true;
  }

  release(userId: number): void {
    const current = this.connections.get(userId) ?? 0;
    if (current <= 1) this.connections.delete(userId);
    else this.connections.set(userId, current - 1);
  }

  /** Luồng toàn bộ sự kiện hệ thống (dùng cho các module tích hợp như Kiosk). */
  streamAll(): Observable<RealtimeEvent> {
    return this.events$.asObservable();
  }

  /** Luồng sự kiện đã lọc theo quyền của người dùng. */
  streamFor(user: AccessContext): Observable<RealtimeEvent> {
    return this.events$.pipe(filter((event) => this.match(user, event)));
  }

  private match(user: AccessContext, event: RealtimeEvent): boolean {
    if (event.userIds?.length) return event.userIds.includes(user.id);
    if (user.isSuperAdmin) return true;
    if (event.permission && !user.permissions.includes(event.permission)) return false;
    const scoped = user.dataScope !== 'ALL';
    if (event.departmentId != null && scoped) {
      return user.departmentIds.includes(event.departmentId) || user.departmentId === event.departmentId;
    }
    return true;
  }

  stats(): { users: number; connections: number } {
    let connections = 0;
    for (const count of this.connections.values()) connections += count;
    return { users: this.connections.size, connections };
  }
}
