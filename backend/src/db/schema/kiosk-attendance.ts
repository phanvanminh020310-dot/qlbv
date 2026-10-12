import { integer, pgTable, real, serial, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { users } from './system';
import { dutyRooms, dutySlots } from './duty';

/**
 * Hồ sơ sinh trắc học khuôn mặt của nhân viên/bác sĩ
 * Lưu trữ vector đặc trưng ArcFace (mã hoá AES-256) và đường dẫn ảnh đại diện
 */
export const userBiometrics = pgTable(
  'user_biometrics',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Vector đặc trưng khuôn mặt 128 chiều đã mã hoá AES-256-GCM */
    faceDescriptor: text('face_descriptor').notNull(),
    /** Đường dẫn ảnh chân dung thực tế trong uploads */
    avatarPath: text('avatar_path'),
    /** Dữ liệu ảnh khuôn mặt gốc (Base64 JPEG) — lưu trực tiếp trong CSDL để tự động sao lưu & phục hồi toàn vẹn */
    avatarData: text('avatar_data'),
    /** Số mẫu khuôn mặt đã thu thập */
    sampleCount: integer('sample_count').default(3).notNull(),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userUq: uniqueIndex('user_biometrics_user_uq').on(t.userId),
  }),
);

/**
 * Nhật ký điểm danh ca trực & mở khoá phòng khám bằng sinh trắc học
 */
export const dutyAttendance = pgTable(
  'duty_attendance',
  {
    id: text('id').primaryKey(),
    slotId: integer('slot_id').references(() => dutySlots.id, { onDelete: 'set null' }),
    roomId: integer('room_id').references(() => dutyRooms.id, { onDelete: 'set null' }),
    roomCode: text('room_code').notNull(),
    roomName: text('room_name').notNull(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    username: text('username').notNull(),
    fullName: text('full_name').notNull(),
    title: text('title').notNull(),
    shiftCode: text('shift_code').notNull(),
    shiftName: text('shift_name').notNull(),
    checkinTime: timestamp('checkin_time', { withTimezone: true }).defaultNow().notNull(),
    checkoutTime: timestamp('checkout_time', { withTimezone: true }),
    /** ON_TIME | LATE | EMERGENCY_OVERRIDE */
    status: text('status').default('ON_TIME').notNull(),
    /** Điểm tin cậy so khớp sinh trắc học (0.0 đến 1.0) */
    confidenceScore: real('confidence_score').default(1.0).notNull(),
    /** AI_FACIAL_BIOMETRICS | IT_EMERGENCY_PIN */
    method: text('method').default('AI_FACIAL_BIOMETRICS').notNull(),
    deviceInfo: text('device_info'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    roomDateIdx: index('duty_attendance_room_date_idx').on(t.roomCode, t.checkinTime),
    userIdx: index('duty_attendance_user_idx').on(t.userId),
  }),
);
