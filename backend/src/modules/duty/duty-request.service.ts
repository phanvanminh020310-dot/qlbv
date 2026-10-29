import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { alias } from 'drizzle-orm/pg-core';
import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { DbService, type Tx } from '../../db/db.service';
import {
  dutyAssignments,
  dutyPeriods,
  dutyRequests,
  dutyRoles,
  dutyRooms,
  dutyShiftTypes,
  dutySlots,
  users,
  type DutyRequestStatus,
  type DutyRequestType,
} from '../../db/schema';
import type { AccessContext } from '../../common/types/access-context';
import { DutyCoreService } from './duty-core.service';
import { DutyService } from './duty.service';
import { fmtDate, violationText, type EvaluateResult } from './duty-rules';
import type { OverrideDto, RequestCreateDto, RequestQueryDto, RequestRespondDto } from './duty.dto';

const ADVISORY_NS = 9301;
const SWAP_TYPES: DutyRequestType[] = ['NHUONG', 'DOI'];
const OPEN_STATUSES: DutyRequestStatus[] = ['CHO_NGUOI_NHAN', 'CHO_DUYET'];

/** Khóa ca khám và khóa người theo thứ tự cố định để tránh deadlock */
async function lockAll(tx: Tx, slotIds: number[], userIds: number[]) {
  for (const id of [...new Set(slotIds)].sort((a, b) => a - b)) {
    await tx.execute(sql`select id from duty_slots where id = ${id} for update`);
  }
  for (const id of [...new Set(userIds)].sort((a, b) => a - b)) {
    await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_NS}, ${id})`);
  }
}

@Injectable()
export class DutyRequestService {
  constructor(
    private readonly db: DbService,
    private readonly core: DutyCoreService,
    private readonly duty: DutyService,
  ) {}

  /**
   * Duyệt đổi/nhường theo khoa của nhân sự yêu cầu, không theo khoa gắn trên
   * phòng. Phòng khám là tài nguyên dùng chung trong luồng xếp lịch.
   */
  canApproveSwap(u: AccessContext, staffDepartmentId: number | null): boolean {
    if (this.core.isAll(u) && !this.core.isDepartmentScheduler(u)) return true;
    return this.core.hasPerm(u, 'duty.swap.approve') && this.core.canManageDept(u, staffDepartmentId);
  }

  private async getRequest(id: number, c: DbService['db'] | Tx = this.db.db) {
    const [row] = await c.select().from(dutyRequests).where(eq(dutyRequests.id, id)).limit(1);
    if (!row) throw new NotFoundException('Không tìm thấy yêu cầu');
    return row;
  }

  private async assignmentOf(slotId: number, userId: number, c: DbService['db'] | Tx = this.db.db) {
    const [row] = await c
      .select()
      .from(dutyAssignments)
      .where(and(eq(dutyAssignments.slotId, slotId), eq(dutyAssignments.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  /** Kiểm tra một người có thể nhận ca khám (sau khi người khác rời ô / gỡ ca khác) */
  private async checkMove(
    tx: Tx | DbService['db'],
    slotId: number,
    userId: number,
    opts: { filledDelta?: number; exclude?: number[]; locked?: boolean } = {},
  ): Promise<EvaluateResult> {
    const slot = await this.core.getSlot(slotId, tx);
    const u = (await this.core.loadUsers(tx, [userId])).get(userId);
    if (!u) throw new NotFoundException('Không tìm thấy nhân viên');
    const pairs = this.core.pairsFor(slot, [u], { filledDelta: opts.filledDelta ?? 0 }).map((p) => ({
      ...p,
      locked: opts.locked ?? p.locked,
    }));
    const res = (await this.core.evaluatePairs(tx, pairs, { excludeSlotIds: opts.exclude ?? [] })).get(`${slotId}:${userId}`);
    return res as EvaluateResult;
  }

  /* ================================================================ Danh sách */

  async list(user: AccessContext, q: RequestQueryDto) {
    const me = user.id;
    const canExc = this.core.hasPerm(user, 'duty.exception.resolve');
    const canSwap = this.core.hasPerm(user, 'duty.swap.approve') || this.core.isAll(user);
    const conds: SQL[] = [];
    const box = q.box ?? 'mine';
    if (box === 'mine') conds.push(eq(dutyRequests.requesterId, me));
    else if (box === 'incoming') conds.push(and(eq(dutyRequests.targetUserId, me), eq(dutyRequests.status, 'CHO_NGUOI_NHAN')) as SQL);
    else if (box === 'approval') {
      const parts: SQL[] = [];
      if (canExc) parts.push(and(eq(dutyRequests.type, 'NGOAI_LE'), eq(dutyRequests.status, 'CHO_DUYET')) as SQL);
      if (canSwap) parts.push(and(inArray(dutyRequests.type, SWAP_TYPES), eq(dutyRequests.status, 'CHO_DUYET')) as SQL);
      if (!parts.length) return [];
      conds.push(or(...parts) as SQL);
    } else if (!canExc && !this.core.isAll(user)) {
      // "Tất cả": người thường chỉ thấy yêu cầu liên quan tới mình
      conds.push(or(eq(dutyRequests.requesterId, me), eq(dutyRequests.targetUserId, me)) as SQL);
    }
    if (q.status) conds.push(eq(dutyRequests.status, q.status as DutyRequestStatus));
    if (q.periodId) conds.push(eq(dutyRequests.periodId, q.periodId));

    const requester = alias(users, 'rq_user');
    const target = alias(users, 'tg_user');
    const repl = alias(users, 'rp_user');
    const slotA = alias(dutySlots, 'slot_a');
    const roomA = alias(dutyRooms, 'room_a');
    const shiftA = alias(dutyShiftTypes, 'shift_a');
    const roleA = alias(dutyRoles, 'role_a');
    const slotB = alias(dutySlots, 'slot_b');
    const roomB = alias(dutyRooms, 'room_b');
    const shiftB = alias(dutyShiftTypes, 'shift_b');

    const rows = await this.db.db
      .select({
        id: dutyRequests.id,
        periodId: dutyRequests.periodId,
        periodName: dutyPeriods.name,
        periodStatus: dutyPeriods.status,
        lockAt: dutyPeriods.lockAt,
        type: dutyRequests.type,
        status: dutyRequests.status,
        urgent: dutyRequests.urgent,
        reason: dutyRequests.reason,
        responseNote: dutyRequests.responseNote,
        requesterId: dutyRequests.requesterId,
        requesterName: requester.fullName,
        requesterDepartmentId: requester.departmentId,
        targetUserId: dutyRequests.targetUserId,
        targetName: target.fullName,
        replacementUserId: dutyRequests.replacementUserId,
        replacementName: repl.fullName,
        slotId: dutyRequests.slotId,
        slotDate: slotA.dutyDate,
        roomCode: roomA.code,
        roomDepartmentId: roomA.departmentId,
        shiftCode: shiftA.code,
        roleName: roleA.name,
        targetSlotId: dutyRequests.targetSlotId,
        targetSlotDate: slotB.dutyDate,
        targetRoomCode: roomB.code,
        targetShiftCode: shiftB.code,
        createdAt: dutyRequests.createdAt,
        targetRespondedAt: dutyRequests.targetRespondedAt,
        resolvedAt: dutyRequests.resolvedAt,
      })
      .from(dutyRequests)
      .innerJoin(dutyPeriods, eq(dutyPeriods.id, dutyRequests.periodId))
      .innerJoin(requester, eq(requester.id, dutyRequests.requesterId))
      .innerJoin(slotA, eq(slotA.id, dutyRequests.slotId))
      .innerJoin(roomA, eq(roomA.id, slotA.roomId))
      .innerJoin(shiftA, eq(shiftA.id, slotA.shiftId))
      .innerJoin(roleA, eq(roleA.id, slotA.roleId))
      .leftJoin(target, eq(target.id, dutyRequests.targetUserId))
      .leftJoin(repl, eq(repl.id, dutyRequests.replacementUserId))
      .leftJoin(slotB, eq(slotB.id, dutyRequests.targetSlotId))
      .leftJoin(roomB, eq(roomB.id, slotB.roomId))
      .leftJoin(shiftB, eq(shiftB.id, slotB.shiftId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(dutyRequests.urgent), desc(dutyRequests.createdAt))
      .limit(300);

    return rows
      .map((r) => {
        const open = OPEN_STATUSES.includes(r.status);
        const isSwap = SWAP_TYPES.includes(r.type);
        const scopeOk = isSwap ? this.canApproveSwap(user, r.requesterDepartmentId) : canExc;
        const pendingForTarget = r.status === 'CHO_NGUOI_NHAN' && r.targetUserId === me;
        return {
          ...r,
          lockedNow: this.core.phaseOf({ status: r.periodStatus, lockAt: r.lockAt }).locked,
          actions: {
            canCancel: open && r.requesterId === me,
            canAccept: pendingForTarget && isSwap,
            canDecline: pendingForTarget && isSwap,
            canApprove: r.status === 'CHO_DUYET' && scopeOk,
            canReject: r.status === 'CHO_DUYET' && scopeOk,
          },
        };
      })
      .filter((r) => box !== 'approval' || r.actions.canApprove);
  }

  /* ================================================================ Tạo yêu cầu */

  async create(user: AccessContext, dto: RequestCreateDto) {
    const slot = await this.core.getSlot(dto.slotId);
    if (slot.periodStatus === 'NHAP') throw new ConflictException('Kỳ lịch chưa được công bố');
    const { locked } = this.core.phaseOf({ status: slot.periodStatus, lockAt: slot.lockAt });
    if (this.core.toEngineSlot(slot).start <= Date.now()) throw new ConflictException('Ca đã bắt đầu, không thể tạo yêu cầu thay đổi');
    if (SWAP_TYPES.includes(dto.type) && locked) {
      throw new ConflictException('Kỳ lịch đã chốt — chỉ gửi yêu cầu ngoại lệ (NGOAI_LE) tới KHTH');
    }
    const mine = await this.assignmentOf(dto.slotId, user.id);
    const dupe = await this.db.db
      .select({ id: dutyRequests.id })
      .from(dutyRequests)
      .where(and(eq(dutyRequests.slotId, dto.slotId), eq(dutyRequests.requesterId, user.id), inArray(dutyRequests.status, OPEN_STATUSES)))
      .limit(1);
    if (dupe.length) throw new ConflictException('Bạn đã có yêu cầu đang chờ xử lý cho ca này');

    let targetUserId: number | null = dto.targetUserId ?? null;
    let targetSlotId: number | null = null;
    let replacementUserId: number | null = dto.replacementUserId ?? null;
    let status: DutyRequestStatus = 'CHO_NGUOI_NHAN';

    if (dto.type === 'NHUONG') {
      if (!mine) throw new ConflictException('Bạn không được xếp trong ca này');
      if (!targetUserId) throw new BadRequestException('Chọn người nhận ca');
      if (targetUserId === user.id) throw new BadRequestException('Không thể nhường ca cho chính mình');
      const res = await this.checkMove(this.db.db, dto.slotId, targetUserId, { filledDelta: -1, exclude: [] });
      if (!res.ok) throw new ConflictException(`Người nhận không đủ điều kiện: ${violationText(res)}`);
    } else if (dto.type === 'DOI') {
      if (!mine) throw new ConflictException('Bạn không được xếp trong ca này');
      if (!targetUserId || !dto.targetSlotId) throw new BadRequestException('Chọn người đổi ca và ca của người đó');
      if (targetUserId === user.id) throw new BadRequestException('Không thể đổi ca với chính mình');
      const other = await this.core.getSlot(dto.targetSlotId);
      if (other.periodId !== slot.periodId) throw new BadRequestException('Hai ca phải thuộc cùng một kỳ lịch');
      const theirs = await this.assignmentOf(dto.targetSlotId, targetUserId);
      if (!theirs) throw new ConflictException('Người đổi ca không còn trong ca khám đã chọn');
      if (this.core.toEngineSlot(other).start <= Date.now()) throw new ConflictException('Ca của người đổi đã bắt đầu');
      targetSlotId = dto.targetSlotId;
      const a = await this.checkMove(this.db.db, dto.slotId, targetUserId, { filledDelta: -1, exclude: [dto.targetSlotId] });
      if (!a.ok) throw new ConflictException(`Người đổi không đủ điều kiện nhận ca của bạn: ${violationText(a)}`);
      const b = await this.checkMove(this.db.db, dto.targetSlotId, user.id, { filledDelta: -1, exclude: [dto.slotId] });
      if (!b.ok) throw new ConflictException(`Bạn không đủ điều kiện nhận ca của người đổi: ${violationText(b)}`);
    } else {
      status = 'CHO_DUYET';
      if (!targetUserId) {
        if (!mine) throw new BadRequestException('Chọn người cần thay trong ca này');
        targetUserId = user.id;
      } else if (!(await this.assignmentOf(dto.slotId, targetUserId))) {
        throw new BadRequestException('Người cần thay không có trong ca này');
      }
      if (replacementUserId && replacementUserId === targetUserId) throw new BadRequestException('Người thay không thể là người cần thay');
    }

    const [row] = await this.db.db
      .insert(dutyRequests)
      .values({
        periodId: slot.periodId,
        type: dto.type,
        status,
        requesterId: user.id,
        slotId: dto.slotId,
        targetUserId,
        targetSlotId,
        replacementUserId,
        urgent: !!dto.urgent,
        reason: dto.reason,
      })
      .returning();
    await this.core.log(this.db.db, {
      periodId: slot.periodId,
      slotId: slot.id,
      requestId: row.id,
      action: `REQUEST_${dto.type}`,
      actorId: user.id,
      userId: targetUserId,
      reason: dto.reason,
      detail: { shift: slot.shiftCode, room: slot.roomCode, date: slot.dutyDate, urgent: !!dto.urgent },
    });
    const who = user.fullName;
    const where = `${slot.roomCode} · ${slot.shiftCode} · ${fmtDate(slot.dutyDate)}`;
    if (dto.type === 'NGOAI_LE') {
      const holders = await this.core.holderIds(['duty.exception.resolve']);
      this.core.notifyAfterCommit(holders.filter((id) => id !== user.id), {
        title: dto.urgent ? 'Đổi lịch khám KHẨN — cần KHTH xử lý' : 'Yêu cầu ngoại lệ đổi lịch khám',
        body: `${who}: ${where}. ${dto.reason}`,
        level: dto.urgent ? 'ERROR' : 'WARNING',
        link: '/lich-truc/yeu-cau',
        module: 'DUTY',
        entityId: String(row.id),
      });
    } else {
      this.core.notifyAfterCommit([targetUserId], {
        title: dto.type === 'NHUONG' ? 'Có đề nghị nhận ca khám' : 'Có đề nghị đổi ca khám',
        body: `${who} đề nghị ${dto.type === 'NHUONG' ? 'nhường' : 'đổi'} ca ${where}. Mở "Lịch của tôi" để đồng ý hoặc từ chối.`,
        level: 'INFO',
        link: '/lich-truc/cua-toi',
        module: 'DUTY',
        entityId: String(row.id),
      });
    }
    this.core.emit('request', slot.periodId);
    const [view] = (await this.list(user, { box: 'mine', periodId: slot.periodId })).filter((r) => r.id === row.id);
    return view ?? { id: row.id };
  }

  /* ================================================================ Phản hồi của người nhận */

  async accept(user: AccessContext, id: number) {
    const req = await this.getRequest(id);
    if (req.targetUserId !== user.id) throw new ForbiddenException('Chỉ người được đề nghị mới chấp nhận');
    if (req.status !== 'CHO_NGUOI_NHAN' || !SWAP_TYPES.includes(req.type)) throw new ConflictException('Yêu cầu không còn chờ bạn phản hồi');
    const period = await this.core.getPeriod(req.periodId);
    const { locked } = this.core.phaseOf(period);
    if (locked) throw new ConflictException('Kỳ lịch đã chốt — không thể đổi ca, hãy gửi yêu cầu ngoại lệ tới KHTH');

    const outcome = await this.db.db.transaction(async (tx) => {
      await lockAll(tx, [req.slotId, ...(req.targetSlotId ? [req.targetSlotId] : [])], [req.requesterId, user.id]);
      const stillMine = await this.assignmentOf(req.slotId, req.requesterId, tx);
      const stillTheirs = req.type === 'DOI' && req.targetSlotId ? await this.assignmentOf(req.targetSlotId, user.id, tx) : true;
      if (!stillMine || !stillTheirs) {
        await tx
          .update(dutyRequests)
          .set({ status: 'TU_CHOI', responseNote: 'Ca đã thay đổi trước khi phản hồi', targetRespondedAt: new Date(), updatedAt: new Date() })
          .where(eq(dutyRequests.id, id));
        return { status: 'TU_CHOI' as const, reason: 'Ca đã thay đổi trước khi phản hồi' };
      }
      const a = await this.checkMove(tx, req.slotId, user.id, { filledDelta: -1, exclude: req.targetSlotId ? [req.targetSlotId] : [] });
      const b = req.type === 'DOI' && req.targetSlotId ? await this.checkMove(tx, req.targetSlotId, req.requesterId, { filledDelta: -1, exclude: [req.slotId] }) : null;
      const bad = !a.ok ? violationText(a) : b && !b.ok ? violationText(b) : '';
      if (bad) {
        await tx
          .update(dutyRequests)
          .set({ status: 'TU_CHOI', responseNote: `Không còn đủ điều kiện: ${bad}`, targetRespondedAt: new Date(), updatedAt: new Date() })
          .where(eq(dutyRequests.id, id));
        return { status: 'TU_CHOI' as const, reason: bad };
      }
      if (period.rules.swapNeedsApproval) {
        await tx
          .update(dutyRequests)
          .set({ status: 'CHO_DUYET', targetRespondedAt: new Date(), updatedAt: new Date() })
          .where(eq(dutyRequests.id, id));
        await this.core.log(tx, { periodId: req.periodId, slotId: req.slotId, requestId: id, action: 'REQUEST_ACCEPTED', actorId: user.id, userId: req.requesterId });
        return { status: 'CHO_DUYET' as const, reason: '' };
      }
      await this.executeSwap(tx, req, user.id, 'Tự động duyệt theo cấu hình kỳ lịch');
      return { status: 'DA_DUYET' as const, reason: '' };
    });

    if (outcome.status === 'CHO_DUYET') {
      const approvers = await this.core.holderIds(['duty.swap.approve', 'duty.manage-all']);
      this.core.notifyAfterCommit(approvers, {
        title: 'Đổi/nhường ca chờ duyệt',
        body: `${user.fullName} đã đồng ý với đề nghị đổi/nhường ca. Cần Trưởng khoa hoặc Điều phối lịch khám duyệt.`,
        level: 'INFO',
        link: '/lich-truc/yeu-cau',
        module: 'DUTY',
        entityId: String(id),
      });
    } else if (outcome.status === 'DA_DUYET') {
      this.notifySwapDone(req.requesterId, user.id, req.periodId, id);
    } else {
      this.core.notifyAfterCommit([req.requesterId], { title: 'Đề nghị đổi ca không thực hiện được', body: outcome.reason, level: 'WARNING', link: '/lich-truc/cua-toi', module: 'DUTY', entityId: String(id) });
    }
    this.core.emit('request', req.periodId);
    return { ok: true, status: outcome.status, reason: outcome.reason };
  }

  async decline(user: AccessContext, id: number, dto: RequestRespondDto) {
    const req = await this.getRequest(id);
    if (req.targetUserId !== user.id) throw new ForbiddenException('Chỉ người được đề nghị mới từ chối');
    if (req.status !== 'CHO_NGUOI_NHAN') throw new ConflictException('Yêu cầu không còn chờ bạn phản hồi');
    await this.db.db
      .update(dutyRequests)
      .set({ status: 'TU_CHOI', responseNote: dto.note ?? '', targetRespondedAt: new Date(), resolvedAt: new Date(), updatedAt: new Date() })
      .where(eq(dutyRequests.id, id));
    await this.core.log(this.db.db, { periodId: req.periodId, slotId: req.slotId, requestId: id, action: 'REQUEST_DECLINED', actorId: user.id, userId: req.requesterId, reason: dto.note ?? '' });
    this.core.notifyAfterCommit([req.requesterId], {
      title: 'Đề nghị đổi ca bị từ chối',
      body: `${user.fullName} đã từ chối${dto.note ? `: ${dto.note}` : ''}`,
      level: 'WARNING',
      link: '/lich-truc/cua-toi',
      module: 'DUTY',
      entityId: String(id),
    });
    this.core.emit('request', req.periodId);
    return { ok: true };
  }

  async cancel(user: AccessContext, id: number) {
    const req = await this.getRequest(id);
    if (req.requesterId !== user.id) throw new ForbiddenException('Chỉ người tạo yêu cầu mới huỷ được');
    if (!OPEN_STATUSES.includes(req.status)) throw new ConflictException('Yêu cầu đã được xử lý, không thể huỷ');
    await this.db.db
      .update(dutyRequests)
      .set({ status: 'HUY', resolvedAt: new Date(), updatedAt: new Date() })
      .where(eq(dutyRequests.id, id));
    await this.core.log(this.db.db, { periodId: req.periodId, slotId: req.slotId, requestId: id, action: 'REQUEST_CANCELLED', actorId: user.id });
    if (req.targetUserId) {
      this.core.notifyAfterCommit([req.targetUserId], { title: 'Đề nghị đổi ca đã được huỷ', body: `${user.fullName} đã huỷ đề nghị.`, level: 'INFO', link: '/lich-truc/cua-toi', module: 'DUTY', entityId: String(id) });
    }
    this.core.emit('request', req.periodId);
    return { ok: true };
  }

  /* ================================================================ Duyệt */

  async approve(user: AccessContext, id: number, dto: RequestRespondDto) {
    const req = await this.getRequest(id);
    if (req.status !== 'CHO_DUYET') throw new ConflictException('Yêu cầu không ở trạng thái chờ duyệt');
    const period = await this.core.getPeriod(req.periodId);
    const { locked } = this.core.phaseOf(period);

    if (req.type === 'NGOAI_LE') {
      if (!this.core.hasPerm(user, 'duty.exception.resolve')) throw new ForbiddenException('Chỉ KHTH (điều phối lịch khám) mới xử lý ngoại lệ');
      await this.resolveException(user, req, dto);
    } else {
      const requester = (await this.core.loadUsers(this.db.db, [req.requesterId])).get(req.requesterId);
      if (!requester || !this.canApproveSwap(user, requester.departmentId)) {
        throw new ForbiddenException('Bạn không có quyền duyệt đổi ca của nhân viên khoa này');
      }
      if (locked) throw new ConflictException('Kỳ lịch đã chốt — yêu cầu này cần chuyển thành ngoại lệ cho KHTH');
      await this.db.db.transaction(async (tx) => {
        await lockAll(tx, [req.slotId, ...(req.targetSlotId ? [req.targetSlotId] : [])], [req.requesterId, req.targetUserId ?? 0]);
        await this.executeSwap(tx, req, user.id, dto.note ?? '');
      });
    }
    this.core.emit('request', req.periodId);
    return { ok: true };
  }

  async reject(user: AccessContext, id: number, dto: RequestRespondDto) {
    const req = await this.getRequest(id);
    if (req.status !== 'CHO_DUYET') throw new ConflictException('Yêu cầu không ở trạng thái chờ duyệt');
    if (!dto.note || dto.note.trim().length < 3) throw new BadRequestException('Vui lòng ghi lý do từ chối');
    if (req.type === 'NGOAI_LE') {
      if (!this.core.hasPerm(user, 'duty.exception.resolve')) throw new ForbiddenException('Chỉ KHTH mới xử lý ngoại lệ');
    } else {
      const requester = (await this.core.loadUsers(this.db.db, [req.requesterId])).get(req.requesterId);
      if (!requester || !this.canApproveSwap(user, requester.departmentId)) {
        throw new ForbiddenException('Bạn không có quyền duyệt đổi ca của nhân viên khoa này');
      }
    }
    await this.db.db
      .update(dutyRequests)
      .set({ status: 'TU_CHOI', responseNote: dto.note, resolvedBy: user.id, resolvedAt: new Date(), updatedAt: new Date() })
      .where(eq(dutyRequests.id, id));
    await this.core.log(this.db.db, { periodId: req.periodId, slotId: req.slotId, requestId: id, action: 'REQUEST_REJECTED', actorId: user.id, userId: req.requesterId, reason: dto.note });
    this.core.notifyAfterCommit([req.requesterId, req.targetUserId], {
      title: 'Yêu cầu ca khám bị từ chối',
      body: dto.note,
      level: 'WARNING',
      link: '/lich-truc/cua-toi',
      module: 'DUTY',
      entityId: String(id),
    });
    this.core.emit('request', req.periodId);
    return { ok: true };
  }

  /** Thực hiện đổi/nhường ca khám (trong transaction đã khoá ca khám và người) */
  private async executeSwap(tx: Tx, req: typeof dutyRequests.$inferSelect, actorId: number, note: string) {
    const giver = await this.assignmentOf(req.slotId, req.requesterId, tx);
    if (!giver) throw new ConflictException('Người yêu cầu không còn trong ca — yêu cầu không còn hiệu lực');
    const receiverId = req.targetUserId;
    if (!receiverId) throw new ConflictException('Yêu cầu thiếu người nhận');
    const a = await this.checkMove(tx, req.slotId, receiverId, { filledDelta: -1, exclude: req.targetSlotId ? [req.targetSlotId] : [] });
    if (!a.ok) throw new ConflictException(violationText(a));
    if (req.type === 'DOI' && req.targetSlotId) {
      const theirs = await this.assignmentOf(req.targetSlotId, receiverId, tx);
      if (!theirs) throw new ConflictException('Người đổi ca không còn trong ca của họ');
      const b = await this.checkMove(tx, req.targetSlotId, req.requesterId, { filledDelta: -1, exclude: [req.slotId] });
      if (!b.ok) throw new ConflictException(violationText(b));
      await tx.delete(dutyAssignments).where(eq(dutyAssignments.id, theirs.id));
      await tx.delete(dutyAssignments).where(eq(dutyAssignments.id, giver.id));
      await tx.insert(dutyAssignments).values({ slotId: req.slotId, userId: receiverId, source: 'DOI', createdBy: actorId });
      await tx.insert(dutyAssignments).values({ slotId: req.targetSlotId, userId: req.requesterId, source: 'DOI', createdBy: actorId });
    } else {
      await tx.delete(dutyAssignments).where(eq(dutyAssignments.id, giver.id));
      await tx.insert(dutyAssignments).values({ slotId: req.slotId, userId: receiverId, source: 'NHUONG', createdBy: actorId });
    }
    await tx
      .update(dutyRequests)
      .set({
        status: 'DA_DUYET',
        resolvedBy: actorId === 0 ? null : actorId,
        resolvedAt: new Date(),
        responseNote: note,
        targetRespondedAt: req.targetRespondedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(dutyRequests.id, req.id));
    await this.core.log(tx, {
      periodId: req.periodId,
      slotId: req.slotId,
      requestId: req.id,
      action: req.type === 'DOI' ? 'SWAP' : 'HANDOVER',
      actorId,
      userId: req.requesterId,
      reason: note,
      detail: { giver: req.requesterId, receiver: receiverId, targetSlotId: req.targetSlotId },
    });
  }

  /** KHTH duyệt ngoại lệ: gỡ người cũ, xếp người thay (có thể bỏ qua ràng buộc khi có lý do) */
  private async resolveException(user: AccessContext, req: typeof dutyRequests.$inferSelect, dto: RequestRespondDto) {
    const replacementId = dto.replacementUserId ?? req.replacementUserId ?? null;
    const removedId = req.targetUserId ?? req.requesterId;
    let forced = false;
    let violations: string[] = [];
    await this.db.db.transaction(async (tx) => {
      await lockAll(tx, [req.slotId], [removedId, replacementId ?? 0]);
      const old = await this.assignmentOf(req.slotId, removedId, tx);
      if (old) await tx.delete(dutyAssignments).where(eq(dutyAssignments.id, old.id));
      if (replacementId) {
        if (replacementId === removedId) throw new BadRequestException('Người thay không thể là người cần thay');
        const res = await this.checkMove(tx, req.slotId, replacementId, { filledDelta: 0, locked: false });
        if (!res.ok && !dto.force) throw new ConflictException(`${violationText(res)}. Nếu cần, điều phối toàn viện bỏ qua ràng buộc và ghi lý do.`);
        forced = !res.ok;
        violations = res.errors.map((e) => e.message);
        await tx.insert(dutyAssignments).values({ slotId: req.slotId, userId: replacementId, source: 'NGOAI_LE', createdBy: user.id, note: dto.note ?? '' });
      }
      await tx
        .update(dutyRequests)
        .set({
          status: 'DA_DUYET',
          replacementUserId: replacementId,
          resolvedBy: user.id,
          resolvedAt: new Date(),
          responseNote: dto.note ?? (replacementId ? 'Đã xếp người thay' : 'Đã gỡ, chưa có người thay'),
          updatedAt: new Date(),
        })
        .where(eq(dutyRequests.id, req.id));
      await this.core.log(tx, {
        periodId: req.periodId,
        slotId: req.slotId,
        requestId: req.id,
        action: 'EXCEPTION',
        actorId: user.id,
        userId: removedId,
        reason: req.reason,
        detail: { replacementUserId: replacementId, forced, violations },
      });
    });
    const slot = await this.core.getSlot(req.slotId);
    const where = `${slot.roomCode} · ${slot.shiftCode} · ${fmtDate(slot.dutyDate)}`;
    this.core.notifyAfterCommit([removedId], { title: 'Ca khám đã được điều chỉnh (ngoại lệ)', body: `${where}. KHTH đã cập nhật bác sĩ khám.`, level: 'WARNING', link: '/lich-truc/cua-toi', module: 'DUTY', entityId: String(req.id) });
    if (replacementId) {
      this.core.notifyAfterCommit([replacementId], { title: 'Bạn được xếp khám thay (ngoại lệ)', body: `${where}. Vui lòng xác nhận lịch của bạn.`, level: 'WARNING', link: '/lich-truc/cua-toi', module: 'DUTY', entityId: String(req.id) });
    }
    this.core.notifyAfterCommit([req.requesterId], { title: 'Yêu cầu ngoại lệ đã được xử lý', body: `${where}: ${dto.note ?? 'KHTH đã duyệt'}`, level: 'INFO', link: '/lich-truc/yeu-cau', module: 'DUTY', entityId: String(req.id) });
  }

  private notifySwapDone(requesterId: number, receiverId: number, periodId: number, requestId: number) {
    this.core.notifyAfterCommit([requesterId, receiverId], {
      title: 'Đổi/nhường ca đã được duyệt',
      body: 'Lịch khám của bạn đã được cập nhật. Vui lòng kiểm tra trong mục Lịch của tôi.',
      level: 'SUCCESS',
      link: '/lich-truc/cua-toi',
      module: 'DUTY',
      entityId: String(requestId),
    });
    this.core.emit('request', periodId);
  }

  /* ================================================================ Đổi lịch khám trực tiếp (tài khoản điều phối) */

  /** Điều phối toàn viện: đổi bác sĩ khám ngay, kể cả sau khi chốt. Bắt buộc ghi lý do. */
  async override(user: AccessContext, dto: OverrideDto) {
    if (!dto.removeUserId && !dto.addUserId) throw new BadRequestException('Chọn người cần gỡ hoặc người cần thêm');
    if (dto.removeUserId && dto.removeUserId === dto.addUserId) throw new BadRequestException('Người gỡ và người thêm không thể trùng nhau');
    const slot = await this.core.getSlot(dto.slotId);
    if (slot.periodStatus === 'NHAP') throw new ConflictException('Kỳ lịch chưa công bố — hãy chỉnh phân công trực tiếp');
    let violations: string[] = [];
    let forced = false;
    await this.db.db.transaction(async (tx) => {
      await lockAll(tx, [dto.slotId], [dto.removeUserId ?? 0, dto.addUserId ?? 0]);
      if (dto.removeUserId) {
        const old = await this.assignmentOf(dto.slotId, dto.removeUserId, tx);
        if (!old) throw new ConflictException('Người cần gỡ không có trong ca này');
        await tx.delete(dutyAssignments).where(eq(dutyAssignments.id, old.id));
      }
      if (dto.addUserId) {
        const res = await this.checkMove(tx, dto.slotId, dto.addUserId, { filledDelta: dto.removeUserId ? -1 : 0, locked: false });
        if (!res.ok && !dto.force) throw new ConflictException(`${violationText(res)}. Bật "bỏ qua ràng buộc" nếu thật sự cần, kèm lý do.`);
        forced = !res.ok;
        violations = res.errors.map((e) => e.message);
        await tx.insert(dutyAssignments).values({ slotId: dto.slotId, userId: dto.addUserId, source: 'DIEU_CHINH', createdBy: user.id, note: dto.reason });
      }
      await this.core.log(tx, {
        periodId: slot.periodId,
        slotId: slot.id,
        action: 'OVERRIDE',
        actorId: user.id,
        userId: dto.addUserId ?? dto.removeUserId ?? null,
        reason: dto.reason,
        detail: { removed: dto.removeUserId ?? null, added: dto.addUserId ?? null, forced, violations, shift: slot.shiftCode, room: slot.roomCode, date: slot.dutyDate },
      });
    });
    const where = `${slot.roomCode} · ${slot.shiftCode} · ${fmtDate(slot.dutyDate)}`;
    if (dto.removeUserId) {
      this.core.notifyAfterCommit([dto.removeUserId], { title: 'Bạn được gỡ khỏi ca khám', body: `${where}. ${dto.reason}`, level: 'WARNING', link: '/lich-truc/cua-toi', module: 'DUTY', entityId: String(slot.periodId) });
    }
    if (dto.addUserId) {
      this.core.notifyAfterCommit([dto.addUserId], { title: 'Bạn được xếp khám (điều chỉnh)', body: `${where}. ${dto.reason}`, level: 'WARNING', link: '/lich-truc/cua-toi', module: 'DUTY', entityId: String(slot.periodId) });
    }
    this.core.emit('assign', slot.periodId);
    return { ...(await this.duty.slotDetail(dto.slotId)), forced, violations };
  }
}
