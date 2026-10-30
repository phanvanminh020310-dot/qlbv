/**
 * Lớp lõi dùng chung cho phân hệ lịch khám: phạm vi quyền, nạp dữ liệu theo lô,
 * đánh giá ràng buộc theo cặp (ca khám × người), thông báo và nhật ký nghiệp vụ.
 */
import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { DbService, type Executor } from '../../db/db.service';
import {
  departments,
  dutyAbsences,
  dutyAssignments,
  dutyLogs,
  dutyPeriods,
  dutyRoles,
  dutyRooms,
  dutyShiftTypes,
  dutySlots,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
  type DutyPeriodStatus,
  type DutyRules,
} from '../../db/schema';
import type { AccessContext } from '../../common/types/access-context';
import { NotificationCenterService, type NotifyInput } from '../notifications/notification-center.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  addDays,
  evaluateCandidate,
  shiftInterval,
  type EngineAbsence,
  type EngineDuty,
  type EngineSlot,
  type EngineUser,
  type EvaluateResult,
} from './duty-rules';

/** Một cặp cần đánh giá: ca khám + người + ngữ cảnh kỳ (quy tắc, đã chốt chưa) */
export interface PairCtx {
  slot: EngineSlot;
  user: EngineUser;
  rules: DutyRules;
  locked: boolean;
  registrationBlocked?: string | null;
  /** Phân công trực tiếp được phép vượt chỉ tiêu người của ca khám; tự đăng ký thì không. */
  ignoreSlotCapacity?: boolean;
}

/** Dòng ca khám đã join đủ danh mục */
export type SlotRow = Awaited<ReturnType<DutyCoreService['loadSlots']>>[number];

const pushTo = <T>(map: Map<number | string, T[]>, key: number | string, value: T) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

@Injectable()
export class DutyCoreService {
  private readonly logger = new Logger(DutyCoreService.name);

  constructor(
    private readonly db: DbService,
    private readonly notifier: NotificationCenterService,
    private readonly realtime: RealtimeService,
  ) {}

  /* ------------------------------------------------------------ Quyền & phạm vi */

  hasPerm(u: AccessContext, code: string): boolean {
    return u.isSuperAdmin || u.permissions.includes(code);
  }

  /** Điều phối toàn viện: mọi phòng khám */
  isAll(u: AccessContext): boolean {
    return this.hasPerm(u, 'duty.manage-all');
  }

  scopeDeptIds(u: AccessContext): number[] {
    const ids = new Set<number>(u.departmentIds ?? []);
    if (u.departmentId) ids.add(u.departmentId);
    return [...ids];
  }

  /**
   * Vai trò xếp lịch của khoa có thể thao tác trên mọi phòng khám. Phạm vi
   * khoa chỉ dùng để giới hạn *nhân viên* được chọn/xếp, không dùng để khóa
   * theo khoa gắn trên phòng khám.
   */
  isDepartmentScheduler(u: AccessContext): boolean {
    // A dedicated scheduler role remains department-scoped even if another
    // inherited permission contains manage-all. Test/legacy all-hospital
    // coordinators may still carry dataScope=DEPT, so their explicit
    // manage-all permission wins when they do not hold the scheduler role.
    return u.roles.includes('NGUOI_XEP_LICH_TRUC_KHOA') || (u.dataScope === 'DEPT' && !this.isAll(u));
  }

  /** Người dùng có thể quản lý nhân viên thuộc khoa được giao không. */
  canManageDept(u: AccessContext, departmentId: number | null): boolean {
    if (this.isAll(u) && !this.isDepartmentScheduler(u)) return true;
    if (!departmentId) return false;
    return this.hasPerm(u, 'duty.manage') && this.scopeDeptIds(u).includes(departmentId);
  }

  /** Có quyền thao tác lập lịch, không phụ thuộc khoa gắn trên phòng. */
  canManageAny(u: AccessContext): boolean {
    return this.isAll(u) || this.hasPerm(u, 'duty.manage');
  }

  ensureManageSchedule(u: AccessContext, what = 'Thao tác lập lịch'): void {
    if (!this.canManageAny(u)) {
      throw new ForbiddenException(`${what} yêu cầu quyền xếp lịch khám`);
    }
  }

  /** Giữ tên hàm tương thích cho luồng duyệt nhân sự/nghỉ, không dùng cho phòng. */
  ensureManageDept(u: AccessContext, departmentId: number | null, what = 'Nhân viên này'): void {
    if (!this.canManageDept(u, departmentId)) {
      throw new ForbiddenException(`${what} nằm ngoài phạm vi khoa bạn được phân công quản lý lịch khám`);
    }
  }

  /* ------------------------------------------------------------ Kỳ lịch */

  async getPeriod(id: number, c: Executor = this.db.db) {
    const [row] = await c.select().from(dutyPeriods).where(eq(dutyPeriods.id, id)).limit(1);
    if (!row) throw new NotFoundException('Không tìm thấy kỳ lịch');
    return row;
  }

  /** NHAP: bản nháp · MO: đã công bố, còn điều chỉnh · CHOT: đã chốt (thủ công hoặc đến mốc chốt) */
  phaseOf(p: { status: string; lockAt: Date }, now = Date.now()): { phase: 'NHAP' | 'MO' | 'CHOT'; locked: boolean } {
    if (p.status === 'NHAP') return { phase: 'NHAP', locked: false };
    const locked = p.status === 'DA_CHOT' || p.lockAt.getTime() <= now;
    return { phase: locked ? 'CHOT' : 'MO', locked };
  }

  /** Người thường chỉ xem kỳ đã công bố; bản nháp chỉ người quản lý thấy */
  canSeePeriod(u: AccessContext, status: DutyPeriodStatus): boolean {
    return status !== 'NHAP' || this.canManageAny(u);
  }

  /* ------------------------------------------------------------ Ca khám */

  slotSelect() {
    return {
      id: dutySlots.id,
      periodId: dutySlots.periodId,
      dutyDate: dutySlots.dutyDate,
      roomId: dutySlots.roomId,
      shiftId: dutySlots.shiftId,
      roleId: dutySlots.roleId,
      requiredCount: dutySlots.requiredCount,
      note: dutySlots.note,
      filled: sql<number>`(select count(*)::int from duty_assignments a where a.slot_id = ${dutySlots.id})`,
      roomCode: dutyRooms.code,
      roomName: dutyRooms.name,
      roomDepartmentId: dutyRooms.departmentId,
      roomLocation: dutyRooms.location,
      roomSort: dutyRooms.sortOrder,
      shiftCode: dutyShiftTypes.code,
      shiftName: dutyShiftTypes.name,
      startTime: dutyShiftTypes.startTime,
      endTime: dutyShiftTypes.endTime,
      crossesMidnight: dutyShiftTypes.crossesMidnight,
      isNight: dutyShiftTypes.isNight,
      shiftColor: dutyShiftTypes.color,
      shiftSort: dutyShiftTypes.sortOrder,
      roleCode: dutyRoles.code,
      roleName: dutyRoles.name,
      requiredTitle: dutyRoles.requiredTitle,
      roleSort: dutyRoles.sortOrder,

      periodStatus: dutyPeriods.status,
      periodName: dutyPeriods.name,
      periodStart: dutyPeriods.startDate,
      periodEnd: dutyPeriods.endDate,
      lockAt: dutyPeriods.lockAt,
      registrationOpensAt: dutyPeriods.registrationOpensAt,
      rules: dutyPeriods.rules,
    };
  }

  async loadSlots(c: Executor, where?: SQL) {
    return c
      .select(this.slotSelect())
      .from(dutySlots)
      .innerJoin(dutyPeriods, eq(dutyPeriods.id, dutySlots.periodId))
      .innerJoin(dutyRooms, eq(dutyRooms.id, dutySlots.roomId))
      .innerJoin(dutyShiftTypes, eq(dutyShiftTypes.id, dutySlots.shiftId))
      .innerJoin(dutyRoles, eq(dutyRoles.id, dutySlots.roleId))
      .where(where)
      .orderBy(asc(dutySlots.dutyDate), asc(dutyRooms.sortOrder), asc(dutyRooms.code), asc(dutyShiftTypes.sortOrder), asc(dutyRoles.sortOrder), asc(dutySlots.id));
  }

  async getSlot(id: number, c: Executor = this.db.db): Promise<SlotRow> {
    const [row] = await this.loadSlots(c, eq(dutySlots.id, id));
    if (!row) throw new NotFoundException('Không tìm thấy ca khám');
    return row;
  }

  toEngineSlot(r: SlotRow): EngineSlot {
    const iv = shiftInterval(r.dutyDate, r.startTime, r.endTime, r.crossesMidnight);
    return {
      id: r.id,
      periodId: r.periodId,
      dutyDate: r.dutyDate,
      roomId: r.roomId,
      roomCode: r.roomCode,
      roomDepartmentId: r.roomDepartmentId,
      shiftCode: r.shiftCode,
      isNight: r.isNight,
      hours: iv.hours,
      start: iv.start,
      end: iv.end,
      roleName: r.roleName,
      requiredTitle: r.requiredTitle,
      requiredCount: r.requiredCount,
      filled: Number(r.filled) || 0,
    };
  }

  /* ------------------------------------------------------------ Nạp dữ liệu theo lô */

  async loadUsers(c: Executor, ids: number[]): Promise<Map<number, EngineUser & { fullName: string; departmentName: string }>> {
    const map = new Map<number, EngineUser & { fullName: string; departmentName: string }>();
    if (!ids.length) return map;
    const rows = await c
      .select({
        id: users.id,
        fullName: users.fullName,
        title: users.title,
        departmentId: users.departmentId,
        active: users.active,
        deletedAt: users.deletedAt,
        departmentName: departments.name,
      })
      .from(users)
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(inArray(users.id, ids));
    for (const r of rows) {
      map.set(r.id, {
        id: r.id,
        fullName: r.fullName,
        title: r.title ?? '',
        departmentId: r.departmentId,
        active: !!r.active && !r.deletedAt,
        departmentName: r.departmentName ?? '',
      });
    }
    return map;
  }

  /** Ca của các người dùng trong khoảng ngày (mọi kỳ), trừ các ca khám bị loại trừ */
  async loadDuties(c: Executor, userIds: number[], from: string, to: string, exclude: number[] = []) {
    const map = new Map<number, EngineDuty[]>();
    if (!userIds.length) return map;
    const rows = await c
      .select({
        userId: dutyAssignments.userId,
        slotId: dutySlots.id,
        dutyDate: dutySlots.dutyDate,
        roomCode: dutyRooms.code,
        shiftCode: dutyShiftTypes.code,
        startTime: dutyShiftTypes.startTime,
        endTime: dutyShiftTypes.endTime,
        crossesMidnight: dutyShiftTypes.crossesMidnight,
        isNight: dutyShiftTypes.isNight,
      })
      .from(dutyAssignments)
      .innerJoin(dutySlots, eq(dutySlots.id, dutyAssignments.slotId))
      .innerJoin(dutyRooms, eq(dutyRooms.id, dutySlots.roomId))
      .innerJoin(dutyShiftTypes, eq(dutyShiftTypes.id, dutySlots.shiftId))
      .where(and(inArray(dutyAssignments.userId, userIds), gte(dutySlots.dutyDate, from), lte(dutySlots.dutyDate, to)));
    for (const r of rows) {
      if (exclude.includes(r.slotId)) continue;
      const iv = shiftInterval(r.dutyDate, r.startTime, r.endTime, r.crossesMidnight);
      pushTo(map, r.userId, {
        slotId: r.slotId,
        dutyDate: r.dutyDate,
        start: iv.start,
        end: iv.end,
        isNight: r.isNight,
        hours: iv.hours,
        roomCode: r.roomCode,
        shiftCode: r.shiftCode,
      });
    }
    return map;
  }

  async loadAbsences(c: Executor, userIds: number[], from: string, to: string) {
    const map = new Map<number, EngineAbsence[]>();
    if (!userIds.length) return map;
    const rows = await c
      .select({
        userId: dutyAbsences.userId,
        startDate: dutyAbsences.startDate,
        endDate: dutyAbsences.endDate,
        reason: dutyAbsences.reason,
      })
      .from(dutyAbsences)
      .where(and(inArray(dutyAbsences.userId, userIds), lte(dutyAbsences.startDate, to), gte(dutyAbsences.endDate, from)));
    for (const r of rows) pushTo(map, r.userId, { startDate: r.startDate, endDate: r.endDate, reason: r.reason });
    return map;
  }

  /**
   * Số ca / ca đêm khác nhau đã có trong từng kỳ của người dùng (không kể ca
   * loại trừ). Cùng một ca của một ngày tại nhiều phòng là một ca vận hành,
   * nên chỉ được tính một lần vào giới hạn theo kỳ.
   */
  async loadPeriodCounts(c: Executor, periodIds: number[], userIds: number[], exclude: number[] = []) {
    const map = new Map<string, { shifts: number; nights: number }>();
    if (!periodIds.length || !userIds.length) return map;
    const rows = await c
      .select({
        userId: dutyAssignments.userId,
        periodId: dutySlots.periodId,
        slotId: dutySlots.id,
        dutyDate: dutySlots.dutyDate,
        shiftId: dutySlots.shiftId,
        isNight: dutyShiftTypes.isNight,
      })
      .from(dutyAssignments)
      .innerJoin(dutySlots, eq(dutySlots.id, dutyAssignments.slotId))
      .innerJoin(dutyShiftTypes, eq(dutyShiftTypes.id, dutySlots.shiftId))
      .where(and(inArray(dutySlots.periodId, periodIds), inArray(dutyAssignments.userId, userIds)));
    const seenShiftOccurrences = new Set<string>();
    for (const r of rows) {
      if (exclude.includes(r.slotId)) continue;
      const occurrence = `${r.periodId}:${r.userId}:${r.dutyDate}:${r.shiftId}`;
      if (seenShiftOccurrences.has(occurrence)) continue;
      seenShiftOccurrences.add(occurrence);
      const key = `${r.periodId}:${r.userId}`;
      const cur = map.get(key) ?? { shifts: 0, nights: 0 };
      cur.shifts += 1;
      if (r.isNight) cur.nights += 1;
      map.set(key, cur);
    }
    return map;
  }

  async loadAssignedSet(c: Executor, slotIds: number[], userIds: number[]): Promise<Set<string>> {
    const set = new Set<string>();
    if (!slotIds.length || !userIds.length) return set;
    const rows = await c
      .select({ slotId: dutyAssignments.slotId, userId: dutyAssignments.userId })
      .from(dutyAssignments)
      .where(and(inArray(dutyAssignments.slotId, slotIds), inArray(dutyAssignments.userId, userIds)));
    for (const r of rows) set.add(`${r.slotId}:${r.userId}`);
    return set;
  }

  /**
   * Đánh giá hàng loạt các cặp (ca khám × nhân sự). Khoá kết quả: `${slotId}:${userId}`.
   * `excludeSlotIds`: các ca của người này sẽ bị gỡ trong cùng thao tác (đổi/nhường ca).
   */
  async evaluatePairs(c: Executor, pairs: PairCtx[], opts: { excludeSlotIds?: number[]; now?: number } = {}) {
    const out = new Map<string, EvaluateResult>();
    if (!pairs.length) return out;
    const now = opts.now ?? Date.now();
    const exclude = opts.excludeSlotIds ?? [];
    const userIds = [...new Set(pairs.map((p) => p.user.id))];
    const dates = pairs.map((p) => p.slot.dutyDate).sort();
    const from = dates[0];
    const to = dates[dates.length - 1];
    const periodIds = [...new Set(pairs.map((p) => p.slot.periodId))];
    const slotIds = [...new Set(pairs.map((p) => p.slot.id))];

    const duties = await this.loadDuties(c, userIds, addDays(from, -7), addDays(to, 7), exclude);
    // Load the following day as well: an overnight slot can overlap its absence.
    const absences = await this.loadAbsences(c, userIds, from, addDays(to, 1));
    const counts = await this.loadPeriodCounts(c, periodIds, userIds, exclude);
    const assigned = await this.loadAssignedSet(c, slotIds, userIds);

    for (const p of pairs) {
      const key = `${p.slot.id}:${p.user.id}`;
      const cnt = counts.get(`${p.slot.periodId}:${p.user.id}`);
      out.set(
        key,
        evaluateCandidate({
          slot: p.slot,
          user: p.user,
          rules: p.rules,
          duties: duties.get(p.user.id) ?? [],
          absences: absences.get(p.user.id) ?? [],
          periodShifts: cnt?.shifts ?? 0,
          periodNights: cnt?.nights ?? 0,
          alreadyInSlot: assigned.has(key),
          now,
          locked: p.locked,
          registrationBlocked: p.registrationBlocked ?? null,
          ignoreSlotCapacity: !!p.ignoreSlotCapacity,
        }),
      );
    }
    return out;
  }

  /** Ghép dữ liệu thành PairCtx cho một ca khám (dùng cho nhiều người) */
  pairsFor(
    slotRow: SlotRow,
    users: EngineUser[],
    opts: {
      filledDelta?: number;
      registrationBlocked?: string | null;
      ignoreRoomDepartment?: boolean;
      ignoreSlotCapacity?: boolean;
    } = {},
  ): PairCtx[] {
    const slot = this.toEngineSlot(slotRow);
    // Người xếp lịch khoa được điều phối nhân sự khoa mình tại mọi phòng. Chỉ
    // bỏ kiểm tra khoa-phòng ở ngữ cảnh đó; tất cả ràng buộc an toàn khác giữ nguyên.
    if (opts.ignoreRoomDepartment) slot.roomDepartmentId = null;
    if (opts.filledDelta) slot.filled = Math.max(0, slot.filled + opts.filledDelta);
    const { locked } = this.phaseOf({ status: slotRow.periodStatus, lockAt: slotRow.lockAt });
    return users.map((user) => ({
      slot,
      user,
      rules: slotRow.rules,
      locked,
      registrationBlocked: opts.registrationBlocked ?? null,
      ignoreSlotCapacity: !!opts.ignoreSlotCapacity,
    }));
  }

  /* ------------------------------------------------------------ Vai trò người nhận thông báo */

  /** Người đang giữ một trong các quyền (kể cả SUPER_ADMIN) và còn hoạt động */
  async holderIds(permCodes: string[]): Promise<number[]> {
    const rows = await this.db.db
      .selectDistinct({ id: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(users, eq(users.id, userRoles.userId))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(
        and(
          eq(users.active, true),
          isNull(users.deletedAt),
          or(inArray(permissions.code, permCodes), eq(roles.code, 'SUPER_ADMIN')),
        ),
      );
    return rows.map((r) => r.id);
  }

  /** Gửi thông báo sau khi giao dịch đã commit — lỗi thông báo không làm hỏng nghiệp vụ */
  notifyAfterCommit(userIds: Array<number | null | undefined>, input: NotifyInput): void {
    const ids = [...new Set(userIds.filter((x): x is number => typeof x === 'number' && x > 0))];
    if (!ids.length) return;
    void this.notifier.notify(ids, input).catch((e) => this.logger.warn(`Gửi thông báo lịch khám lỗi: ${(e as Error).message}`));
  }

  /* ------------------------------------------------------------ Nhật ký & realtime */

  async log(
    c: Executor,
    e: {
      periodId?: number | null;
      slotId?: number | null;
      requestId?: number | null;
      action: string;
      actorId?: number | null;
      userId?: number | null;
      reason?: string;
      detail?: Record<string, unknown>;
    },
  ): Promise<void> {
    await c.insert(dutyLogs).values({
      periodId: e.periodId ?? null,
      slotId: e.slotId ?? null,
      requestId: e.requestId ?? null,
      action: e.action,
      actorId: e.actorId ?? null,
      userId: e.userId ?? null,
      reason: e.reason ?? '',
      detail: e.detail ?? {},
    });
  }

  emit(type: string, periodId?: number | null): void {
    try {
      this.realtime.publish({ topic: 'duty', type, permission: 'duty.view', data: { periodId: periodId ?? null } });
    } catch {
      /* realtime là tiện ích — không làm hỏng thao tác */
    }
  }
}
