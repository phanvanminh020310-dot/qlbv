-- 0041 · Lịch học cán bộ nhân viên theo tuần.
-- Mỗi nhân viên tự đăng ký từng ngày học; khoa được chụp tại thời điểm đăng ký
-- để bảng tuần/xuất Excel vẫn phản ánh đúng đơn vị lịch sử khi nhân sự chuyển khoa.
CREATE TABLE IF NOT EXISTS "staff_learning_registrations" (
  "id" serial PRIMARY KEY,
  "department_id" integer NOT NULL REFERENCES "departments"("id") ON DELETE RESTRICT,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "study_date" date NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "staff_learning_registrations_user_date_uq"
  ON "staff_learning_registrations" ("user_id", "study_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_learning_registrations_dept_week_idx"
  ON "staff_learning_registrations" ("department_id", "study_date", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_learning_registrations_date_idx"
  ON "staff_learning_registrations" ("study_date");
