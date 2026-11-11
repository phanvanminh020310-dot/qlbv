import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, numeric, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { departments } from './org';
import { users } from './system';

export type DutyAttendanceSectionKind = 'ADMIN' | 'DAYS' | 'SYMBOLS' | 'REPORT' | 'CUSTOM';
export type DutyAttendanceColumnType = 'FORMULA' | 'MANUAL';
export type DutyAttendanceDataType = 'NUMBER' | 'TEXT';
/** Vai trò nghiệp vụ của ký hiệu, dùng cho công thức chấm công theo ngày thay vì suy đoán từ mã T/N/TC. */
export const DUTY_ATTENDANCE_CALCULATION_ROLES = ['NONE', 'DUTY', 'REINFORCEMENT', 'REST'] as const;
export type DutyAttendanceCalculationRole = (typeof DUTY_ATTENDANCE_CALCULATION_ROLES)[number];
/** Ký hiệu nghỉ bù có thể dò ca trực thường, tăng cường hoặc bất kỳ ca trực gần nhất. */
export const DUTY_ATTENDANCE_REST_SOURCES = ['ANY_DUTY', 'DUTY', 'REINFORCEMENT'] as const;
export type DutyAttendanceRestSource = (typeof DUTY_ATTENDANCE_REST_SOURCES)[number];

/** Danh mục nhóm ký hiệu, mã ổn định và tên tiếng Việt để chọn tại form ký hiệu. */
export const dutyAttendanceCodeGroups = pgTable('duty_attendance_code_groups', {
  id: serial('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('duty_attendance_code_groups_code_uq').on(t.code), index('duty_attendance_code_groups_active_idx').on(t.active, t.sortOrder)]);

/** Danh mục ký hiệu chấm công – cấu hình được, không hard-code ở giao diện. */
export const dutyAttendanceCodes = pgTable('duty_attendance_codes', {
  id: serial('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  group: text('group').notNull(), // DUTY | LEAVE | BUSINESS | STUDY | SICK | OVERTIME | OTHER
  color: text('color').default('#0f766e').notNull(),
  /** Thuộc tính cũ, được giữ để không làm sai cấu hình/dữ liệu lịch sử. */
  countsAsDuty: boolean('counts_as_duty').default(false).notNull(),
  /** Thuộc tính cũ, được giữ để không làm sai cấu hình/dữ liệu lịch sử. */
  showSummary: boolean('show_summary').default(true).notNull(),
  /** Giá trị mỗi lần xuất hiện khi tổng hợp cột ký hiệu, ví dụ 0.5 hoặc 2. */
  countValue: numeric('count_value', { precision: 12, scale: 2 }).default('1').notNull(),
  /** Vai trò nghiệp vụ phục vụ biến hệ thống: trực, tăng cường, nghỉ bù hoặc không tham gia phân loại. */
  calculationRole: text('calculation_role').$type<DutyAttendanceCalculationRole>().default('NONE').notNull(),
  /** Nếu ký hiệu nằm vào ngày làm việc, giá trị đếm được trừ khỏi biến SYS_NGAY_CONG. */
  deductsWorkday: boolean('deducts_workday').default(false).notNull(),
  /** Với ký hiệu nghỉ bù, chọn loại ca trực trước đó được dò để phân loại. */
  restSource: text('rest_source').$type<DutyAttendanceRestSource>().default('ANY_DUTY').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  active: boolean('active').default(true).notNull(),
  note: text('note').default('').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('duty_attendance_codes_code_uq').on(t.code), index('duty_attendance_codes_active_idx').on(t.active, t.sortOrder)]);

/** Phần/băng cột của bảng: hành chính, ngày tháng, tổng ký hiệu, báo cáo hoặc phần do người dùng thêm. */
export const dutyAttendanceSections = pgTable('duty_attendance_sections', {
  id: serial('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  kind: text('kind').$type<DutyAttendanceSectionKind>().notNull(),
  color: text('color').default('#0f766e').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('duty_attendance_sections_code_uq').on(t.code), index('duty_attendance_sections_order_idx').on(t.active, t.sortOrder)]);

/** Cột do người quản trị khai báo. Giá trị công thức luôn tính lại, chỉ giá trị MANUAL mới lưu CSDL. */
export const dutyAttendanceColumns = pgTable('duty_attendance_columns', {
  id: serial('id').primaryKey(),
  sectionId: integer('section_id').notNull().references(() => dutyAttendanceSections.id, { onDelete: 'restrict' }),
  key: text('key').notNull(),
  name: text('name').notNull(),
  columnType: text('column_type').$type<DutyAttendanceColumnType>().notNull(),
  dataType: text('data_type').$type<DutyAttendanceDataType>().default('NUMBER').notNull(),
  formula: text('formula').default('').notNull(),
  placeholder: text('placeholder').default('Tự nhập').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('duty_attendance_columns_key_uq').on(t.key), index('duty_attendance_columns_section_order_idx').on(t.sectionId, t.active, t.sortOrder)]);

/** Quy tắc kiểm tra số liệu tự nhập, dùng biểu thức tham chiếu an toàn [MA_COT]. */
export const dutyAttendanceValidations = pgTable('duty_attendance_validations', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  expression: text('expression').notNull(),
  message: text('message').default('').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('duty_attendance_validations_order_idx').on(t.active, t.sortOrder)]);

/** Giá trị nhập theo nhân viên/tháng/cột; lịch sử ký hiệu ngày vẫn tiếp tục nằm tại dutyAttendanceEntries. */
export const dutyAttendanceManualValues = pgTable('duty_attendance_manual_values', {
  id: serial('id').primaryKey(),
  departmentId: integer('department_id').notNull().references(() => departments.id, { onDelete: 'restrict' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  month: text('month').notNull(),
  columnId: integer('column_id').notNull().references(() => dutyAttendanceColumns.id, { onDelete: 'restrict' }),
  value: text('value').default('').notNull(),
  updatedBy: integer('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('duty_attendance_manual_values_uq').on(t.departmentId, t.userId, t.month, t.columnId),
  index('duty_attendance_manual_values_month_idx').on(t.departmentId, t.month, t.userId),
]);

/** Ngày nghỉ lễ/đặc biệt ngoài thứ bảy, chủ nhật. */
export const dutyAttendanceHolidays = pgTable('duty_attendance_holidays', {
  id: serial('id').primaryKey(),
  holidayDate: date('holiday_date').notNull(),
  name: text('name').notNull(),
  note: text('note').default('').notNull(),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('duty_attendance_holidays_date_uq').on(t.holidayDate)]);

/** Một nhân viên, một ngày, một ký hiệu thực tế. Lịch trực chỉ để đối chiếu, không tự chấm. */
export const dutyAttendanceEntries = pgTable('duty_attendance_entries', {
  id: serial('id').primaryKey(),
  departmentId: integer('department_id').notNull().references(() => departments.id, { onDelete: 'restrict' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  workDate: date('work_date').notNull(),
  codeId: integer('code_id').notNull().references(() => dutyAttendanceCodes.id, { onDelete: 'restrict' }),
  note: text('note').default('').notNull(),
  updatedBy: integer('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('duty_attendance_entries_day_user_uq').on(t.userId, t.workDate),
  index('duty_attendance_entries_dept_month_idx').on(t.departmentId, t.workDate),
  index('duty_attendance_entries_code_idx').on(t.codeId),
]);
