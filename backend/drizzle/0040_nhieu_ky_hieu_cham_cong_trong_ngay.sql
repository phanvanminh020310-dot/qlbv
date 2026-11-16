-- 0040 · Một nhân viên có thể có nhiều ký hiệu trong cùng một ngày.
-- Bảng duty_attendance_entries cũ được giữ làm dòng tương thích (ký hiệu đầu tiên)
-- cho dữ liệu/phiên bản cũ; bảng nối này là nguồn dữ liệu đầy đủ mới.
CREATE TABLE IF NOT EXISTS "duty_attendance_entry_codes" (
  "id" serial PRIMARY KEY,
  "department_id" integer NOT NULL REFERENCES "departments"("id") ON DELETE RESTRICT,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "work_date" date NOT NULL,
  "code_id" integer NOT NULL REFERENCES "duty_attendance_codes"("id") ON DELETE RESTRICT,
  "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "duty_attendance_entry_codes_user_day_code_uq"
  ON "duty_attendance_entry_codes" ("user_id", "work_date", "code_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "duty_attendance_entry_codes_dept_month_idx"
  ON "duty_attendance_entry_codes" ("department_id", "work_date", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "duty_attendance_entry_codes_code_idx"
  ON "duty_attendance_entry_codes" ("code_id");
--> statement-breakpoint
-- Sao chép toàn bộ ký hiệu lịch sử; không thay đổi hay xóa dòng chấm công cũ.
INSERT INTO "duty_attendance_entry_codes" ("department_id", "user_id", "work_date", "code_id", "updated_by", "created_at", "updated_at")
SELECT "department_id", "user_id", "work_date", "code_id", "updated_by", "created_at", "updated_at"
FROM "duty_attendance_entries"
ON CONFLICT ("user_id", "work_date", "code_id") DO NOTHING;
