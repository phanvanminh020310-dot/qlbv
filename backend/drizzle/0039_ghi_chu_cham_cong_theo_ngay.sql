-- 0039 · Ghi chú chấm công là dữ liệu độc lập theo nhân viên/ngày,
-- không phụ thuộc vào việc ngày đó có chọn ký hiệu hay không.
CREATE TABLE IF NOT EXISTS "duty_attendance_daily_notes" (
  "id" serial PRIMARY KEY,
  "department_id" integer NOT NULL REFERENCES "departments"("id") ON DELETE RESTRICT,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "work_date" date NOT NULL,
  "note" text NOT NULL DEFAULT '',
  "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "duty_attendance_daily_notes_user_date_uq"
  ON "duty_attendance_daily_notes" ("user_id", "work_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "duty_attendance_daily_notes_dept_month_idx"
  ON "duty_attendance_daily_notes" ("department_id", "work_date", "user_id");
--> statement-breakpoint
-- Bảo toàn tất cả ghi chú cũ vốn đang nằm cùng dòng ký hiệu chấm công.
INSERT INTO "duty_attendance_daily_notes" ("department_id", "user_id", "work_date", "note", "updated_by", "created_at", "updated_at")
SELECT "department_id", "user_id", "work_date", "note", "updated_by", "created_at", "updated_at"
FROM "duty_attendance_entries"
WHERE btrim("note") <> ''
ON CONFLICT ("user_id", "work_date") DO NOTHING;
