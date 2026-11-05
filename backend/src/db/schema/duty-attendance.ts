import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { departments } from './org';
import { users } from './system';

/** Danh mục ký hiệu chấm công – cấu hình được, không hard-code ở giao diện. */
export const dutyAttendanceCodes = pgTable('duty_attendance_codes', {
  id: serial('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  group: text('group').notNull(), // DUTY | LEAVE | BUSINESS | STUDY | SICK | OVERTIME | OTHER
  color: text('color').default('#0f766e').notNull(),
  countsAsDuty: boolean('counts_as_duty').default(false).notNull(),
  showSummary: boolean('show_summary').default(true).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  active: boolean('active').default(true).notNull(),
  note: text('note').default('').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('duty_attendance_codes_code_uq').on(t.code), index('duty_attendance_codes_active_idx').on(t.active, t.sortOrder)]);

/** Ngày nghỉ lễ/đặc biệt ngoài thứ bảy, chủ nhật để tính NN. */
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
