import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { buildPage } from '../../common/dto/query.dto';
import {
  departments,
  dutyClosedDays,
  dutyRoles,
  dutyRooms,
  dutyShiftTypes,
  dutySlots,
  jobTitles,
} from '../../db/schema';
import { fmtDm, isNightWindow } from './duty-rules';
import type {
  CatalogQueryDto,
  ClosedDayDto,
  RoleDto,
  RoomDto,
  ShiftDto,
  UpdateClosedDayDto,
  UpdateRoleDto,
  UpdateRoomDto,
  UpdateShiftDto,
} from './duty.dto';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function pageOf(q: CatalogQueryDto) {
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = q.all ? 1000 : Math.min(200, Math.max(1, Number(q.pageSize) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

@Injectable()
export class DutyCatalogService {
  constructor(private readonly db: DbService) {}

  private like(q?: string) {
    return q?.trim() ? `%${q.trim()}%` : null;
  }

  /* ============================================================ Phòng khám */

  async listRooms(q: CatalogQueryDto) {
    const { page, pageSize, offset } = pageOf(q);
    const like = this.like(q.q);
    const where: SQL[] = [];
    if (like) where.push(or(ilike(dutyRooms.code, like), ilike(dutyRooms.name, like), ilike(dutyRooms.location, like)) as SQL);
    if (q.activeOnly) where.push(eq(dutyRooms.active, true));
    const cond = where.length ? and(...where) : undefined;
    const [{ total }] = await this.db.db.select({ total: sql<number>`count(*)::int` }).from(dutyRooms).where(cond);
    const items = await this.db.db
      .select({
        id: dutyRooms.id,
        code: dutyRooms.code,
        name: dutyRooms.name,
        departmentId: dutyRooms.departmentId,
        departmentName: departments.name,
        location: dutyRooms.location,
        sortOrder: dutyRooms.sortOrder,
        active: dutyRooms.active,
        note: dutyRooms.note,
        slotCount: sql<number>`(select count(*)::int from duty_slots s where s.room_id = ${dutyRooms.id})`,
      })
      .from(dutyRooms)
      .leftJoin(departments, eq(departments.id, dutyRooms.departmentId))
      .where(cond)
      .orderBy(asc(dutyRooms.sortOrder), asc(dutyRooms.code))
      .limit(pageSize)
      .offset(offset);
    return buildPage(items, total, page, pageSize);
  }

  async roomOptions() {
    const rows = await this.db.db
      .select({ id: dutyRooms.id, code: dutyRooms.code, name: dutyRooms.name, departmentId: dutyRooms.departmentId, active: dutyRooms.active })
      .from(dutyRooms)
      .orderBy(asc(dutyRooms.sortOrder), asc(dutyRooms.code));
    return rows.map((r) => ({ value: r.id, label: `${r.code} — ${r.name}`, departmentId: r.departmentId, active: r.active }));
  }

  private async assertDepartment(id: number | null | undefined) {
    if (!id) return;
    const [d] = await this.db.db.select({ id: departments.id }).from(departments).where(eq(departments.id, id)).limit(1);
    if (!d) throw new BadRequestException('Khoa không tồn tại');
  }

  private async assertUniqueCode(table: 'rooms' | 'shifts' | 'roles', code: string, exceptId?: number) {
    const t = table === 'rooms' ? dutyRooms : table === 'shifts' ? dutyShiftTypes : dutyRoles;
    const rows = await this.db.db
      .select({ id: t.id })
      .from(t)
      .where(sql`lower(${t.code}) = lower(${code})`)
      .limit(1);
    if (rows.length && rows[0].id !== exceptId) throw new ConflictException(`Mã "${code}" đã tồn tại`);
  }

  async createRoom(dto: RoomDto) {
    await this.assertUniqueCode('rooms', dto.code);
    await this.assertDepartment(dto.departmentId);
    const [row] = await this.db.db
      .insert(dutyRooms)
      .values({ code: dto.code, name: dto.name, departmentId: dto.departmentId ?? null, location: dto.location ?? '', sortOrder: dto.sortOrder ?? 0, active: dto.active ?? true, note: dto.note ?? '' })
      .returning();
    return row;
  }

  async updateRoom(id: number, dto: UpdateRoomDto) {
    const [cur] = await this.db.db.select().from(dutyRooms).where(eq(dutyRooms.id, id)).limit(1);
    if (!cur) throw new NotFoundException('Không tìm thấy phòng khám');
    if (dto.code !== undefined) await this.assertUniqueCode('rooms', dto.code, id);
    if (dto.departmentId !== undefined) await this.assertDepartment(dto.departmentId);
    const patch: Partial<typeof dutyRooms.$inferInsert> = { updatedAt: new Date() };
    if (dto.code !== undefined) patch.code = dto.code;
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.departmentId !== undefined) patch.departmentId = dto.departmentId ?? null;
    if (dto.location !== undefined) patch.location = dto.location;
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;
    if (dto.active !== undefined) patch.active = dto.active;
    if (dto.note !== undefined) patch.note = dto.note;
    const [row] = await this.db.db.update(dutyRooms).set(patch).where(eq(dutyRooms.id, id)).returning();
    return row;
  }

  async removeRoom(id: number) {
    const [{ n }] = await this.db.db.select({ n: sql<number>`count(*)::int` }).from(dutySlots).where(eq(dutySlots.roomId, id));
    if (n > 0) throw new ConflictException(`Phòng đã có ${n} ca khám — hãy tắt hoạt động thay vì xoá`);
    await this.db.db.delete(dutyRooms).where(eq(dutyRooms.id, id));
    return { ok: true };
  }

  /* ============================================================ Ca khám */

  private shiftTimes(startTime: string, endTime: string) {
    if (!HHMM.test(startTime) || !HHMM.test(endTime)) throw new BadRequestException('Giờ phải dạng HH:MM');
    if (startTime === endTime) throw new BadRequestException('Giờ bắt đầu và kết thúc không được trùng nhau');
    const crossesMidnight = endTime < startTime;
    return { crossesMidnight, isNightDefault: isNightWindow(startTime, endTime, crossesMidnight) };
  }

  async listShifts(q: CatalogQueryDto) {
    const { page, pageSize, offset } = pageOf(q);
    const like = this.like(q.q);
    const where: SQL[] = [];
    if (like) where.push(or(ilike(dutyShiftTypes.code, like), ilike(dutyShiftTypes.name, like)) as SQL);
    if (q.activeOnly) where.push(eq(dutyShiftTypes.active, true));
    const cond = where.length ? and(...where) : undefined;
    const [{ total }] = await this.db.db.select({ total: sql<number>`count(*)::int` }).from(dutyShiftTypes).where(cond);
    const items = await this.db.db
      .select({
        id: dutyShiftTypes.id,
        code: dutyShiftTypes.code,
        name: dutyShiftTypes.name,
        startTime: dutyShiftTypes.startTime,
        endTime: dutyShiftTypes.endTime,
        crossesMidnight: dutyShiftTypes.crossesMidnight,
        isNight: dutyShiftTypes.isNight,
        color: dutyShiftTypes.color,
        sortOrder: dutyShiftTypes.sortOrder,
        active: dutyShiftTypes.active,
        note: dutyShiftTypes.note,
        slotCount: sql<number>`(select count(*)::int from duty_slots s where s.shift_id = ${dutyShiftTypes.id})`,
      })
      .from(dutyShiftTypes)
      .where(cond)
      .orderBy(asc(dutyShiftTypes.sortOrder), asc(dutyShiftTypes.startTime))
      .limit(pageSize)
      .offset(offset);
    return buildPage(items, total, page, pageSize);
  }

  async shiftOptions() {
    const rows = await this.db.db
      .select({ id: dutyShiftTypes.id, code: dutyShiftTypes.code, name: dutyShiftTypes.name, startTime: dutyShiftTypes.startTime, endTime: dutyShiftTypes.endTime, isNight: dutyShiftTypes.isNight, color: dutyShiftTypes.color, active: dutyShiftTypes.active })
      .from(dutyShiftTypes)
      .orderBy(asc(dutyShiftTypes.sortOrder), asc(dutyShiftTypes.startTime));
    return rows.map((r) => ({ value: r.id, label: `${r.code} — ${r.name} (${r.startTime}–${r.endTime})`, ...r }));
  }

  async createShift(dto: ShiftDto) {
    await this.assertUniqueCode('shifts', dto.code);
    const t = this.shiftTimes(dto.startTime, dto.endTime);
    const [row] = await this.db.db
      .insert(dutyShiftTypes)
      .values({
        code: dto.code,
        name: dto.name,
        startTime: dto.startTime,
        endTime: dto.endTime,
        crossesMidnight: t.crossesMidnight,
        isNight: dto.isNight ?? t.isNightDefault,
        color: dto.color ?? '#0F766E',
        sortOrder: dto.sortOrder ?? 0,
        active: dto.active ?? true,
        note: dto.note ?? '',
      })
      .returning();
    return row;
  }

  async updateShift(id: number, dto: UpdateShiftDto) {
    const [cur] = await this.db.db.select().from(dutyShiftTypes).where(eq(dutyShiftTypes.id, id)).limit(1);
    if (!cur) throw new NotFoundException('Không tìm thấy ca khám');
    if (dto.code !== undefined) await this.assertUniqueCode('shifts', dto.code, id);
    const timeChanged =
      (dto.startTime !== undefined && dto.startTime !== cur.startTime) ||
      (dto.endTime !== undefined && dto.endTime !== cur.endTime) ||
      (dto.isNight !== undefined && dto.isNight !== cur.isNight);
    if (timeChanged) {
      const [{ n }] = await this.db.db.select({ n: sql<number>`count(*)::int` }).from(dutySlots).where(eq(dutySlots.shiftId, id));
      if (n > 0) {
        throw new ConflictException(
          `Ca đã được dùng trong ${n} ca khám — không đổi giờ hay tính chất ca đêm để giữ đúng số giờ đã ghi nhận. Hãy tắt ca này và tạo ca mới.`,
        );
      }
    }
    const start = dto.startTime ?? cur.startTime;
    const end = dto.endTime ?? cur.endTime;
    const t = this.shiftTimes(start, end);
    const patch: Partial<typeof dutyShiftTypes.$inferInsert> = {
      startTime: start,
      endTime: end,
      crossesMidnight: t.crossesMidnight,
      updatedAt: new Date(),
    };
    if (dto.code !== undefined) patch.code = dto.code;
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.isNight !== undefined) patch.isNight = dto.isNight;
    else if (dto.startTime !== undefined || dto.endTime !== undefined) patch.isNight = t.isNightDefault;
    if (dto.color !== undefined) patch.color = dto.color;
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;
    if (dto.active !== undefined) patch.active = dto.active;
    if (dto.note !== undefined) patch.note = dto.note;
    const [row] = await this.db.db.update(dutyShiftTypes).set(patch).where(eq(dutyShiftTypes.id, id)).returning();
    return row;
  }

  async removeShift(id: number) {
    const [{ n }] = await this.db.db.select({ n: sql<number>`count(*)::int` }).from(dutySlots).where(eq(dutySlots.shiftId, id));
    if (n > 0) throw new ConflictException(`Ca đã được dùng trong ${n} ca khám — hãy tắt hoạt động thay vì xoá`);
    await this.db.db.delete(dutyShiftTypes).where(eq(dutyShiftTypes.id, id));
    return { ok: true };
  }

  /* ============================================================ Vai trò khám */

  async listRoles(q: CatalogQueryDto) {
    const { page, pageSize, offset } = pageOf(q);
    const like = this.like(q.q);
    const where: SQL[] = [];
    if (like) where.push(or(ilike(dutyRoles.code, like), ilike(dutyRoles.name, like), ilike(dutyRoles.requiredTitle, like)) as SQL);
    if (q.activeOnly) where.push(eq(dutyRoles.active, true));
    const cond = where.length ? and(...where) : undefined;
    const [{ total }] = await this.db.db.select({ total: sql<number>`count(*)::int` }).from(dutyRoles).where(cond);
    const items = await this.db.db
      .select({
        id: dutyRoles.id,
        code: dutyRoles.code,
        name: dutyRoles.name,
        requiredTitle: dutyRoles.requiredTitle,
        sortOrder: dutyRoles.sortOrder,
        active: dutyRoles.active,
        note: dutyRoles.note,
        slotCount: sql<number>`(select count(*)::int from duty_slots s where s.role_id = ${dutyRoles.id})`,
      })
      .from(dutyRoles)
      .where(cond)
      .orderBy(asc(dutyRoles.sortOrder), asc(dutyRoles.code))
      .limit(pageSize)
      .offset(offset);
    return buildPage(items, total, page, pageSize);
  }

  async roleOptions() {
    const rows = await this.db.db
      .select({ id: dutyRoles.id, code: dutyRoles.code, name: dutyRoles.name, requiredTitle: dutyRoles.requiredTitle, active: dutyRoles.active })
      .from(dutyRoles)
      .orderBy(asc(dutyRoles.sortOrder), asc(dutyRoles.code));
    return rows.map((r) => ({ value: r.id, label: `${r.name}${r.requiredTitle ? ` (${r.requiredTitle})` : ''}`, ...r }));
  }

  private async assertTitle(title: string | undefined) {
    if (!title) return;
    const [t] = await this.db.db.select({ id: jobTitles.id }).from(jobTitles).where(sql`lower(${jobTitles.name}) = lower(${title})`).limit(1);
    if (!t) throw new BadRequestException(`Chức danh "${title}" chưa có trong danh mục chức danh`);
  }

  async createRole(dto: RoleDto) {
    await this.assertUniqueCode('roles', dto.code);
    await this.assertTitle(dto.requiredTitle);
    const [row] = await this.db.db
      .insert(dutyRoles)
      .values({ code: dto.code, name: dto.name, requiredTitle: dto.requiredTitle ?? '', sortOrder: dto.sortOrder ?? 0, active: dto.active ?? true, note: dto.note ?? '' })
      .returning();
    return row;
  }

  async updateRole(id: number, dto: UpdateRoleDto) {
    const [cur] = await this.db.db.select().from(dutyRoles).where(eq(dutyRoles.id, id)).limit(1);
    if (!cur) throw new NotFoundException('Không tìm thấy vai trò khám');
    if (dto.code !== undefined) await this.assertUniqueCode('roles', dto.code, id);
    await this.assertTitle(dto.requiredTitle);
    if (dto.requiredTitle !== undefined && dto.requiredTitle !== cur.requiredTitle) {
      const [{ n }] = await this.db.db.select({ n: sql<number>`count(*)::int` }).from(dutySlots).where(eq(dutySlots.roleId, id));
      if (n > 0) {
        throw new ConflictException(
          `Vai trò đã dùng trong ${n} ca khám — không đổi chức danh yêu cầu để không làm sai các phân công hiện có. Hãy tạo vai trò mới.`,
        );
      }
    }
    const patch: Partial<typeof dutyRoles.$inferInsert> = { updatedAt: new Date() };
    if (dto.code !== undefined) patch.code = dto.code;
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.requiredTitle !== undefined) patch.requiredTitle = dto.requiredTitle;
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;
    if (dto.active !== undefined) patch.active = dto.active;
    if (dto.note !== undefined) patch.note = dto.note;
    const [row] = await this.db.db.update(dutyRoles).set(patch).where(eq(dutyRoles.id, id)).returning();
    return row;
  }

  async removeRole(id: number) {
    const [{ n }] = await this.db.db.select({ n: sql<number>`count(*)::int` }).from(dutySlots).where(eq(dutySlots.roleId, id));
    if (n > 0) throw new ConflictException(`Vai trò đã được dùng trong ${n} ca khám — hãy tắt hoạt động thay vì xoá`);
    await this.db.db.delete(dutyRoles).where(eq(dutyRoles.id, id));
    return { ok: true };
  }

  /* ============================================================ Ngày nghỉ */

  async listClosedDays(q: CatalogQueryDto) {
    const { page, pageSize, offset } = pageOf(q);
    const like = this.like(q.q);
    const cond = like ? or(ilike(dutyClosedDays.name, like), ilike(dutyClosedDays.note, like)) : undefined;
    const [{ total }] = await this.db.db.select({ total: sql<number>`count(*)::int` }).from(dutyClosedDays).where(cond);
    const items = await this.db.db
      .select()
      .from(dutyClosedDays)
      .where(cond)
      .orderBy(asc(dutyClosedDays.date))
      .limit(pageSize)
      .offset(offset);
    return buildPage(items, total, page, pageSize);
  }

  private async assertDate(date: string, exceptId?: number) {
    const [d] = await this.db.db.select({ id: dutyClosedDays.id }).from(dutyClosedDays).where(eq(dutyClosedDays.date, date)).limit(1);
    if (d && d.id !== exceptId) throw new ConflictException(`Ngày ${date} đã có trong danh mục ngày nghỉ`);
  }

  /** Ngày đã có ca khám thì không được đánh dấu là ngày nghỉ (tránh lịch mâu thuẫn) */
  private async assertNoSlotsOn(date: string) {
    const [{ n }] = await this.db.db.select({ n: sql<number>`count(*)::int` }).from(dutySlots).where(eq(dutySlots.dutyDate, date));
    if (n > 0) throw new ConflictException(`Ngày ${fmtDm(date)} đã có ${n} ca khám — hãy xoá các ca khám đó trước khi đánh dấu ngày nghỉ`);
  }

  async createClosedDay(dto: ClosedDayDto) {
    await this.assertDate(dto.date);
    await this.assertNoSlotsOn(dto.date);
    const [row] = await this.db.db.insert(dutyClosedDays).values({ date: dto.date, name: dto.name, note: dto.note ?? '' }).returning();
    return row;
  }

  async updateClosedDay(id: number, dto: UpdateClosedDayDto) {
    const [cur] = await this.db.db.select().from(dutyClosedDays).where(eq(dutyClosedDays.id, id)).limit(1);
    if (!cur) throw new NotFoundException('Không tìm thấy ngày nghỉ');
    if (dto.date !== undefined) {
      await this.assertDate(dto.date, id);
      await this.assertNoSlotsOn(dto.date);
    }
    const [row] = await this.db.db
      .update(dutyClosedDays)
      .set({ ...(dto.date !== undefined ? { date: dto.date } : {}), ...(dto.name !== undefined ? { name: dto.name } : {}), ...(dto.note !== undefined ? { note: dto.note } : {}) })
      .where(eq(dutyClosedDays.id, id))
      .returning();
    return row;
  }

  async removeClosedDay(id: number) {
    await this.db.db.delete(dutyClosedDays).where(eq(dutyClosedDays.id, id));
    return { ok: true };
  }
}
