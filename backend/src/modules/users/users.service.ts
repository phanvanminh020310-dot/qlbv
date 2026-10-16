/**
 * Quản lý người dùng — tạo/sửa/xoá, gán vai trò, gán phạm vi khoa, đặt lại mật khẩu.
 * Mọi thao tác đều xoá cache quyền để có hiệu lực tức thì.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { config } from '../../config/env';
import { DbService } from '../../db/db.service';
import { SettingsService } from '../settings/settings.service';
import {
  departments,
  loginLogs,
  permissions,
  rolePermissions,
  roles,
  userDepartmentScopes,
  userRoles,
  users,
} from '../../db/schema';
import { buildPage, type Paginated, parseFilters } from '../../common/dto/query.dto';
import { SUPER_ADMIN_ROLE, type AccessContext } from '../../common/types/access-context';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { DUTY_STAFF_ROLE_CODE, isDoctorTitle } from './duty-staff-role';
import type {
  CreateUserDto,
  ResetPasswordDto,
  SetDepartmentScopesDto,
  SetRolesDto,
  UpdateUserDto,
  UserQueryDto,
} from './dto/user.dto';

const DEFAULT_RESET_PASSWORD = '1'; // Mật khẩu mặc định khi tạo/đặt lại tài khoản mà không nhập mật khẩu

import { pushFilters, type FilterTarget } from '../../common/filters/apply-filter';
/** Trường lọc nâng cao của danh sách người dùng. */
const USER_FILTERS: Record<string, FilterTarget> = {
  username: { expr: users.username, type: 'text' },
  fullName: { expr: users.fullName, type: 'text' },
  title: { expr: users.title, type: 'text' },
  active: { expr: users.active, type: 'bool' },
};

/** Các cột cho phép sắp xếp ở danh sách người dùng (chống SQL injection qua tên trường) */
const USER_SORTABLE = {
  username: users.username,
  fullName: users.fullName,
  title: users.title,
  email: users.email,
  phone: users.phone,
  departmentName: departments.name,
  active: users.active,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
} as const;

/** Thứ tự: mặc định = đang dùng trước + tên; có yêu cầu thì theo cột, kèm tiebreak ổn định */
function userOrderBy(query: { sortBy?: string; sortDir?: 'asc' | 'desc' }) {
  const col = USER_SORTABLE[(query.sortBy ?? '') as keyof typeof USER_SORTABLE];
  if (!col) return [desc(users.active), asc(users.fullName)];
  const dir = query.sortDir === 'desc' ? desc : asc;
  return [dir(col), asc(users.id)];
}

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DbService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async list(query: UserQueryDto): Promise<Paginated<Record<string, unknown>>> {
    const where: SQL[] = [];
    if (!query.includeDeleted) where.push(isNull(users.deletedAt));
    if (query.activeOnly) where.push(eq(users.active, true));
    if (query.active !== undefined) where.push(eq(users.active, query.active));
    if (query.departmentId !== undefined) where.push(eq(users.departmentId, query.departmentId));
    if (query.departmentIds?.length) {
      where.push(inArray(users.departmentId, query.departmentIds.map(Number)));
    }
    if (query.q?.trim()) {
      const like = `%${query.q.trim()}%`;
      where.push(
        or(
          ilike(users.fullName, like),
          ilike(users.username, like),
          ilike(users.title, like),
          ilike(users.email, like),
          ilike(users.phone, like),
        ) as SQL,
      );
    }
    pushFilters(where, parseFilters(query.filters), USER_FILTERS);

    if (query.roleCode) {
      const sub = this.db.db
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(eq(roles.code, query.roleCode));
      where.push(inArray(users.id, sub));
    }

    const condition = where.length ? and(...where) : undefined;

    const [countRow] = await this.db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(users)
      .where(condition);

    const rows = await this.db.db
      .select({
        id: users.id,
        username: users.username,
        fullName: users.fullName,
        title: users.title,
        email: users.email,
        phone: users.phone,
        departmentId: users.departmentId,
        departmentName: departments.name,
        active: users.active,
        mustChangePassword: users.mustChangePassword,
        twoFactorEnabled: users.twoFactorEnabled,
        lastLoginAt: users.lastLoginAt,
        lockedUntil: users.lockedUntil,
        failedLoginCount: users.failedLoginCount,
        note: users.note,
        createdAt: users.createdAt,
        roles: sql<string>`coalesce((
          select string_agg(r.name || '|' || r.code || '|' || r.color, ';;' order by r.priority)
          from user_roles ur join roles r on r.id = ur.role_id
          where ur.user_id = ${users.id}
        ), '')`,
      })
      .from(users)
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(condition)
      .orderBy(...userOrderBy(query))
      .limit(query.limit)
      .offset(query.offset);

    const items = rows.map((r) => {
      const roleList = r.roles
        ? r.roles.split(';;').map((chunk) => {
            const [name = '', code = '', color = '#0ea5e9'] = chunk.split('|');
            return { name, code, color };
          })
        : [];
      const { roles: _raw, ...rest } = r;
      return { ...rest, roles: roleList };
    });

    return buildPage(items, countRow?.total ?? 0, query.page, query.pageSize);
  }

  async findOne(id: number) {
    const [user] = await this.db.db
      .select({
        id: users.id,
        username: users.username,
        fullName: users.fullName,
        title: users.title,
        email: users.email,
        phone: users.phone,
        avatar: users.avatar,
        signatureImage: users.signatureImage,
        departmentId: users.departmentId,
        departmentName: departments.name,
        active: users.active,
        mustChangePassword: users.mustChangePassword,
        twoFactorEnabled: users.twoFactorEnabled,
        lastLoginAt: users.lastLoginAt,
        lockedUntil: users.lockedUntil,
        note: users.note,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(eq(users.id, id))
      .limit(1);
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    const userRoleList = await this.db.db
      .select({ id: roles.id, code: roles.code, name: roles.name, color: roles.color, dataScope: roles.dataScope })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, id));

    const scopes = await this.db.db
      .select({ id: departments.id, code: departments.code, name: departments.name })
      .from(userDepartmentScopes)
      .innerJoin(departments, eq(departments.id, userDepartmentScopes.departmentId))
      .where(eq(userDepartmentScopes.userId, id));

    const recentLogins = await this.db.db
      .select({
        success: loginLogs.success,
        ip: loginLogs.ip,
        userAgent: loginLogs.userAgent,
        reason: loginLogs.reason,
        createdAt: loginLogs.createdAt,
      })
      .from(loginLogs)
      .where(eq(loginLogs.userId, id))
      .orderBy(desc(loginLogs.createdAt))
      .limit(10);

    return { ...user, roles: userRoleList, departmentScopes: scopes, recentLogins };
  }

  private async resolveRoleIds(codes: string[]): Promise<number[]> {
    if (codes.length === 0) return [];
    const rows = await this.db.db
      .select({ id: roles.id, code: roles.code })
      .from(roles)
      .where(inArray(roles.code, codes));
    const found = new Set(rows.map((r) => r.code));
    const missing = codes.filter((c) => !found.has(c));
    if (missing.length > 0) throw new BadRequestException(`Vai trò không tồn tại: ${missing.join(', ')}`);
    return rows.map((r) => r.id);
  }

  async create(dto: CreateUserDto, actor: AccessContext) {
    const roleCodes = [...new Set([...(dto.roleCodes ?? []), ...(isDoctorTitle(dto.title) ? [DUTY_STAFF_ROLE_CODE] : [])])];
    // Chặn leo thang: người tạo tài khoản có vai SUPER_ADMIN chỉ khi chính họ là SUPER_ADMIN
    if (!actor.isSuperAdmin && roleCodes.includes(SUPER_ADMIN_ROLE)) {
      throw new ForbiddenException('Chỉ Quản trị tối cao mới tạo được tài khoản có vai trò Quản trị tối cao');
    }
    const username = dto.username.trim().toLowerCase();
    const dup = await this.db.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, username), isNull(users.deletedAt)))
      .limit(1);
    if (dup.length > 0) throw new ConflictException(`Tên đăng nhập "${username}" đã tồn tại`);

    // Độ dài mật khẩu tối thiểu theo cấu hình hệ thống (DTO chỉ chặn chuỗi rỗng)
    if (dto.password !== undefined) {
      const minLen = await this.settings.passwordMinLength();
      if (dto.password.length < minLen) {
        throw new BadRequestException(`Mật khẩu phải có ít nhất ${minLen} ký tự`);
      }
    }

    const password = dto.password ?? DEFAULT_RESET_PASSWORD;
    const [created] = await this.db.db
      .insert(users)
      .values({
        username,
        passwordHash: await this.auth.hashPassword(password),
        fullName: dto.fullName.trim(),
        title: dto.title ?? '',
        email: dto.email ?? '',
        phone: dto.phone ?? '',
        departmentId: dto.departmentId ?? null,
        mustChangePassword: dto.mustChangePassword ?? true,
        note: dto.note ?? '',
        active: dto.active ?? true,
      })
      .returning();

    if (roleCodes.length) {
      const ids = await this.resolveRoleIds(roleCodes);
      if (ids.length > 0) {
        await this.db.db
          .insert(userRoles)
          .values(ids.map((roleId) => ({ userId: created.id, roleId })))
          .onConflictDoNothing();
      }
    }
    if (dto.departmentScopeIds?.length) {
      await this.db.db
        .insert(userDepartmentScopes)
        .values(dto.departmentScopeIds.map((departmentId) => ({ userId: created.id, departmentId })))
        .onConflictDoNothing();
    }

    await this.auth.invalidateUserCache(created.id);
    return { ...(await this.findOne(created.id)), initialPassword: dto.password ? undefined : password };
  }

  async update(id: number, dto: UpdateUserDto, actor: AccessContext) {
    // Tài khoản có vai SUPER_ADMIN (kể cả admin gốc) chỉ SUPER_ADMIN khác mới được sửa
    await this.assertCanTouchTarget(id, actor);
    const current = await this.findOne(id);

    if (dto.username && dto.username.toLowerCase() !== current.username) {
      const dup = await this.db.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.username, dto.username.toLowerCase()), ne(users.id, id), isNull(users.deletedAt)))
        .limit(1);
      if (dup.length > 0) throw new ConflictException(`Tên đăng nhập "${dto.username}" đã tồn tại`);
    }

    await this.db.db
      .update(users)
      .set({
        ...(dto.username !== undefined ? { username: dto.username.trim().toLowerCase() } : {}),
        ...(dto.fullName !== undefined ? { fullName: dto.fullName.trim() } : {}),
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.departmentId !== undefined ? { departmentId: dto.departmentId ?? null } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.mustChangePassword !== undefined ? { mustChangePassword: dto.mustChangePassword } : {}),
        ...(dto.password ? { passwordHash: await this.auth.hashPassword(dto.password) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));

    if (dto.roleCodes) await this.setRoles(id, { roleCodes: dto.roleCodes, replace: true }, actor);
    else await this.assignDutyStaffRoleIfDoctor(id, dto.title ?? current.title);
    if (dto.departmentScopeIds) await this.setDepartmentScopes(id, { departmentIds: dto.departmentScopeIds });

    await this.auth.invalidateUserCache(id);
    if (dto.password) await this.auth.revokeAllSessions(id);
    return this.findOne(id);
  }


  /** Bác sĩ luôn được bổ sung vai trò xem lịch trực; không tự gỡ vai trò khác. */
  private async assignDutyStaffRoleIfDoctor(userId: number, title: string | null | undefined): Promise<void> {
    if (!isDoctorTitle(title)) return;
    const [role] = await this.db.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, DUTY_STAFF_ROLE_CODE))
      .limit(1);
    if (!role) return;
    await this.db.db
      .insert(userRoles)
      .values({ userId, roleId: role.id })
      .onConflictDoNothing();
  }

  /** Xoá mềm — giữ lại lịch sử thao tác của người dùng */

  /** Chặn can thiệp vào tài khoản Quản trị tối cao trừ khi người thao tác cũng là tối cao */
  private async assertCanTouchTarget(id: number, actor?: AccessContext): Promise<void> {
    const targetRoles = await this.db.db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, id));
    const targetisSuper = targetRoles.some((r) => r.code === SUPER_ADMIN_ROLE);
    if (targetisSuper && !(actor?.isSuperAdmin)) {
      throw new ForbiddenException('Chỉ Quản trị tối cao mới được thao tác trên tài khoản Quản trị tối cao');
    }
  }
  async remove(id: number, actor?: AccessContext) {
    const user = await this.findOne(id);
    if (user.username === config.seed.adminUser) {
      throw new ForbiddenException('Không thể xoá tài khoản quản trị gốc');
    }
    if (actor && actor.id === id) {
      throw new BadRequestException('Không thể tự xoá tài khoản đang đăng nhập');
    }
    await this.assertCanTouchTarget(id, actor);
    await this.db.db
      .update(users)
      .set({ active: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, id));
    await this.auth.revokeAllSessions(id);
    await this.auth.invalidateUserCache(id);
    return { message: `Đã xoá người dùng ${user.fullName}` };
  }

  async restore(id: number) {
    const [target] = await this.db.db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    // Tài khoản khác đang hoạt động mà chiếm tên đăng nhập thì không phục hồi được —
    // khoá partial unique ở DB sẽ từ chối lẻ lỗi thô, nên báo rõ ngay từ tầng service
    const [clash] = await this.db.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, target?.username ?? ''), ne(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    if (clash) {
      throw new ConflictException(`Tên đăng nhập "${target?.username ?? ''}" đang thuộc một tài khoản hoạt động khác — sửa tên trước khi phục hồi`);
    }
    await this.db.db
      .update(users)
      .set({ active: true, deletedAt: null, updatedAt: new Date() })
      .where(eq(users.id, id));
    await this.auth.invalidateUserCache(id);
    return this.findOne(id);
  }

  async toggleActive(id: number, active: boolean, actor?: AccessContext) {
    const [u] = await this.db.db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!active && u?.username === config.seed.adminUser) {
      throw new ForbiddenException('Không thể vô hiệu hoá tài khoản quản trị gốc');
    }
    if (!active && actor && actor.id === id) {
      throw new BadRequestException('Không thể tự vô hiệu hoá tài khoản đang đăng nhập');
    }
    if (!active) await this.assertCanTouchTarget(id, actor);
    await this.db.db
      .update(users)
      .set({ active, updatedAt: new Date() })
      .where(eq(users.id, id));
    if (!active) await this.auth.revokeAllSessions(id);
    await this.auth.invalidateUserCache(id);
    return { message: active ? 'Đã kích hoạt tài khoản' : 'Đã vô hiệu hoá tài khoản' };
  }

  /** Đặt lại mật khẩu (quản trị thực hiện) */
  async resetPassword(id: number, dto: ResetPasswordDto, actor?: AccessContext) {
    if (actor && actor.id === id) {
      throw new BadRequestException('Hãy đổi mật khẩu của chính mình ở trang Tài khoản');
    }
    await this.assertCanTouchTarget(id, actor);
    if (dto.newPassword !== undefined) {
      const minLen = await this.settings.passwordMinLength();
      if (dto.newPassword.length < minLen) {
        throw new BadRequestException(`Mật khẩu phải có ít nhất ${minLen} ký tự`);
      }
    }
    const newPassword = dto.newPassword ?? DEFAULT_RESET_PASSWORD;
    await this.db.db
      .update(users)
      .set({
        passwordHash: await this.auth.hashPassword(newPassword),
        mustChangePassword: dto.forceChange ?? true,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
    await this.auth.revokeAllSessions(id);
    return {
      message: 'Đã đặt lại mật khẩu',
      temporaryPassword: dto.newPassword ? undefined : newPassword,
    };
  }

  async unlock(id: number) {
    await this.db.db
      .update(users)
      .set({ lockedUntil: null, failedLoginCount: 0, updatedAt: new Date() })
      .where(eq(users.id, id));
    return { message: 'Đã mở khoá tài khoản' };
  }

  async setRoles(id: number, dto: SetRolesDto, actor?: AccessContext) {
    const target = await this.findOne(id);
    await this.assertCanTouchTarget(id, actor);
    const roleCodes = [...new Set([...(dto.roleCodes ?? []), ...(isDoctorTitle(target.title) ? [DUTY_STAFF_ROLE_CODE] : [])])];
    const ids = await this.resolveRoleIds(roleCodes);

    // Chỉ Quản trị tối cao mới được GÁN vai trò Quản trị tối cao cho ai
    const [superRoleRow] = await this.db.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, SUPER_ADMIN_ROLE))
      .limit(1);
    if (superRoleRow && ids.includes(superRoleRow.id) && !actor?.isSuperAdmin) {
      throw new ForbiddenException('Chỉ Quản trị tối cao mới được gán vai trò Quản trị tối cao');
    }

    // Bảo vệ: không cho gỡ vai trò quản trị tối cao khỏi người dùng cuối cùng
    const [superRole] = await this.db.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, SUPER_ADMIN_ROLE))
      .limit(1);
    if (superRole) {
      const hadSuper = await this.db.db
        .select({ total: sql<number>`count(*)::int` })
        .from(userRoles)
        .where(and(eq(userRoles.userId, id), eq(userRoles.roleId, superRole.id)));
      const willHaveSuper = ids.includes(superRole.id);
      if ((hadSuper[0]?.total ?? 0) > 0 && !willHaveSuper) {
        const [remaining] = await this.db.db
          .select({ total: sql<number>`count(*)::int` })
          .from(userRoles)
          .where(eq(userRoles.roleId, superRole.id));
        if ((remaining?.total ?? 0) <= 1) {
          throw new BadRequestException(
            'Đây là tài khoản quản trị tối cao duy nhất — không thể gỡ vai trò này',
          );
        }
      }
    }

    await this.db.transaction(async (tx) => {
      if (dto.replace !== false) {
        await tx.delete(userRoles).where(eq(userRoles.userId, id));
      }
      if (ids.length > 0) {
        await tx
          .insert(userRoles)
          .values(ids.map((roleId) => ({ userId: id, roleId })))
          .onConflictDoNothing();
      }
    });
    await this.auth.invalidateUserCache(id);
    return this.findOne(id);
  }

  /**
   * Quyền hiệu lực của một người dùng: hợp nhất quyền từ mọi vai trò + phạm vi dữ liệu
   * + danh sách khoa được phép — dùng cho màn hình xem nhanh "người này được làm gì".
   */
  async effectivePermissions(id: number) {
    const [u] = await this.db.db
      .select({ id: users.id, username: users.username, fullName: users.fullName })
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    if (!u) throw new NotFoundException('Không tìm thấy người dùng');
    const ctx = await this.auth.buildSystemContext(id, 'effective-view');
    const roleList = await this.db.db
      .select({
        code: roles.code,
        name: roles.name,
        color: roles.color,
        dataScope: roles.dataScope,
      })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, id))
      .orderBy(asc(roles.priority));
    const permRows = await this.db.db
      .select({ code: permissions.code, name: permissions.name, module: permissions.module })
      .from(userRoles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(userRoles.userId, id))
      .orderBy(asc(permissions.module), asc(permissions.code));
    // roles nào đóng góp quyền nào — để xem nguồn gốc từng quyền
    const roleCodesByPerm = await this.db.db
      .select({ permissionCode: permissions.code, roleCode: roles.code })
      .from(userRoles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, id));
    const sourceOf = new Map<string, string[]>();
    for (const r of roleCodesByPerm) {
      const list = sourceOf.get(r.permissionCode) ?? [];
      list.push(r.roleCode);
      sourceOf.set(r.permissionCode, list);
    }
    const seen = new Set<string>();
    const perms = permRows.filter((x) => (seen.has(x.code) ? false : (seen.add(x.code), true)));
    return {
      user: u,
      isSuperAdmin: ctx?.isSuperAdmin ?? false,
      roles: roleList,
      dataScope: ctx?.dataScope ?? 'OWN',
      departmentIds: ctx?.departmentIds ?? [],
      permissions: ctx?.isSuperAdmin
        ? [{ code: '*', name: 'Toàn bộ quyền (Quản trị tối cao)', module: '*' }]
        : perms.map((x) => ({ ...x, fromRoles: sourceOf.get(x.code) ?? [] })),
      permissionCount: ctx?.isSuperAdmin ? -1 : perms.length,
    };
  }

  async setDepartmentScopes(id: number, dto: SetDepartmentScopesDto) {
    await this.findOne(id);
    await this.db.transaction(async (tx) => {
      await tx.delete(userDepartmentScopes).where(eq(userDepartmentScopes.userId, id));
      if (dto.departmentIds.length > 0) {
        await tx
          .insert(userDepartmentScopes)
          .values(dto.departmentIds.map((departmentId) => ({ userId: id, departmentId })))
          .onConflictDoNothing();
      }
    });
    await this.auth.invalidateUserCache(id);
    return this.findOne(id);
  }

  /** Thống kê phục vụ trang quản trị */
  async stats() {
    const [total] = await this.db.db.select({ total: sql<number>`count(*)::int` }).from(users).where(isNull(users.deletedAt));
    const [active] = await this.db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(users)
      .where(and(isNull(users.deletedAt), eq(users.active, true)));
    const [locked] = await this.db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(users)
      .where(and(isNull(users.deletedAt), sql`${users.lockedUntil} > now()`));
    const [neverLoggedin] = await this.db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(users)
      .where(and(isNull(users.deletedAt), isNull(users.lastLoginAt)));
    const byDepartment = await this.db.db
      .select({ departmentId: users.departmentId, departmentName: departments.name, total: sql<number>`count(*)::int` })
      .from(users)
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(isNull(users.deletedAt))
      .groupBy(users.departmentId, departments.name)
      .orderBy(desc(sql`count(*)`))
      .limit(20);
    return {
      total: total?.total ?? 0,
      active: active?.total ?? 0,
      locked: locked?.total ?? 0,
      neverLoggedin: neverLoggedin?.total ?? 0,
      byDepartment,
    };
  }
}
