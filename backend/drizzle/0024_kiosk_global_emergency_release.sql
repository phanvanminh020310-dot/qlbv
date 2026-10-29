-- 0024 · ADMIN mở khẩn cấp toàn bộ Kiosk theo đúng ca/roster hiện hành
-- Nhật ký này độc lập duty_attendance: không tạo điểm danh và không sửa lịch trực.
CREATE TABLE IF NOT EXISTS "kiosk_global_releases" (
  "id" text PRIMARY KEY NOT NULL,
  "operation_id" text NOT NULL,
  "room_id" integer REFERENCES "duty_rooms"("id") ON DELETE SET NULL,
  "room_code" text NOT NULL,
  "room_name" text NOT NULL,
  "roster_signature" text NOT NULL,
  "shift_end_at" timestamp with time zone NOT NULL,
  "activated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "activated_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "activated_by_username" text NOT NULL,
  "activated_by_full_name" text NOT NULL,
  "reason" text NOT NULL,
  "ended_at" timestamp with time zone,
  "end_reason" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kiosk_global_releases_room_active_idx"
  ON "kiosk_global_releases" ("room_code", "ended_at", "shift_end_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kiosk_global_releases_operation_idx"
  ON "kiosk_global_releases" ("operation_id");
