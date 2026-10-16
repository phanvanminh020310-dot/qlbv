/**
 * Xác thực & phân quyền.
 *
 * - Mật khẩu băm bằng bcrypt.
 * - Phiên đăng nhập lưu trong Redis (thu hồi được ngay khi đăng xuất/đổi mật khẩu).
 * - Quyền hiệu lực = hợp nhất quyền của tất cả vai trò; có cache để không truy vấn lại mỗi request.
 * - Phạm vi dữ liệu lấy theo vai trò có phạm vi rộng nhất (ALL > DEPT > OWN).
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'crypto';
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
import type { DataScope } from '../../db/schema/types';
import type { AccessContext, JwtPayload } from '../../common/types/access-context';
import { SUPER_ADMIN_ROLE } from '../../common/types/access-context';
import { CacheService } from '../../infra/cache/cache.service';
import type { ChangePasswordDto, LoginDto, UpdateProfileDto } from './dto/auth.dto';

interface SessionData {
  userId: number;
  username: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  refreshHash: string;
  expiresAt: string;
}

const SCOPE_RANK: Record<DataScope, number> = { OWN: 0, DEPT: 1, ALL: 2 };
const MAX_SCOPE = (a: DataScope, b: DataScope): DataScope => (SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DbService,
    private readonly jwt: JwtService,
    private readonly cache: CacheService,
    private readonly settings: SettingsService,
  ) {}

  /* ------------------------------------------------------------------ Đăng nhập */

  async login(dto: LoginDto, meta: { ip: string; userAgent: string }) {
    const username = dto.username.trim();
    const failedKey = `auth:fail:${username.toLowerCase()}`;

    const [user] = await this.db.db
      .select()
      .from(users)
      .where(and(eq(users.username, username), isNull(users.deletedAt)))
      .limit(1);

    if (!user) {
      await this.recordLogin(null, username, false, 'Không tồn tại tài khoản', meta);
      throw new UnauthorizedException('Sai tên đăng nhập hoặc mật khẩu');
    }

    if (!user.active) {
      await this.recordLogin(user.id, username, false, 'Tài khoản đã bị khoá', meta);
      throw new ForbiddenException('Tài khoản đã bị vô hiệu hoá, liên hệ quản trị hệ thống');
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new ForbiddenException(
        `Tài khoản tạm khoá do đăng nhập sai nhiều lần. Thử lại sau ${minutes} phút.`,
      );
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      const fails = await this.cache.incr(failedKey, config.security.lockMinutes * 60);
      await this.db.db
        .update(users)
        .set({ failedLoginCount: sql`${users.failedLoginCount} + 1` })
        .where(eq(users.id, user.id));
      if (fails >= config.security.maxFailedLogins) {
        await this.db.db
          .update(users)
          .set({ lockedUntil: new Date(Date.now() + config.security.lockMinutes * 60_000) })
          .where(eq(users.id, user.id));
        await this.recordLogin(user.id, username, false, 'Sai mật khẩu quá nhiều lần', meta);
        throw new ForbiddenException(
          `Sai mật khẩu quá ${config.security.maxFailedLogins} lần — tài khoản tạm khoá ${config.security.lockMinutes} phút.`,
        );
      }
      await this.recordLogin(user.id, username, false, 'Sai mật khẩu', meta);
      throw new UnauthorizedException('Sai tên đăng nhập hoặc mật khẩu');
    }

    // Đăng nhập thành công
    await this.cache.del(failedKey);
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + config.security.sessionHours * 3_600_000);
    const tokens = await this.issueTokens(user.id, user.username, sessionId);

    await this.cache.set(
      `auth:session:${sessionId}`,
      {
        userId: user.id,
        username: user.username,
        ip: meta.ip,
        userAgent: meta.userAgent,
        createdAt: new Date().toISOString(),
        refreshHash: this.hashToken(tokens.refreshToken),
        expiresAt: expiresAt.toISOString(),
      } satisfies SessionData,
      config.security.sessionHours * 3_600,
    );

    // Ghi phiên vào danh mục phiên của người dùng (phục vụ thu hồi từ xa)
    await this.cache.sadd(`auth:user-sessions:${user.id}`, sessionId);

    await this.db.db
      .update(users)
      .set({
        lastLoginAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      })
      .where(eq(users.id, user.id));

    await this.recordLogin(user.id, username, true, '', meta);
    await this.cache.del(`auth:ctx:${user.id}`);

    const ctx = await this.buildAccessContext(user.id, sessionId);
    return { ...tokens, user: ctx, mustChangePassword: user.mustChangePassword };
  }

  private async issueTokens(userId: number, username: string, sessionId: string) {
    const accessPayload: JwtPayload = { sub: userId, username, sid: sessionId, typ: 'access' };
    const refreshPayload: JwtPayload = { sub: userId, username, sid: sessionId, typ: 'refresh' };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload, {
        secret: config.jwt.secret,
        expiresIn: config.jwt.accessTtl,
        issuer: config.jwt.issuer,
      }),
      this.jwt.signAsync(refreshPayload, {
        secret: config.jwt.refreshSecret,
        expiresIn: config.jwt.refreshTtl,
        issuer: config.jwt.issuer,
      }),
    ]);
    return { accessToken, refreshToken, expiresIn: config.jwt.accessTtl };
  }

  async refresh(refreshToken: string, meta: { ip: string; userAgent: string }) {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: config.jwt.refreshSecret,
        issuer: config.jwt.issuer,
      });
    } catch {
      throw new UnauthorizedException('Phiên làm việc không hợp lệ, vui lòng đăng nhập lại');
    }
    if (payload.typ !== 'refresh') throw new UnauthorizedException('Loại token không hợp lệ');

    const session = await this.cache.get<SessionData>(`auth:session:${payload.sid}`);
    if (!session) throw new UnauthorizedException('Phiên làm việc đã hết hạn');
    if (session.refreshHash !== this.hashToken(refreshToken)) {
      await this.cache.del(`auth:session:${payload.sid}`);
      throw new UnauthorizedException('Phiên làm việc không hợp lệ (token đã bị thay thế)');
    }

    const tokens = await this.issueTokens(payload.sub, payload.username, payload.sid);
    await this.cache.set(
      `auth:session:${payload.sid}`,
      { ...session, refreshHash: this.hashToken(tokens.refreshToken), ip: meta.ip },
      config.security.sessionHours * 3_600,
    );
    return tokens;
  }

  async logout(sessionId: string, userId?: number) {
    await this.cache.del(`auth:session:${sessionId}`);
    if (userId) await this.cache.del(`auth:ctx:${userId}`);
  }

  /** Thu hồi toàn bộ phiên của một người dùng (khi khoá tài khoản/đổi mật khẩu) */
  async revokeAllSessions(userId: number): Promise<number> {
    const indexKey = `auth:user-sessions:${userId}`;
    const sessionIds = await this.cache.smembers(indexKey);
    for (const sid of sessionIds) {
      await this.cache.del(`auth:session:${sid}`);
    }
    await this.cache.del(indexKey, `auth:ctx:${userId}`);
    this.logger.warn(`Đã thu hồi ${sessionIds.length} phiên của người dùng #${userId}`);
    return sessionIds.length;
  }

  /** Thu hồi một phiên cụ thể (đăng xuất từ xa) */
  async revokeSession(userId: number, sessionId: string): Promise<void> {
    await this.cache.del(`auth:session:${sessionId}`);
    await this.cache.srem(`auth:user-sessions:${userId}`, sessionId);
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async recordLogin(
    userId: number | null,
    username: string,
    success: boolean,
    reason: string,
    meta: { ip: string; userAgent: string },
  ): Promise<void> {
    await this.db.db.insert(loginLogs).values({
      userId,
      username,
      success,
      reason,
      ip: meta.ip.slice(0, 64),
      userAgent: meta.userAgent.slice(0, 400),
    });
  }

  /* --------------------------------------------------- Ngữ cảnh truy cập (quyền) */

  /**
   * Dựng ngữ cảnh truy cập: vai trò, quyền hiệu lực, phạm vi dữ liệu, danh sách khoa.
   * Kết quả được cache theo người dùng; vô hiệu hoá khi đổi vai trò/quyền.
   */
  async buildAccessContext(userId: number, sessionId: string): Promise<AccessContext | null> {
    const session = await this.cache.get<SessionData>(`auth:session:${sessionId}`);
    if (!session || session.userId !== userId) return null;

    const cached = await this.cache.get<Omit<AccessContext, 'sessionId'>>(`auth:ctx:${userId}`);
    if (cached) return { ...cached, sessionId };

    return this.assembleContext(userId, sessionId);
  }

  /**
   * Dựng ngữ cảnh cho tác vụ nền (ẤN BẢN định kỳ, hàng đợi) — KHÔNG qua phiên
   * đăng nhập. Chỉ gọi nội bộ từ các service hệ thống, tuyệt đối không gắn
   * vào endpoint. `tag` ghi danh nguồn gốc vào sessionId để nhật ký dễ truy.
   */
  async buildSystemContext(userId: number, tag = 'system'): Promise<AccessContext | null> {
    const cached = await this.cache.get<Omit<AccessContext, 'sessionId'>>(`auth:ctx:${userId}`);
    if (cached) return { ...cached, sessionId: `system:${tag}` };
    return this.assembleContext(userId, `system:${tag}`);
  }

  private async assembleContext(userId: number, sessionId: string): Promise<AccessContext | null> {

    const [user] = await this.db.db
      .select({
        id: users.id,
        username: users.username,
        fullName: users.fullName,
        title: users.title,
        departmentId: users.departmentId,
        active: users.active,
      })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);

    if (!user || !user.active) return null;

    const roleRows = await this.db.db
      .select({
        code: roles.code,
        dataScope: roles.dataScope,
        priority: roles.priority,
      })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, userId), eq(roles.active, true)))
      .orderBy(roles.priority);

    const roleCodes = roleRows.map((r) => r.code);
    const isSuperAdmin = roleCodes.includes(SUPER_ADMIN_ROLE);

    let permCodes: string[] = [];
    if (isSuperAdmin) {
      const all = await this.db.db.select({ code: permissions.code }).from(permissions);
      permCodes = all.map((p) => p.code);
    } else if (roleCodes.length > 0) {
      const roleIds = await this.db.db
        .select({ id: roles.id })
        .from(roles)
        .where(and(inArray(roles.code, roleCodes), eq(roles.active, true)));
      if (roleIds.length > 0) {
        const rows = await this.db.db
          .selectDistinct({ code: permissions.code })
          .from(rolePermissions)
          .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
          .where(inArray(rolePermissions.roleId, roleIds.map((r) => r.id)));
        permCodes = rows.map((r) => r.code);
      }
    }

    const dataScope = isSuperAdmin
      ? 'ALL'
      : roleRows.reduce<DataScope>((acc, r) => MAX_SCOPE(acc, r.dataScope), 'OWN');

    // A primary department does not replace explicitly assigned additional scopes.
    // Department schedulers may be assigned to more than one clinical department.
    const scopeRows = await this.db.db
      .select({ departmentId: userDepartmentScopes.departmentId })
      .from(userDepartmentScopes)
      .where(eq(userDepartmentScopes.userId, userId));

    const departmentIds = new Set<number>();
    if (user.departmentId) departmentIds.add(user.departmentId);
    for (const s of scopeRows) departmentIds.add(s.departmentId);

    let departmentName = '';
    if (user.departmentId) {
      const [dept] = await this.db.db
        .select({ name: departments.name })
        .from(departments)
        .where(eq(departments.id, user.departmentId))
        .limit(1);
      departmentName = dept?.name ?? '';
    }

    const ctx: Omit<AccessContext, 'sessionId'> = {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      title: user.title,
      departmentId: user.departmentId,
      departmentName,
      roles: roleCodes,
      permissions: permCodes.sort(),
      dataScope,
      departmentIds: [...departmentIds],
      isSuperAdmin,
    };

    await this.cache.set(`auth:ctx:${userId}`, ctx, config.cache.permissionTtl);
    return { ...ctx, sessionId };
  }

  /** Vô hiệu hoá cache ngữ cảnh (gọi sau khi đổi vai trò/quyền/khoa của người dùng) */
  async invalidateUserCache(userId?: number): Promise<void> {
    if (userId) {
      await this.cache.del(`auth:ctx:${userId}`);
      return;
    }
    await this.cache.delByPrefix('auth:ctx:');
  }

  /* ------------------------------------------------------------------ Hồ sơ */

  async profile(userId: number, permissions?: readonly string[]) {
    const [user] = await this.db.db
      .select({
        id: users.id,
        username: users.username,
        fullName: users.fullName,
        title: users.title,
        email: users.email,
        phone: users.phone,
        avatar: users.avatar,
        departmentId: users.departmentId,
        departmentName: departments.name,
        mustChangePassword: users.mustChangePassword,
        twoFactorEnabled: users.twoFactorEnabled,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    // Trang "Hồ sơ cá nhân" hiển thị vai trò (tên + phạm vi) và thống kê quyền theo phân hệ;
    // thiếu hai trường này giao diện sẽ lỗi khi gọi .map trên undefined.
    const roleRows = await this.db.db
      .select({ code: roles.code, name: roles.name, dataScope: roles.dataScope })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, userId), eq(roles.active, true)))
      .orderBy(roles.priority);

    return { ...user, roles: roleRows, permissions: [...(permissions ?? [])].sort() };
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    await this.db.db
      .update(users)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await this.invalidateUserCache(userId);
    return this.profile(userId);
  }

  async changePassword(userId: number, dto: ChangePasswordDto) {
    if (dto.confirmPassword !== undefined && dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('Xác nhận mật khẩu mới không khớp');
    }
    const [user] = await this.db.db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) throw new BadRequestException('Mật khẩu hiện tại không đúng');

    if (await bcrypt.compare(dto.newPassword, user.passwordHash)) {
      throw new BadRequestException('Mật khẩu mới phải khác mật khẩu hiện tại');
    }

    // Độ dài tối thiểu theo cấu hình hệ thống (DTO chỉ chặn mật khẩu rỗng)
    const minLen = await this.settings.passwordMinLength();
    if (dto.newPassword.length < minLen) {
      throw new BadRequestException(`Mật khẩu mới phải có ít nhất ${minLen} ký tự`);
    }

    await this.db.db
      .update(users)
      .set({
        passwordHash: await this.hashPassword(dto.newPassword),
        mustChangePassword: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    // Đổi mật khẩu → thu hồi mọi phiên khác
    await this.revokeAllSessions(userId);
    return { message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.' };
  }

  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, config.security.bcryptRounds);
  }

  /** Danh mục quyền để giao diện dựng ma trận phân quyền */
  async listPermissions() {
    const rows = await this.db.db
      .select()
      .from(permissions)
      .orderBy(permissions.module, permissions.sortOrder, permissions.code);
    const grouped = new Map<string, typeof rows>();
    for (const p of rows) {
      const list = grouped.get(p.module) ?? [];
      list.push(p);
      grouped.set(p.module, list);
    }
    return {
      total: rows.length,
      modules: [...grouped.entries()].map(([module, items]) => ({ module, items })),
      permissions: rows,
    };
  }

  /** Danh sách phiên đang hoạt động của một người dùng */
  async activeSessions(userId: number) {
    const sessionIds = await this.cache.smembers(`auth:user-sessions:${userId}`);
    const sessions: {
      id: string;
      ip: string;
      userAgent: string;
      createdAt: string;
      expiresAt: string;
      current: boolean;
    }[] = [];
    for (const sid of sessionIds) {
      const s = await this.cache.get<SessionData>(`auth:session:${sid}`);
      if (!s) {
        await this.cache.srem(`auth:user-sessions:${userId}`, sid);
        continue;
      }
      sessions.push({
        id: sid,
        ip: s.ip,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        current: false,
      });
    }
    return { total: sessions.length, sessions };
  }
}
