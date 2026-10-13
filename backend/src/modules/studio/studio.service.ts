/**
 * Studio — CRUD trang dashboard/báo cáo tùy biến.
 * Quy tắc sở hữu:
 *  - PERSONAL : chỉ chủ sở hữu xem/sửa/xóa (quản trị tối cao ngoại lệ).
 *  - ROLE     : mọi thành viên vai trò xem; chỉ quản trị (SUPER_ADMIN/ADMIN) sửa.
 *  - SYSTEM   : mọi người (đủ quyền studio) xem; chỉ quản trị sửa/xóa.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import {
  roles,
  studioDashboards,
  StudioKind,
  StudioScope,
  type StudioLayout,
  type StudioWidget,
} from '../../db/schema';
import type { AccessContext } from '../../common/types/access-context';
import { STUDIO_BUILTINS, STUDIO_WIDGET_TYPES, type StudioDataSpec } from './studio.types';
import { StudioQueryService } from './studio-query.service';

export type StudioRow = typeof studioDashboards.$inferSelect;

export interface StudioSavePayload {
  name?: string;
  description?: string;
  scope?: StudioScope;
  roleCode?: string;
  kind?: StudioKind;
  layout?: StudioLayout;
}

const MAX_WIDGETS = 40;
/** Mã trang khoá — không cho xóa */
const PROTECTED_CODES = ['DASH_TONG_QUAN'];

@Injectable()
export class StudioService {
  constructor(
    private readonly db: DbService,
    private readonly engine: StudioQueryService,
  ) {}

  isStudioAdmin(user: AccessContext): boolean {
    return user.isSuperAdmin || user.roles.includes('ADMIN');
  }

  /* -------------------------------------------------------------- Đọc */

  /** Danh sách trang người này được thấy (PERSONAL của họ + ROLE của họ + SYSTEM) */
  async list(user: AccessContext, kind: StudioKind): Promise<StudioRow[]> {
    const rows = await this.db.db
      .select()
      .from(studioDashboards)
      .where(and(eq(studioDashboards.kind, kind), isNull(studioDashboards.deletedAt)))
      .orderBy(desc(studioDashboards.isDefault), desc(studioDashboards.updatedAt));
    return rows.filter((r) => this.canView(user, r));
  }

  canView(user: AccessContext, row: StudioRow): boolean {
    if (this.isStudioAdmin(user)) return true;
    if (row.scope === StudioScope.PERSONAL) return row.ownerId === user.id;
    if (row.scope === StudioScope.ROLE) return user.roles.includes(row.roleCode);
    return true; // SYSTEM
  }

  canEdit(user: AccessContext, row: StudioRow): boolean {
    if (this.isStudioAdmin(user)) return true;
    if (row.scope === StudioScope.PERSONAL) return row.ownerId === user.id;
    return false;
  }

  async get(user: AccessContext, id: number): Promise<StudioRow> {
    const [row] = await this.db.db
      .select()
      .from(studioDashboards)
      .where(and(eq(studioDashboards.id, id), isNull(studioDashboards.deletedAt)));
    if (!row) throw new NotFoundException('Không tìm thấy trang');
    if (!this.canView(user, row)) {
      throw new ForbiddenException('Trang này thuộc sở hữu riêng của người khác');
    }
    return row;
  }

  /** Trang mặc định theo thứ tự ưu tiên: cá nhân → vai trò → hệ thống */
  async defaultFor(user: AccessContext, kind: StudioKind): Promise<StudioRow | null> {
    const base = and(eq(studioDashboards.kind, kind), eq(studioDashboards.isDefault, true), isNull(studioDashboards.deletedAt));
    const [personal] = await this.db.db
      .select().from(studioDashboards)
      .where(and(base, eq(studioDashboards.scope, StudioScope.PERSONAL), eq(studioDashboards.ownerId, user.id)))
      .limit(1);
    if (personal) return personal;
    if (user.roles.length) {
      const [forRole] = await this.db.db
        .select().from(studioDashboards)
        .where(and(base, eq(studioDashboards.scope, StudioScope.ROLE), inArray(studioDashboards.roleCode, user.roles)))
        .orderBy(desc(studioDashboards.updatedAt)).limit(1);
      if (forRole) return forRole;
    }
    const [system] = await this.db.db
      .select().from(studioDashboards)
      .where(and(base, eq(studioDashboards.scope, StudioScope.SYSTEM)))
      .orderBy(desc(studioDashboards.updatedAt)).limit(1);
    if (system) return system;

    // Tự động dự phòng: Nếu không có trang nào có isDefault = true (ví dụ người dùng vừa bấm "Bỏ mặc định"):
    // 1. Tìm trang hệ thống đầu tiên còn hoạt động
    const [fallbackSystem] = await this.db.db
      .select().from(studioDashboards)
      .where(and(eq(studioDashboards.kind, kind), eq(studioDashboards.scope, StudioScope.SYSTEM), isNull(studioDashboards.deletedAt)))
      .orderBy(asc(studioDashboards.id)).limit(1);
    if (fallbackSystem) return fallbackSystem;

    // 2. Hoặc trang bất kỳ còn hoạt động của loại này
    const [anyPage] = await this.db.db
      .select().from(studioDashboards)
      .where(and(eq(studioDashboards.kind, kind), isNull(studioDashboards.deletedAt)))
      .orderBy(asc(studioDashboards.id)).limit(1);
    return anyPage ?? null;
  }

  /* -------------------------------------------------------------- Ghi */

  private async genCode(kind: StudioKind): Promise<string> {
    const prefix = kind === StudioKind.REPORT ? 'BC' : 'DB';
    for (let i = 0; i < 8; i++) {
      const candidate = `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const [dup] = await this.db.db
        .select({ id: studioDashboards.id }).from(studioDashboards)
        .where(eq(studioDashboards.code, candidate)).limit(1);
      if (!dup) return candidate;
    }
    return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
  }

  private async assertRoleScopeAllowed(user: AccessContext, scope: StudioScope, roleCode: string): Promise<void> {
    if (scope === StudioScope.PERSONAL) return;
    if (!this.isStudioAdmin(user)) {
      throw new ForbiddenException('Chỉ quản trị viên mới tạo/sửa trang dùng chung (vai trò/hệ thống)');
    }
    if (scope === StudioScope.ROLE) {
      const [role] = await this.db.db.select({ id: roles.id }).from(roles).where(eq(roles.code, roleCode));
      if (!role) throw new BadRequestException(`Vai trò \"${roleCode}\" không tồn tại`);
    }
  }

  /** Kiểm tra bố cục: widget hợp lệ + chạy thử dataSpec (limit 1) qua engine */
  private async validateLayout(user: AccessContext, layout: StudioLayout): Promise<StudioLayout> {
    if (!layout || !Array.isArray(layout.widgets)) {
      throw new BadRequestException('Bố cục không hợp lệ');
    }
    if (layout.widgets.length > MAX_WIDGETS) {
      throw new BadRequestException(`Một trang tối đa ${MAX_WIDGETS} ô`);
    }
    const widgets: StudioWidget[] = [];
    for (const raw of layout.widgets) {
      const w = this.validateWidget(user, raw);
      widgets.push(w);
    }
    // Chạy thử song song các dataSpec (limit 1) để bắt lỗi cấu hình ngay khi lưu
    const trials = widgets
      .filter((w) => w.dataSpec?.source)
      .map(async (w) => {
        try {
          await this.engine.run({ ...w.dataSpec, source: w.dataSpec!.source!, limit: 1 } as StudioDataSpec, user);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new BadRequestException(`Ô \"${w.title || w.type}\": ${msg}`);
        }
      });
    await Promise.all(trials);
    return { widgets };
  }

  private validateWidget(user: AccessContext, raw: Partial<StudioWidget>): StudioWidget {
    const type = String(raw.type ?? '');
    if (!STUDIO_WIDGET_TYPES.includes(type as never)) {
      throw new BadRequestException(`Loại ô \"${type}\" không hỗ trợ`);
    }
    const w: StudioWidget = {
      id: String(raw.id || `w${Math.random().toString(36).slice(2, 9)}`),
      type,
      title: String(raw.title ?? '').slice(0, 120),
      w: Math.min(Math.max(Math.round(Number(raw.w) || 6), 2), 12),
      h: raw.h === 'S' || raw.h === 'L' ? raw.h : 'M',
    };
    if (type === 'builtin') {
      const builtin = String(raw.builtin ?? '');
      if (!STUDIO_BUILTINS.includes(builtin as never)) {
        throw new BadRequestException(`Ô tích hợp \"${builtin}\" không tồn tại`);
      }
      w.builtin = builtin;
      return w;
    }
    if (type === 'text') {
      w.options = { text: String((raw.options as { text?: unknown })?.text ?? '').slice(0, 2000) };
      return w;
    }
    // Ô dữ liệu: phải có nguồn
    const spec = raw.dataSpec;
    if (!spec?.source) {
      throw new BadRequestException(`Ô \"${w.title || type}\" chưa chọn nguồn dữ liệu`);
    }
    if (!spec.metrics?.length) {
      throw new BadRequestException(`Ô \"${w.title || type}\" cần ít nhất một chỉ số`);
    }
    w.dataSpec = {
      source: String(spec.source),
      metrics: spec.metrics.slice(0, 4),
      dimensions: spec.dimensions?.slice(0, 2),
      filters: spec.filters?.slice(0, 10),
      dateRange: spec.dateRange,
      orderBy: spec.orderBy?.slice(0, 3),
      limit: spec.limit === undefined ? undefined : Math.min(Math.max(Number(spec.limit) || 50, 1), 500),
    };
    if (raw.options && typeof raw.options === 'object') w.options = raw.options as Record<string, unknown>;
    return w;
  }

  async create(user: AccessContext, payload: StudioSavePayload): Promise<StudioRow> {
    const kind = payload.kind === StudioKind.REPORT ? StudioKind.REPORT : StudioKind.DASHBOARD;
    const name = String(payload.name ?? '').trim().slice(0, 160);
    if (!name) throw new BadRequestException('Cần đặt tên trang');
    const scope = payload.scope ?? StudioScope.PERSONAL;
    const roleCode = scope === StudioScope.ROLE ? String(payload.roleCode ?? '') : '';
    await this.assertRoleScopeAllowed(user, scope, roleCode);
    const layout = await this.validateLayout(user, payload.layout ?? { widgets: [] });

    const [row] = await this.db.db
      .insert(studioDashboards).values({
        code: await this.genCode(kind),
        name,
        description: String(payload.description ?? '').slice(0, 500),
        kind, scope, roleCode,
        ownerId: scope === StudioScope.PERSONAL ? user.id : null,
        layout,
        createdBy: user.id, updatedBy: user.id,
      }).returning();
    return row;
  }

  async update(user: AccessContext, id: number, payload: StudioSavePayload): Promise<StudioRow> {
    const row = await this.get(user, id);
    if (!this.canEdit(user, row)) throw new ForbiddenException('Bạn không được sửa trang này');

    const patch: Partial<typeof studioDashboards.$inferInsert> = { updatedBy: user.id, updatedAt: new Date() };
    if (payload.name !== undefined) {
      const name = String(payload.name).trim().slice(0, 160);
      if (!name) throw new BadRequestException('Tên trang không được trống');
      patch.name = name;
    }
    if (payload.description !== undefined) patch.description = String(payload.description).slice(0, 500);
    if (payload.scope !== undefined) {
      const roleCode = payload.scope === StudioScope.ROLE ? String(payload.roleCode ?? row.roleCode) : '';
      await this.assertRoleScopeAllowed(user, payload.scope, roleCode);
      patch.scope = payload.scope;
      patch.roleCode = roleCode;
      patch.ownerId = payload.scope === StudioScope.PERSONAL ? user.id : null;
    }
    if (payload.layout) patch.layout = await this.validateLayout(user, payload.layout);

    const [updated] = await this.db.db
      .update(studioDashboards).set(patch)
      .where(eq(studioDashboards.id, row.id)).returning();
    return updated;
  }

  async duplicate(user: AccessContext, id: number): Promise<StudioRow> {
    const row = await this.get(user, id);
    const [copy] = await this.db.db
      .insert(studioDashboards).values({
        code: await this.genCode(row.kind),
        name: `${row.name} (bản sao)`.slice(0, 160),
        description: row.description,
        kind: row.kind,
        scope: StudioScope.PERSONAL,
        ownerId: user.id,
        layout: row.layout,
        createdBy: user.id, updatedBy: user.id,
      }).returning();
    return copy;
  }

  /** Đặt / bỏ mặc định trong phạm vi của trang (transaction — DB_POOL_MAX=1 nên dùng tx) */
  async setDefault(user: AccessContext, id: number, value: boolean): Promise<StudioRow> {
    const row = await this.get(user, id);
    if (row.scope === StudioScope.PERSONAL ? row.ownerId !== user.id && !this.isStudioAdmin(user) : !this.isStudioAdmin(user)) {
      throw new ForbiddenException('Bạn không được đổi mặc định trang này');
    }
    return this.db.db.transaction(async (tx) => {
      if (value) {
        const peer = and(
          eq(studioDashboards.kind, row.kind),
          eq(studioDashboards.scope, row.scope),
          ne(studioDashboards.id, row.id),
          isNull(studioDashboards.deletedAt),
          row.scope === StudioScope.PERSONAL ? eq(studioDashboards.ownerId, row.ownerId ?? 0) : undefined,
          row.scope === StudioScope.ROLE ? eq(studioDashboards.roleCode, row.roleCode) : undefined,
        );
        await tx.update(studioDashboards).set({ isDefault: false }).where(peer!);
      }
      const [updated] = await tx.update(studioDashboards)
        .set({ isDefault: value, updatedBy: user.id, updatedAt: new Date() })
        .where(eq(studioDashboards.id, row.id)).returning();
      return updated;
    });
  }

  async remove(user: AccessContext, id: number): Promise<{ id: number }> {
    const row = await this.get(user, id);
    if (!this.canEdit(user, row)) throw new ForbiddenException('Bạn không được xóa trang này');
    if (PROTECTED_CODES.includes(row.code)) {
      throw new BadRequestException('Đây là trang mặc định của hệ thống — chỉ được sửa, không xóa');
    }
    await this.db.db.update(studioDashboards)
      .set({ deletedAt: new Date(), updatedBy: user.id, updatedAt: new Date() })
      .where(eq(studioDashboards.id, row.id));
    return { id: row.id };
  }
}
