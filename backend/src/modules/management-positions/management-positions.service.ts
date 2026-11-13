/** Danh mục chức vụ quản lý/kiêm nhiệm; người dùng liên kết qua user_management_positions. */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { buildPage, type Paginated } from '../../common/dto/query.dto';
import { DbService } from '../../db/db.service';
import { managementPositions, userManagementPositions, users } from '../../db/schema';
import type { CreateManagementPositionDto, ManagementPositionQueryDto, UpdateManagementPositionDto } from './management-positions.dto';

const SORTABLE = {
  code: managementPositions.code,
  name: managementPositions.name,
  sortOrder: managementPositions.sortOrder,
  createdAt: managementPositions.createdAt,
} as const;

@Injectable()
export class ManagementPositionsService {
  constructor(private readonly db: DbService) {}

  private userCountExpr() {
    return sql<number>`(select count(*)::int from ${userManagementPositions} ump join ${users} u on u.id = ump.user_id where ump.management_position_id = ${managementPositions.id} and u.deleted_at is null)`;
  }

  async list(query: ManagementPositionQueryDto): Promise<Paginated<Record<string, unknown>>> {
    const where: SQL[] = [];
    if (query.q?.trim()) {
      const like = `%${query.q.trim()}%`;
      where.push(or(ilike(managementPositions.name, like), ilike(managementPositions.code, like), ilike(managementPositions.note, like)) as SQL);
    }
    if (query.activeOnly) where.push(eq(managementPositions.active, true));
    const condition = where.length ? and(...where) : undefined;
    const [{ total } = { total: 0 }] = await this.db.db.select({ total: sql<number>`count(*)::int` }).from(managementPositions).where(condition);
    const sortCol = SORTABLE[(query.sortBy ?? '') as keyof typeof SORTABLE];
    const order = sortCol ? [query.sortDir === 'asc' ? asc(sortCol) : desc(sortCol)] : [asc(managementPositions.sortOrder), asc(managementPositions.name)];
    const page = Math.max(1, query.page ?? 1);
    const pageSize = query.all ? 10_000 : Math.min(500, Math.max(1, query.pageSize ?? 20));
    const rows = await this.db.db
      .select({
        id: managementPositions.id,
        code: managementPositions.code,
        name: managementPositions.name,
        sortOrder: managementPositions.sortOrder,
        active: managementPositions.active,
        note: managementPositions.note,
        userCount: this.userCountExpr(),
        createdAt: managementPositions.createdAt,
        updatedAt: managementPositions.updatedAt,
      })
      .from(managementPositions)
      .where(condition)
      .orderBy(...order)
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return buildPage(rows, total, page, pageSize);
  }

  /** Danh sách gọn cho ô chọn nhiều chức vụ, sắp theo sort_order. */
  options() {
    return this.db.db
      .select({ id: managementPositions.id, code: managementPositions.code, name: managementPositions.name, sortOrder: managementPositions.sortOrder })
      .from(managementPositions)
      .where(eq(managementPositions.active, true))
      .orderBy(asc(managementPositions.sortOrder), asc(managementPositions.name));
  }

  async findOne(id: number) {
    const [row] = await this.db.db.select().from(managementPositions).where(eq(managementPositions.id, id)).limit(1);
    if (!row) throw new NotFoundException('Không tìm thấy chức vụ');
    return row;
  }

  private async assertUnique(code: string | undefined, name: string | undefined, exceptId?: number) {
    const conditions: SQL[] = [];
    if (code) conditions.push(eq(sql`lower(${managementPositions.code})`, code.toLowerCase()));
    if (name) conditions.push(eq(sql`lower(${managementPositions.name})`, name.toLowerCase()));
    if (!conditions.length) return;
    const condition = exceptId ? and(or(...conditions), ne(managementPositions.id, exceptId)) : or(...conditions);
    const [duplicate] = await this.db.db.select({ code: managementPositions.code, name: managementPositions.name }).from(managementPositions).where(condition).limit(1);
    if (!duplicate) return;
    if (code && duplicate.code.toLowerCase() === code.toLowerCase()) throw new ConflictException(`Mã chức vụ "${code}" đã tồn tại`);
    throw new ConflictException(`Chức vụ "${duplicate.name}" đã tồn tại`);
  }

  async create(dto: CreateManagementPositionDto) {
    const code = dto.code.trim().toUpperCase();
    const name = dto.name.trim();
    await this.assertUnique(code, name);
    let sortOrder = dto.sortOrder;
    if (sortOrder === undefined) {
      const [max] = await this.db.db.select({ max: sql<number>`coalesce(max(${managementPositions.sortOrder}), 0)::int` }).from(managementPositions);
      sortOrder = (max?.max ?? 0) + 1;
    }
    const [row] = await this.db.db.insert(managementPositions).values({ code, name, sortOrder, active: dto.active ?? true, note: dto.note ?? '' }).returning();
    return row;
  }

  /** Đồng bộ chuỗi tương thích users.management_position sau đổi tên/thứ tự danh mục. */
  private async refreshLegacyDisplay(positionId: number) {
    const linkedUsers = this.db.db.select({ userId: userManagementPositions.userId }).from(userManagementPositions).where(eq(userManagementPositions.managementPositionId, positionId));
    await this.db.db
      .update(users)
      .set({
        managementPosition: sql<string>`coalesce((select string_agg(mp.name, '; ' order by mp.sort_order, mp.name) from user_management_positions ump join management_positions mp on mp.id = ump.management_position_id where ump.user_id = ${users.id}), '')`,
        updatedAt: new Date(),
      })
      .where(inArray(users.id, linkedUsers));
  }

  async update(id: number, dto: UpdateManagementPositionDto) {
    await this.findOne(id);
    const code = dto.code?.trim().toUpperCase();
    const name = dto.name?.trim();
    await this.assertUnique(code, name, id);
    const [row] = await this.db.db
      .update(managementPositions)
      .set({
        ...(code ? { code } : {}),
        ...(name ? { name } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        updatedAt: new Date(),
      })
      .where(eq(managementPositions.id, id))
      .returning();
    if (name !== undefined || dto.sortOrder !== undefined) await this.refreshLegacyDisplay(id);
    return row;
  }

  async remove(id: number) {
    const current = await this.findOne(id);
    const [{ total } = { total: 0 }] = await this.db.db.select({ total: sql<number>`count(*)::int` }).from(userManagementPositions).where(eq(userManagementPositions.managementPositionId, id));
    if (total > 0) throw new ConflictException(`Đang có ${total} người dùng mang chức vụ "${current.name}" — hãy gỡ chức vụ khỏi hồ sơ hoặc tắt "Đang sử dụng"`);
    await this.db.db.delete(managementPositions).where(eq(managementPositions.id, id));
    return { message: `Đã xoá chức vụ "${current.name}"` };
  }
}
