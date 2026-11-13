/**
 * Đơn vị / Khoa phòng — phân cấp không giới hạn cấp (Viện → Khối → Khoa → Phòng → Tổ).
 * Tạo/sửa/xóa hoàn toàn từ giao diện quản trị, KHÔNG set cứng.
 */
import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const departments = pgTable(
  'departments',
  {
    id: serial('id').primaryKey(),
    /** Mã đơn vị (duy nhất) — dùng trong báo cáo, xuất/nhập dữ liệu */
    code: text('code').notNull(),
    name: text('name').notNull(),
    shortName: text('short_name').default('').notNull(),
    /** Tên bệnh viện hiển thị trên báo cáo/bản in của đơn vị này */
    hospital: text('hospital').default('BỆNH VIỆN QUÂN Y 4').notNull(),
    /** Mã báo cáo mặc định (B4, B5…) — cấu hình được */
    reportCode: text('report_code').default('B4').notNull(),
    /** Cấp trên (tự tham chiếu) — null = đơn vị gốc */
    parentId: integer('parent_id'),
    /** Cấp: 1=Viện, 2=Khối, 3=Khoa, 4=Phòng/Tổ… */
    level: integer('level').default(1).notNull(),
    /** Đường dẫn phân cấp, ví dụ /1/4/17/ — phục vụ lọc theo nhánh cây */
    path: text('path').default('').notNull(),
    /** Loại đơn vị: KHOA | PHONG | KHOOI | TRUNG_TAM | BAN — tự do khai báo */
    kind: text('kind').default('KHOA').notNull(),
    phone: text('phone').default('').notNull(),
    email: text('email').default('').notNull(),
    /** Trưởng khoa / người phụ trách */
    headName: text('head_name').default('').notNull(),
    note: text('note').default('').notNull(),
    /** Có nhập báo cáo công tác hay không (một số phòng ban không báo cáo) */
    reportEnabled: boolean('report_enabled').default(true).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('departments_code_uq').on(t.code).where(sql`${t.deletedAt} is null`),
    index('departments_parent_idx').on(t.parentId),
    index('departments_path_idx').on(t.path),
    index('departments_active_idx').on(t.active),
    index('departments_name_trgm_idx').using(
      'gin',
      sql`to_tsvector('simple', ${t.name} || ' ' || ${t.code})`,
    ),
  ],
);

export type Department = typeof departments.$inferSelect;
export type NewDepartment = typeof departments.$inferInsert;

/**
 * Danh mục chức danh chuyên môn (Bác sĩ, Điều dưỡng, Kế toán…) — khai báo từ giao diện.
 * Người dùng lưu tên chức danh chuyên môn ở cột users.title; chức vụ kiêm nhiệm lưu riêng ở users.managementPosition.
 */
export const jobTitles = pgTable(
  'job_titles',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    active: boolean('active').default(true).notNull(),
    note: text('note').default('').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('job_titles_code_uq').on(t.code),
    uniqueIndex('job_titles_name_uq').on(sql`lower(${t.name})`),
    index('job_titles_sort_idx').on(t.sortOrder, t.name),
  ],
);

/**
 * Danh mục chức vụ quản lý/kiêm nhiệm (Chủ nhiệm khoa, Phó chủ nhiệm…).
 * Khác với job_titles: một người có thể được gán nhiều chức vụ qua user_management_positions.
 */
export const managementPositions = pgTable(
  'management_positions',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** Thứ tự hiển thị và thứ tự ưu tiên khi cấu hình bảng chấm công ưu tiên chức vụ. */
    sortOrder: integer('sort_order').default(0).notNull(),
    active: boolean('active').default(true).notNull(),
    note: text('note').default('').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('management_positions_code_uq').on(t.code),
    uniqueIndex('management_positions_name_uq').on(sql`lower(${t.name})`),
    index('management_positions_sort_idx').on(t.sortOrder, t.name),
  ],
);
