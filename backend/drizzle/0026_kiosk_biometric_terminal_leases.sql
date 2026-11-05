-- 0026 · Lease mở Kiosk sinh trắc học theo đúng máy trạm, tồn tại qua restart API
-- Không dùng duty_attendance làm authority vì một lượt điểm danh không lưu danh tính máy trạm.
CREATE TABLE IF NOT EXISTS "kiosk_biometric_terminal_leases" (
  "id" text PRIMARY KEY NOT NULL,
  "attendance_id" text NOT NULL REFERENCES "duty_attendance"("id") ON DELETE CASCADE,
  "slot_id" integer REFERENCES "duty_slots"("id") ON DELETE SET NULL,
  "room_id" integer REFERENCES "duty_rooms"("id") ON DELETE SET NULL,
  "room_code" text NOT NULL,
  "room_name" text NOT NULL,
  "terminal_id" text NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "username" text NOT NULL,
  "full_name" text NOT NULL,
  "title" text NOT NULL,
  "duty_date" text NOT NULL,
  "shift_code" text NOT NULL,
  "shift_name" text NOT NULL,
  "shift_end_at" timestamp with time zone NOT NULL,
  "verified_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ended_at" timestamp with time zone,
  "end_reason" text
);
--> statement-breakpoint
-- Mỗi máy trạm chỉ có một quyền mở sinh trắc học còn hiệu lực. Phiên cũ phải
-- được đóng trong cùng transaction trước khi một lần xác thực mới được ghi.
CREATE UNIQUE INDEX IF NOT EXISTS "kiosk_biometric_terminal_leases_active_target_uq"
  ON "kiosk_biometric_terminal_leases" ("room_code", "terminal_id")
  WHERE "ended_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kiosk_biometric_terminal_leases_target_idx"
  ON "kiosk_biometric_terminal_leases" ("room_code", "terminal_id", "ended_at", "shift_end_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kiosk_biometric_terminal_leases_active_idx"
  ON "kiosk_biometric_terminal_leases" ("ended_at", "shift_end_at");
