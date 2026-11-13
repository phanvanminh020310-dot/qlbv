/**
 * Người dùng · Vai trò · Quyền · Nhật ký kiểm toán · Cấu hình hệ thống.
 *
 * Mô hình phân quyền: RBAC đầy đủ
 *   User ──< UserRole >── Role ──< RolePermission >── Permission
 * cộng thêm "phạm vi dữ liệu" (data scope) theo khoa để giới hạn dữ liệu nhìn thấy.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { departments, managementPositions } from './org';
import type { DataScope } from './types';

/* --------------------------------------------------------------------------- Người dùng */
export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    /** Mã nhân viên liên thông; dữ liệu cũ được sinh từ 4 ký tự đầu tên đăng nhập. */
    manv: text('manv').default('').notNull(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    /** Chức danh chuyên môn: Bác sĩ, Điều dưỡng, Kế toán… Dùng để xét điều kiện vai trò khám. */
    title: text('title').default('').notNull(),
    /** Chuỗi hiển thị tương thích các chức vụ kiêm nhiệm; dữ liệu chuẩn nằm ở userManagementPositions. */
    managementPosition: text('management_position').default('').notNull(),
    email: text('email').default('').notNull(),
    phone: text('phone').default('').notNull(),
    /** Khoa công tác chính */
    departmentId: integer('department_id'),
    /** Ảnh đại diện (đường dẫn tương đối trong storage) */
    avatar: text('avatar').default('').notNull(),
    /** Chữ ký số dạng ảnh (base64/đường dẫn) để chèn vào bản in */
    signatureImage: text('signature_image').default('').notNull(),
    /** Bắt buộc đổi mật khẩu ở lần đăng nhập kế tiếp */
    mustChangePassword: boolean('must_change_password').default(false).notNull(),
    /** Xác thực 2 lớp (TOTP) — bật/tắt theo người dùng */
    twoFactorEnabled: boolean('two_factor_enabled').default(false).notNull(),
    twoFactorSecret: text('two_factor_secret').default('').notNull(),
    /** Giới hạn số lần đăng nhập sai liên tiếp */
    failedLoginCount: integer('failed_login_count').default(0).notNull(),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    /** Mã chat Telegram đã liên kết — kênh nhận thông báo tức thời */
    telegramChatId: text('telegram_chat_id'),
    active: boolean('active').default(true).notNull(),
    note: text('note').default('').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_username_uq').on(t.username).where(sql`${t.deletedAt} is null`),
    // Không unique: dữ liệu lịch sử phải giữ đúng quy tắc lấy 4 ký tự đầu username, kể cả khi trùng.
    index('users_manv_idx').on(t.manv),
    index('users_department_idx').on(t.departmentId),
    index('users_active_idx').on(t.active),
    // Lọc theo khoa và liệt kê tài khoản đang dùng rất thường xuyên
    index('users_dept_idx').on(t.departmentId),
    index('users_search_idx').using(
      'gin',
      sql`to_tsvector('simple', ${t.fullName} || ' ' || ${t.username} || ' ' || ${t.title})`,
    ),
  ],
);

/* ------------------------------------------------------------------------------- Vai trò */
export const roles = pgTable(
  'roles',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description').default('').notNull(),
    /** Phạm vi dữ liệu mặc định của vai trò: OWN | DEPT | ALL */
    dataScope: text('data_scope').$type<DataScope>().default('OWN').notNull(),
    /** Vai trò hệ thống: không cho xóa, chỉ sửa mô tả/quyền */
    isSystem: boolean('is_system').default(false).notNull(),
    /** Thứ tự ưu tiên khi hợp nhất nhiều vai trò của một người */
    priority: integer('priority').default(100).notNull(),
    color: text('color').default('#0ea5e9').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('roles_code_uq').on(t.code), index('roles_active_idx').on(t.active)],
);

/* --------------------------------------------------------------------------- Quyền hạn */
export const permissions = pgTable(
  'permissions',
  {
    id: serial('id').primaryKey(),
    /** Mã quyền dạng module.action: hsba.request.create */
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** Nhóm nghiệp vụ: hsba | report | admin | system | print … */
    module: text('module').notNull(),
    /** Thao tác: view | create | update | delete | approve | sign | export | admin */
    action: text('action').notNull(),
    description: text('description').default('').notNull(),
    /** Quyền hệ thống: không cho xóa khỏi danh mục */
    isSystem: boolean('is_system').default(true).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('permissions_code_uq').on(t.code),
    index('permissions_module_idx').on(t.module),
  ],
);

/* --------------------------------------------------------------- Bảng nối Role ↔ Permission */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: integer('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionId] }),
    index('role_permissions_perm_idx').on(t.permissionId),
  ],
);

/* --------------------------------------------------------------------- Bảng nối User ↔ Role */
export const userRoles = pgTable(
  'user_roles',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    /** Người gán quyền */
    grantedBy: integer('granted_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.roleId] }),
    index('user_roles_role_idx').on(t.roleId),
  ],
);

/**
 * Phạm vi khoa được phép truy cập (ngoài khoa chính).
 * Ví dụ: Trưởng phòng KHTH cần xem báo cáo của nhiều khoa.
 */
export const userDepartmentScopes = pgTable(
  'user_department_scopes',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    departmentId: integer('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.departmentId] }),
    index('user_dept_scopes_dept_idx').on(t.departmentId),
  ],
);

/** Một nhân sự có thể kiêm nhiều chức vụ; không thay đổi users.title là chức danh chuyên môn. */
export const userManagementPositions = pgTable(
  'user_management_positions',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    managementPositionId: integer('management_position_id')
      .notNull()
      .references(() => managementPositions.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.managementPositionId] }),
    index('user_management_positions_position_idx').on(t.managementPositionId),
  ],
);

/* ------------------------------------------------------------------ Nhật ký kiểm toán */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id'),
    username: text('username').default('').notNull(),
    fullName: text('full_name').default('').notNull(),
    /** Hành động: LOGIN | CREATE | UPDATE | DELETE | APPROVE | EXPORT | IMPORT | ADMIN … */
    action: text('action').notNull(),
    /** Phân hệ: AUTH | HSBA | REPORT | ADMIN | PRINT | UTILITY | SYSTEM */
    module: text('module').notNull(),
    /** Bảng/đối tượng bị tác động */
    entity: text('entity').default('').notNull(),
    entityId: text('entity_id').default('').notNull(),
    /** Mô tả ngắn hiển thị cho người dùng */
    description: text('description').default('').notNull(),
    /** Giá trị trước/sau khi sửa */
    beforeData: jsonb('before_data'),
    afterData: jsonb('after_data'),
    departmentId: integer('department_id'),
    ip: text('ip').default('').notNull(),
    userAgent: text('user_agent').default('').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('audit_logs_created_idx').on(t.createdAt),
    index('audit_logs_user_idx').on(t.userId),
    index('audit_logs_module_idx').on(t.module),
    index('audit_logs_entity_idx').on(t.entity, t.entityId),
    // Trang nhật ký lọc theo phân hệ/thao tác rồi xem mới nhất trước
    index('audit_logs_module_created_idx').on(t.module, t.createdAt),
    index('audit_logs_action_created_idx').on(t.action, t.createdAt),
  ],
);

/* --------------------------------------------------------------------- Lịch sử đăng nhập */
export const loginLogs = pgTable(
  'login_logs',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id'),
    username: text('username').notNull(),
    success: boolean('success').notNull(),
    reason: text('reason').default('').notNull(),
    ip: text('ip').default('').notNull(),
    userAgent: text('user_agent').default('').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('login_logs_user_idx').on(t.userId),
    index('login_logs_created_idx').on(t.createdAt),
  ],
);

/* ------------------------------------------------------------------------------ Cấu hình */
export const settings = pgTable(
  'settings',
  {
    key: text('key').primaryKey(),
    value: jsonb('value').notNull(),
    group: text('group').default('general').notNull(),
    label: text('label').default('').notNull(),
    description: text('description').default('').notNull(),
    /** Kiểu dữ liệu để giao diện render ô nhập: string | number | boolean | json */
    valueType: text('value_type').default('string').notNull(),
    isPublic: boolean('is_public').default(false).notNull(),
    updatedBy: integer('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('settings_group_idx').on(t.group)],
);

/* -------------------------------------------------------------------------- Thông báo */
export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').default('').notNull(),
    /** INFO | SUCCESS | WARNING | ERROR */
    level: text('level').default('INFO').notNull(),
    /** Liên kết mở khi bấm vào thông báo */
    link: text('link').default('').notNull(),
    module: text('module').default('').notNull(),
    entityId: text('entity_id').default('').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.readAt),
    // Đếm thông báo chưa đọc chạy rất thường xuyên → chỉ mục bộ phận chỉ gồm bản ghi chưa đọc
    index('notifications_unread_idx').on(t.userId, t.createdAt).where(sql`${t.readAt} is null`),
    index('notifications_created_idx').on(t.createdAt),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Role = typeof roles.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
