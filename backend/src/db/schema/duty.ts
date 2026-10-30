/**
 * PHÂN HỆ LỊCH TRỰC KHÁM BỆNH
 *
 *  Danh mục : phòng khám · ca trực (giờ, qua đêm, ca đêm) · vai trò trực (chức danh yêu cầu) · ngày nghỉ
 *  Kỳ lịch  : thường là một tuần — NHAP (nháp) → CONG_BO (đã công bố, còn điều chỉnh) → DA_CHOT
 *             Có thời điểm chốt (lock_at): sau mốc này tự khoá, thay đổi chỉ qua yêu cầu ngoại lệ tới KHTH.
 *  Ô trực   : (ngày × phòng × ca × vai trò) + số người cần. Phân công = người trực trong ô.
 *  Nghỉ phép: khoảng ngày vắng mặt của nhân viên — chặn xếp trực trong khoảng đó.
 *  Yêu cầu  : NHUONG (nhường ca) · DOI (đổi ca) — cần người nhận chấp nhận và (tuỳ cấu hình) được duyệt;
 *             NGOAI_LE — sự cố/đổi trực ngoài dự kiến, gửi KHTH xử lý (kể cả sau khi đã chốt).
 *  Nhật ký  : mọi thay đổi lịch kèm lý do (lịch sử nghiệp vụ, song song với audit chung của hệ thống).
 *
 * Mọi mã/trạng thái là text để thêm loại mới không cần migration.
 */
import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { departments } from './org';
import { users } from './system';

export const DUTY_PERIOD_STATUSES = ['NHAP', 'CONG_BO', 'DA_CHOT'] as const;
export const DUTY_REQUEST_TYPES = ['NHUONG', 'DOI', 'NGOAI_LE'] as const;
export const DUTY_REQUEST_STATUSES = ['CHO_NGUOI_NHAN', 'CHO_DUYET', 'DA_DUYET', 'TU_CHOI', 'HUY'] as const;
export const DUTY_ASSIGN_SOURCES = ['DANG_KY', 'PHAN_CONG', 'NHUONG', 'DOI', 'NGOAI_LE', 'DIEU_CHINH'] as const;

export type DutyPeriodStatus = (typeof DUTY_PERIOD_STATUSES)[number];
export type DutyRequestType = (typeof DUTY_REQUEST_TYPES)[number];
export type DutyRequestStatus = (typeof DUTY_REQUEST_STATUSES)[number];

/** Cấu hình ràng buộc của từng kỳ lịch (0 = không giới hạn) */
export interface DutyRules {
  /** Số ca tối đa trong một ngày (cùng một ca ở nhiều phòng chỉ tính một lần) */
  maxShiftsPerDay: number;
  /** Số ca tối đa trong cả kỳ */
  maxShiftsPerPeriod: number;
  /** Số ca đêm tối đa trong cả kỳ */
  maxNightShiftsPerPeriod: number;
  /** Số giờ trực tối đa trong một ngày (BLLĐ 2019 Điều 105: ≤10 giờ/ngày nếu tính theo tuần) */
  maxHoursPerDay: number;
  /** Số giờ trực tối đa trong một tuần (BLLĐ 2019 Điều 105: ≤48 giờ/tuần) */
  maxHoursPerWeek: number;
  /** Khoảng nghỉ tối thiểu (giờ) giữa hai ca không liền kề */
  minRestHours: number;
  /** Nhân viên khác khoa với phòng khám: CHO_PHEP | CANH_BAO (cảnh báo mềm) | CHAN (chặn) */
  crossDeptPolicy: 'CHO_PHEP' | 'CANH_BAO' | 'CHAN';
  /** Nhân viên được tự đăng ký ca trống sau khi kỳ được công bố */
  allowSelfRegister: boolean;
  /** Đổi/nhường ca trước khi chốt có cần Trưởng khoa/Điều phối duyệt sau khi người nhận đồng ý */
  swapNeedsApproval: boolean;
  /** Chặn công bố khi còn ô thiếu người (KHTH vẫn có thể công bố có ghi nhận) */
  requireFullBeforePublish: boolean;
}

export const dutyRooms = pgTable(
  'duty_rooms',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    departmentId: integer('department_id').references(() => departments.id, { onDelete: 'set null' }),
    location: text('location').default('').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    active: boolean('active').default(true).notNull(),
    note: text('note').default('').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('duty_rooms_code_uq').on(sql`lower(${t.code})`), index('duty_rooms_dept_idx').on(t.departmentId)],
);

export const dutyShiftTypes = pgTable(
  'duty_shift_types',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** HH:MM */
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    /** Giờ kết thúc ≤ giờ bắt đầu → ca kéo sang ngày hôm sau */
    crossesMidnight: boolean('crosses_midnight').default(false).notNull(),
    /** Ca đêm: tính riêng giới hạn ca đêm và khoảng nghỉ liền kề */
    isNight: boolean('is_night').default(false).notNull(),
    color: text('color').default('#2563eb').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    active: boolean('active').default(true).notNull(),
    note: text('note').default('').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('duty_shift_types_code_uq').on(sql`lower(${t.code})`)],
);

export const dutyRoles = pgTable(
  'duty_roles',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** Chức danh người được xếp vào vai trò này (rỗng = không yêu cầu). Khớp với users.title */
    requiredTitle: text('required_title').default('').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    active: boolean('active').default(true).notNull(),
    note: text('note').default('').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('duty_roles_code_uq').on(sql`lower(${t.code})`)],
);

export const dutyClosedDays = pgTable(
  'duty_closed_days',
  {
    id: serial('id').primaryKey(),
    date: date('date', { mode: 'string' }).notNull(),
    name: text('name').notNull(),
    note: text('note').default('').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('duty_closed_days_date_uq').on(t.date)],
);

export const dutyPeriods = pgTable(
  'duty_periods',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    status: text('status').$type<DutyPeriodStatus>().default('NHAP').notNull(),
    /** Mở đăng ký tự nguyện cho nhân viên (null = mở ngay khi công bố) */
    registrationOpensAt: timestamp('registration_opens_at', { withTimezone: true }),
    /** Thời điểm chốt lịch — từ mốc này kỳ tự khoá */
    lockAt: timestamp('lock_at', { withTimezone: true }).notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    rules: jsonb('rules').$type<DutyRules>().default({} as DutyRules).notNull(),
    note: text('note').default('').notNull(),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: integer('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('duty_periods_dates_idx').on(t.startDate, t.endDate)],
);

export const dutySlots = pgTable(
  'duty_slots',
  {
    id: serial('id').primaryKey(),
    periodId: integer('period_id')
      .notNull()
      .references(() => dutyPeriods.id, { onDelete: 'cascade' }),
    dutyDate: date('duty_date', { mode: 'string' }).notNull(),
    roomId: integer('room_id')
      .notNull()
      .references(() => dutyRooms.id, { onDelete: 'restrict' }),
    shiftId: integer('shift_id')
      .notNull()
      .references(() => dutyShiftTypes.id, { onDelete: 'restrict' }),
    roleId: integer('role_id')
      .notNull()
      .references(() => dutyRoles.id, { onDelete: 'restrict' }),
    requiredCount: integer('required_count').default(1).notNull(),
    note: text('note').default('').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('duty_slots_uq').on(t.periodId, t.dutyDate, t.roomId, t.shiftId, t.roleId),
    index('duty_slots_period_date_idx').on(t.periodId, t.dutyDate),
  ],
);

export const dutyAssignments = pgTable(
  'duty_assignments',
  {
    id: serial('id').primaryKey(),
    slotId: integer('slot_id')
      .notNull()
      .references(() => dutySlots.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    source: text('source').$type<(typeof DUTY_ASSIGN_SOURCES)[number]>().default('PHAN_CONG').notNull(),
    note: text('note').default('').notNull(),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('duty_assignments_uq').on(t.slotId, t.userId), index('duty_assignments_user_idx').on(t.userId)],
);

export const dutyAbsences = pgTable(
  'duty_absences',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    /** PHEP_NAM | OM_DAU | HOC_TAP | CONG_TAC | KHAC */
    reason: text('reason').default('KHAC').notNull(),
    note: text('note').default('').notNull(),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('duty_absences_user_idx').on(t.userId, t.startDate, t.endDate)],
);

/** Workflow-only records. Only approval may insert an operational dutyAbsences row. */
export const dutyAbsenceRequests = pgTable(
  'duty_absence_requests',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    reason: text('reason').default('KHAC').notNull(),
    note: text('note').default('').notNull(),
    status: text('status').$type<'CHO_DUYET' | 'DA_DUYET' | 'TU_CHOI' | 'HUY'>().default('CHO_DUYET').notNull(),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedBy: integer('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    responseNote: text('response_note').default('').notNull(),
    approvedAbsenceId: integer('approved_absence_id').references(() => dutyAbsences.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('duty_absence_requests_user_idx').on(t.userId, t.startDate, t.endDate), index('duty_absence_requests_status_idx').on(t.status, t.createdAt)],
);

export const dutyRequests = pgTable(
  'duty_requests',
  {
    id: serial('id').primaryKey(),
    periodId: integer('period_id')
      .notNull()
      .references(() => dutyPeriods.id, { onDelete: 'cascade' }),
    type: text('type').$type<DutyRequestType>().notNull(),
    status: text('status').$type<DutyRequestStatus>().default('CHO_NGUOI_NHAN').notNull(),
    requesterId: integer('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Ca của người yêu cầu (NHUONG/DOI) hoặc ca bị ảnh hưởng (NGOAI_LE) */
    slotId: integer('slot_id')
      .notNull()
      .references(() => dutySlots.id, { onDelete: 'cascade' }),
    /** NHUONG: người nhận · DOI: người đổi · NGOAI_LE: người cần thay */
    targetUserId: integer('target_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** DOI: ca của người đổi */
    targetSlotId: integer('target_slot_id').references(() => dutySlots.id, { onDelete: 'set null' }),
    /** NGOAI_LE: người thay đề xuất / được KHTH chỉ định */
    replacementUserId: integer('replacement_user_id').references(() => users.id, { onDelete: 'set null' }),
    urgent: boolean('urgent').default(false).notNull(),
    reason: text('reason').notNull(),
    responseNote: text('response_note').default('').notNull(),
    targetRespondedAt: timestamp('target_responded_at', { withTimezone: true }),
    resolvedBy: integer('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('duty_requests_status_idx').on(t.status),
    index('duty_requests_requester_idx').on(t.requesterId),
    index('duty_requests_target_idx').on(t.targetUserId),
    index('duty_requests_period_idx').on(t.periodId),
  ],
);

export const dutyLogs = pgTable(
  'duty_logs',
  {
    id: serial('id').primaryKey(),
    periodId: integer('period_id').references(() => dutyPeriods.id, { onDelete: 'set null' }),
    /** Không khoá ngoại: giữ lịch sử kể cả khi ô đã bị xoá */
    slotId: integer('slot_id'),
    requestId: integer('request_id'),
    action: text('action').notNull(),
    actorId: integer('actor_id').references(() => users.id, { onDelete: 'set null' }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason').default('').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('duty_logs_period_idx').on(t.periodId, t.createdAt), index('duty_logs_created_idx').on(t.createdAt)],
);
