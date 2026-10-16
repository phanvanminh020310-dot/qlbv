import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  notExists,
  sql,
  type SQL,
} from "drizzle-orm";
import { DbService, type Executor } from "../../db/db.service";
import {
  dutyAbsenceRequests,
  dutyAbsences,
  dutyAssignments,
  dutySlots,
  users,
} from "../../db/schema";
import type { AccessContext } from "../../common/types/access-context";
import { DutyCoreService } from "./duty-core.service";
import { addDays, bangkokToday, dayStartMs, fmtDate, violationText } from "./duty-rules";
import type { AbsenceDto, AbsenceQueryDto, AbsenceReviewDto } from "./duty.dto";

type Request = typeof dutyAbsenceRequests.$inferSelect;
const NS = 9301;

@Injectable()
export class DutyAbsenceService {
  constructor(
    private readonly db: DbService,
    private readonly core: DutyCoreService,
  ) {}

  private async request(id: number, c: Executor = this.db.db) {
    const [row] = await c
      .select()
      .from(dutyAbsenceRequests)
      .where(eq(dutyAbsenceRequests.id, id))
      .limit(1);
    if (!row) throw new NotFoundException("Không tìm thấy yêu cầu nghỉ/bận");
    return row;
  }

  private async target(row: { userId: number }, c: Executor = this.db.db) {
    const target = (await this.core.loadUsers(c, [row.userId])).get(row.userId);
    if (!target) throw new NotFoundException("Không tìm thấy nhân viên");
    return target;
  }

  private async ensureManager(
    user: AccessContext,
    row: { userId: number },
    c: Executor = this.db.db,
  ) {
    if (!this.core.canManageAny(user))
      throw new ForbiddenException(
        "Chỉ người quản lý lịch trực được duyệt nghỉ/bận",
      );
    const target = await this.target(row, c);
    this.core.ensureManageDept(
      user,
      target.departmentId,
      `Nhân viên ${target.fullName}`,
    );
    return target;
  }

  /** Includes ongoing overnight shifts, but never rewrites completed clinical history. */
  async affected(
    row: { userId: number; startDate: string; endDate: string },
    c: Executor = this.db.db,
  ) {
    const assigned = await c
      .select({ assignmentId: dutyAssignments.id, slotId: dutySlots.id })
      .from(dutyAssignments)
      .innerJoin(dutySlots, eq(dutySlots.id, dutyAssignments.slotId))
      .where(
        and(
          eq(dutyAssignments.userId, row.userId),
          gte(dutySlots.dutyDate, addDays(row.startDate, -1)),
          lte(dutySlots.dutyDate, row.endDate),
        ),
      );
    if (!assigned.length) return [];
    const slots = await this.core.loadSlots(
      c,
      inArray(
        dutySlots.id,
        assigned.map((a) => a.slotId),
      ),
    );
    const ids = new Map(assigned.map((a) => [a.slotId, a.assignmentId]));
    const from = dayStartMs(row.startDate),
      to = dayStartMs(addDays(row.endDate, 1)),
      now = Date.now();
    return slots
      .filter((s) => {
        const interval = this.core.toEngineSlot(s);
        return interval.end > now && interval.start < to && from < interval.end;
      })
      .map((s) => ({ ...s, assignmentId: ids.get(s.id)! }));
  }

  async create(user: AccessContext, dto: AbsenceDto) {
    // Validate real calendar dates as well as DTO shape; limit review workload.
    for (const date of [dto.startDate, dto.endDate]) {
      const time = Date.parse(date + "T00:00:00Z");
      if (
        !Number.isFinite(time) ||
        new Date(time).toISOString().slice(0, 10) !== date
      )
        throw new BadRequestException("Ngày nghỉ không hợp lệ");
    }
    if (
      dto.startDate > dto.endDate ||
      (Date.parse(dto.endDate + "T00:00:00Z") -
        Date.parse(dto.startDate + "T00:00:00Z")) /
        86400000 >=
        366
    )
      throw new BadRequestException(
        "Khoảng nghỉ phải hợp lệ và tối đa 366 ngày",
      );
    if (dto.endDate < bangkokToday())
      throw new BadRequestException(
        "Không gửi yêu cầu nghỉ/bận cho ngày đã qua",
      );
    const userId = dto.userId ?? user.id;
    const target = await this.target({ userId });
    if (!target.active)
      throw new ConflictException("Nhân viên đã ngừng hoạt động");
    if (userId !== user.id) await this.ensureManager(user, { userId });
    const result = await this.db.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${NS}, ${userId})`);
      const [approved] = await tx
        .select({ id: dutyAbsences.id })
        .from(dutyAbsences)
        .where(
          and(
            eq(dutyAbsences.userId, userId),
            lte(dutyAbsences.startDate, dto.endDate),
            gte(dutyAbsences.endDate, dto.startDate),
          ),
        )
        .limit(1);
      const [pending] = await tx
        .select({ id: dutyAbsenceRequests.id })
        .from(dutyAbsenceRequests)
        .where(
          and(
            eq(dutyAbsenceRequests.userId, userId),
            eq(dutyAbsenceRequests.status, "CHO_DUYET"),
            lte(dutyAbsenceRequests.startDate, dto.endDate),
            gte(dutyAbsenceRequests.endDate, dto.startDate),
          ),
        )
        .limit(1);
      if (approved || pending)
        throw new ConflictException(
          "Đã có khoảng nghỉ được duyệt hoặc yêu cầu chờ duyệt trùng ngày",
        );
      const [row] = await tx
        .insert(dutyAbsenceRequests)
        .values({
          userId,
          startDate: dto.startDate,
          endDate: dto.endDate,
          reason: dto.reason,
          note: dto.note ?? "",
          createdBy: user.id,
        })
        .returning();
      await this.core.log(tx, {
        action: "ABSENCE_REQUEST",
        actorId: user.id,
        userId,
        reason: dto.note,
        detail: {
          absenceRequestId: row.id,
          startDate: row.startDate,
          endDate: row.endDate,
        },
      });
      return row;
    });
    const affected = await this.affected(result);
    const holders = await this.core.holderIds([
      "duty.manage",
      "duty.manage-all",
    ]);
    this.core.notifyAfterCommit(
      holders.filter((id) => id !== userId),
      {
        title: "Yêu cầu nghỉ/bận chờ duyệt",
        body: "Có yêu cầu nghỉ/bận mới. Mở hộp chờ duyệt theo phạm vi được phân quyền; lịch hiện tại vẫn giữ nguyên và cần chọn người thay trước khi duyệt.",
        level: "WARNING",
        link: "/lich-truc/yeu-cau",
        module: "DUTY",
        entityId: String(result.id),
      },
    );
    this.core.emit("absence-request"); // Workflow-only; no operational absence or assignment is changed.
    return {
      ...result,
      kind: "REQUEST" as const,
      affected: affected.map((s) => ({
        slotId: s.id,
        dutyDate: s.dutyDate,
        roomCode: s.roomCode,
        shiftCode: s.shiftCode,
      })),
    };
  }

  async listRequests(
    user: AccessContext,
    box = "mine",
    q: AbsenceQueryDto = {},
  ) {
    if (!["mine", "approval", "all"].includes(box))
      throw new BadRequestException("Hộp yêu cầu không hợp lệ");
    if (box === "approval" && !this.core.canManageAny(user))
      throw new ForbiddenException("Chỉ người quản lý lịch trực xem hộp duyệt");
    const conditions: SQL[] = [];
    if (box === "mine" || !this.core.canManageAny(user))
      conditions.push(eq(dutyAbsenceRequests.userId, user.id));
    else {
      if (!this.core.isAll(user)) {
        const depts = this.core.scopeDeptIds(user);
        if (!depts.length) return [];
        conditions.push(inArray(users.departmentId, depts));
      }
      if (box === "approval")
        conditions.push(eq(dutyAbsenceRequests.status, "CHO_DUYET"));
    }
    if (q.from) conditions.push(gte(dutyAbsenceRequests.endDate, q.from));
    if (q.to) conditions.push(lte(dutyAbsenceRequests.startDate, q.to));
    const rows = await this.db.db
      .select({
        request: dutyAbsenceRequests,
        fullName: users.fullName,
        departmentId: users.departmentId,
      })
      .from(dutyAbsenceRequests)
      .innerJoin(users, eq(users.id, dutyAbsenceRequests.userId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(dutyAbsenceRequests.createdAt))
      .limit(300);
    return rows.map(({ request: r, fullName, departmentId }) => ({
      ...r,
      fullName,
      kind: "REQUEST" as const,
      actions: {
        canCancel: r.userId === user.id && r.status === "CHO_DUYET",
        canApprove:
          r.status === "CHO_DUYET" &&
          r.userId !== user.id &&
          this.core.canManageDept(user, departmentId),
      },
    }));
  }

  async list(user: AccessContext, q: AbsenceQueryDto) {
    // This endpoint backs "My calendar"; management review has its own explicitly scoped inbox.
    const mine = await this.listRequests(user, "mine", q);
    const conditions: SQL[] = [
      eq(dutyAbsences.userId, user.id),
      notExists(
        this.db.db
          .select({ id: dutyAbsenceRequests.id })
          .from(dutyAbsenceRequests)
          .where(eq(dutyAbsenceRequests.approvedAbsenceId, dutyAbsences.id)),
      ),
    ];
    if (q.from) conditions.push(gte(dutyAbsences.endDate, q.from));
    if (q.to) conditions.push(lte(dutyAbsences.startDate, q.to));
    const legacy = await this.db.db
      .select({ record: dutyAbsences, fullName: users.fullName })
      .from(dutyAbsences)
      .innerJoin(users, eq(users.id, dutyAbsences.userId))
      .where(and(...conditions))
      .orderBy(desc(dutyAbsences.startDate))
      .limit(500);
    return [
      ...mine,
      ...legacy.map(({ record, fullName }) => ({
        ...record,
        fullName,
        kind: "APPROVED" as const,
        status: "DA_DUYET" as const,
        responseNote:
          "Dữ liệu nghỉ đã ghi nhận trước khi áp dụng quy trình duyệt",
        actions: { canCancel: false, canApprove: false },
      })),
    ];
  }

  async detail(user: AccessContext, id: number) {
    const row = await this.request(id);
    const manager = this.core.canManageAny(user) && row.userId !== user.id;
    if (row.userId !== user.id) await this.ensureManager(user, row);
    const slots = await this.affected(row);
    if (manager)
      for (const s of slots)
        this.core.ensureManageDept(
          user,
          s.roomDepartmentId,
          `Phòng ${s.roomCode}`,
        );
    const approvalBlockReason = !manager
      ? "Yêu cầu của bạn cần một người quản lý khác duyệt"
      : slots.some(
            (s) =>
              this.core.phaseOf({ status: s.periodStatus, lockAt: s.lockAt })
                .locked || this.core.toEngineSlot(s).start <= Date.now(),
          ) && !this.core.hasPerm(user, "duty.exception.resolve")
        ? "Có ca đã chốt/đang trực: cần KHTH có quyền xử lý ngoại lệ duyệt"
        : null;
    const staffRows = manager
      ? await this.db.db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.active, true), isNull(users.deletedAt)))
      : [];
    const staff = await this.core.loadUsers(
      this.db.db,
      staffRows.map((r) => r.id),
    );
    const pairs = slots.flatMap((s) =>
      this.core
        .pairsFor(
          s,
          [...staff.values()].filter((u) => u.id !== row.userId),
          { filledDelta: -1 },
        )
        .map((p) => ({ ...p, locked: false })),
    );
    // Only KHTH may cover an ongoing shift. The clock override bypasses PAST alone;
    // all medical/workload/absence/overlap constraints remain in the shared engine.
    const evaluated = pairs.length
      ? await this.core.evaluatePairs(this.db.db, pairs, {
          now: this.core.hasPerm(user, "duty.exception.resolve")
            ? Math.min(
                Date.now(),
                ...slots.map((s) => this.core.toEngineSlot(s).start - 1),
              )
            : Date.now(),
        })
      : new Map();
    return {
      ...row,
      fullName: (await this.target(row)).fullName,
      canApprove: row.status === "CHO_DUYET" && !approvalBlockReason,
      approvalBlockReason,
      affected: slots.map((s) => ({
        slotId: s.id,
        assignmentId: s.assignmentId,
        periodName: s.periodName,
        dutyDate: s.dutyDate,
        roomCode: s.roomCode,
        shiftCode: s.shiftCode,
        roleName: s.roleName,
        candidates: [...staff.values()]
          .filter(
            (u) => u.id !== row.userId && evaluated.get(`${s.id}:${u.id}`)?.ok,
          )
          .map((u) => ({ userId: u.id, fullName: u.fullName, title: u.title })),
      })),
    };
  }

  async approve(user: AccessContext, id: number, dto: AbsenceReviewDto) {
    const initial = await this.request(id);
    await this.ensureManager(user, initial);
    if (initial.userId === user.id)
      throw new ForbiddenException("Không tự duyệt nghỉ/bận của chính mình");
    const replacements = dto.replacements ?? [];
    if (new Set(replacements.map((r) => r.slotId)).size !== replacements.length)
      throw new BadRequestException("Mỗi ca chỉ có một người thay");
    const result = await this.db.db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from duty_absence_requests where id = ${id} for update`,
      );
      const row = await this.request(id, tx);
      if (row.status !== "CHO_DUYET")
        throw new ConflictException("Yêu cầu đã được xử lý");
      if (row.endDate < bangkokToday())
        throw new ConflictException(
          "Khoảng nghỉ đã kết thúc; không thay đổi lịch sử trực",
        );
      await this.ensureManager(user, row, tx);
      const before = await this.affected(row, tx);
      // Same slot → user advisory lock order as ordinary assignment mutations.
      for (const slotId of [...new Set(before.map((s) => s.id))].sort(
        (a, b) => a - b,
      ))
        await tx.execute(
          sql`select id from duty_slots where id = ${slotId} for update`,
        );
      const userIds = [
        ...new Set([
          row.userId,
          ...replacements.map((r) => r.replacementUserId),
        ]),
      ].sort((a, b) => a - b);
      for (const userId of userIds)
        await tx.execute(sql`select pg_advisory_xact_lock(${NS}, ${userId})`);
      const current = await this.affected(row, tx);
      if (
        current.length !== before.length ||
        current.some(
          (s) =>
            !before.some(
              (b) => b.id === s.id && b.assignmentId === s.assignmentId,
            ),
        )
      )
        throw new ConflictException(
          "Lịch vừa thay đổi, tải lại danh sách ca và người thay",
        );
      if (
        replacements.length !== current.length ||
        current.some(
          (s) =>
            !replacements.some(
              (r) => r.slotId === s.id && r.assignmentId === s.assignmentId,
            ),
        )
      )
        throw new ConflictException(
          "Phải chọn người thay cho TẤT CẢ ca đang bị ảnh hưởng; lịch cũ vẫn giữ nguyên",
        );
      const [overlap] = await tx
        .select({ id: dutyAbsences.id })
        .from(dutyAbsences)
        .where(
          and(
            eq(dutyAbsences.userId, row.userId),
            lte(dutyAbsences.startDate, row.endDate),
            gte(dutyAbsences.endDate, row.startDate),
          ),
        )
        .limit(1);
      if (overlap)
        throw new ConflictException(
          "Đã có nghỉ được duyệt trùng ngày, cần rà soát lại yêu cầu",
        );
      // Evaluate after each replacement so two picks cannot overbook the same clinician.
      for (const s of current.sort(
        (a, b) => a.dutyDate.localeCompare(b.dutyDate) || a.id - b.id,
      )) {
        this.core.ensureManageDept(
          user,
          s.roomDepartmentId,
          `Phòng ${s.roomCode}`,
        );
        if (
          (this.core.phaseOf({ status: s.periodStatus, lockAt: s.lockAt })
            .locked ||
            this.core.toEngineSlot(s).start <= Date.now()) &&
          !this.core.hasPerm(user, "duty.exception.resolve")
        )
          throw new ForbiddenException(
            "Ca đã chốt/đang trực: cần KHTH có quyền xử lý ngoại lệ duyệt nghỉ và người thay",
          );
        const replacement = replacements.find((r) => r.slotId === s.id)!;
        if (replacement.replacementUserId === row.userId)
          throw new BadRequestException(
            "Người thay không thể là bác sĩ xin nghỉ",
          );
        const doctor = (
          await this.core.loadUsers(tx, [replacement.replacementUserId])
        ).get(replacement.replacementUserId);
        if (!doctor) throw new NotFoundException("Người thay không tồn tại");
        const pairs = this.core
          .pairsFor(s, [doctor], { filledDelta: -1 })
          .map((p) => ({ ...p, locked: false }));
        const check = (
          await this.core.evaluatePairs(tx, pairs, {
            now: this.core.hasPerm(user, "duty.exception.resolve")
              ? Math.min(Date.now(), this.core.toEngineSlot(s).start - 1)
              : Date.now(),
          })
        ).get(`${s.id}:${doctor.id}`)!;
        if (!check.ok)
          throw new ConflictException(
            `${s.roomCode} / ${s.dutyDate} / ${s.shiftCode}: người thay không hợp lệ — ${violationText(check)}`,
          );
        await tx
          .delete(dutyAssignments)
          .where(
            and(
              eq(dutyAssignments.id, s.assignmentId),
              eq(dutyAssignments.userId, row.userId),
            ),
          );
        await tx
          .insert(dutyAssignments)
          .values({
            slotId: s.id,
            userId: doctor.id,
            source: "DIEU_CHINH",
            createdBy: user.id,
            note: `Duyệt nghỉ/bận #${id}: ${dto.note ?? row.note}`,
          });
        await this.core.log(tx, {
          periodId: s.periodId,
          slotId: s.id,
          action: "ABSENCE_REPLACE",
          actorId: user.id,
          userId: doctor.id,
          reason: dto.note ?? row.note,
          detail: {
            absenceRequestId: id,
            removedUserId: row.userId,
            originalAssignmentId: s.assignmentId,
          },
        });
      }
      const [absence] = await tx
        .insert(dutyAbsences)
        .values({
          userId: row.userId,
          startDate: row.startDate,
          endDate: row.endDate,
          reason: row.reason,
          note: row.note,
          createdBy: user.id,
        })
        .returning();
      await tx
        .update(dutyAbsenceRequests)
        .set({
          status: "DA_DUYET",
          resolvedBy: user.id,
          resolvedAt: new Date(),
          responseNote: dto.note ?? "",
          approvedAbsenceId: absence.id,
        })
        .where(eq(dutyAbsenceRequests.id, id));
      await this.core.log(tx, {
        action: "ABSENCE_APPROVE",
        actorId: user.id,
        userId: row.userId,
        reason: dto.note,
        detail: {
          absenceRequestId: id,
          approvedAbsenceId: absence.id,
          replacedSlots: current.map((s) => s.id),
        },
      });
      return {
        row,
        periods: [...new Set(current.map((s) => s.periodId))],
        replacements: replacements.map((r) => r.replacementUserId),
      };
    });
    this.core.notifyAfterCommit([result.row.userId, ...result.replacements], {
      title: "Nghỉ/bận đã được duyệt và bố trí người thay",
      body: `${fmtDate(result.row.startDate)} → ${fmtDate(result.row.endDate)}. Lịch chính thức đã cập nhật.`,
      level: "INFO",
      link: "/lich-truc/cua-toi",
      module: "DUTY",
      entityId: String(id),
    });
    if (result.periods.length)
      for (const period of result.periods) this.core.emit("assign", period);
    this.core.emit("absence");
    return { ok: true };
  }

  async resolve(
    user: AccessContext,
    id: number,
    kind: "HUY" | "TU_CHOI",
    note = "",
  ) {
    const initial = await this.request(id);
    if (kind === "HUY") {
      if (initial.userId !== user.id)
        throw new ForbiddenException(
          "Chỉ người xin nghỉ được hủy yêu cầu của mình",
        );
    } else {
      await this.ensureManager(user, initial);
      if (initial.userId === user.id)
        throw new ForbiddenException("Không tự xử lý yêu cầu của chính mình");
      if (note.trim().length < 3)
        throw new BadRequestException("Nhập lý do từ chối");
    }
    await this.db.db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from duty_absence_requests where id = ${id} for update`,
      );
      const row = await this.request(id, tx);
      if (row.status !== "CHO_DUYET")
        throw new ConflictException("Chỉ xử lý yêu cầu đang chờ duyệt");
      if (kind === "TU_CHOI") await this.ensureManager(user, row, tx);
      await tx
        .update(dutyAbsenceRequests)
        .set({
          status: kind,
          resolvedBy: user.id,
          resolvedAt: new Date(),
          responseNote: note.trim(),
        })
        .where(eq(dutyAbsenceRequests.id, id));
      await this.core.log(tx, {
        action: `ABSENCE_${kind}`,
        actorId: user.id,
        userId: row.userId,
        reason: note,
        detail: { absenceRequestId: id },
      });
    });
    if (kind === "TU_CHOI")
      this.core.notifyAfterCommit([initial.userId], {
        title: "Yêu cầu nghỉ/bận chưa được duyệt",
        body: note.trim(),
        level: "WARNING",
        link: "/lich-truc/cua-toi",
        module: "DUTY",
        entityId: String(id),
      });
    this.core.emit("absence-request");
    return { ok: true };
  }

  async deleteLegacy(user: AccessContext, id: number) {
    const [row] = await this.db.db
      .select()
      .from(dutyAbsences)
      .where(eq(dutyAbsences.id, id))
      .limit(1);
    if (!row) throw new NotFoundException("Không tìm thấy nghỉ đã ghi nhận");
    await this.ensureManager(user, row);
    const [linked] = await this.db.db
      .select({ id: dutyAbsenceRequests.id })
      .from(dutyAbsenceRequests)
      .where(eq(dutyAbsenceRequests.approvedAbsenceId, id))
      .limit(1);
    if (linked)
      throw new ConflictException(
        "Nghỉ đã duyệt qua quy trình không được xóa trực tiếp; quản lý phải rà soát lịch và xử lý có nhật ký",
      );
    await this.db.db.transaction(async (tx) => {
      await tx.delete(dutyAbsences).where(eq(dutyAbsences.id, id));
      await this.core.log(tx, {
        action: "ABSENCE_LEGACY_DELETE",
        actorId: user.id,
        userId: row.userId,
        detail: { absenceId: id },
      });
    });
    this.core.emit("absence");
    return { ok: true };
  }
}
