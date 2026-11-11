-- 0033 · Điều chỉnh lịch lễ từng năm và ngày làm bù/hoán đổi.
-- Chỉ bổ sung cấu trúc; không sửa hoặc xóa ngày lễ, chấm công hay báo cáo lịch sử.
ALTER TABLE duty_attendance_national_holiday_plans
  ADD COLUMN IF NOT EXISTS additional_rest_days jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS compensatory_workdays jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE duty_attendance_national_holiday_plans DROP CONSTRAINT IF EXISTS duty_attendance_national_holiday_plans_additional_rest_days_array_chk;
--> statement-breakpoint
ALTER TABLE duty_attendance_national_holiday_plans
  ADD CONSTRAINT duty_attendance_national_holiday_plans_additional_rest_days_array_chk CHECK (jsonb_typeof(additional_rest_days) = 'array');
--> statement-breakpoint
ALTER TABLE duty_attendance_national_holiday_plans DROP CONSTRAINT IF EXISTS duty_attendance_national_holiday_plans_compensatory_workdays_array_chk;
--> statement-breakpoint
ALTER TABLE duty_attendance_national_holiday_plans
  ADD CONSTRAINT duty_attendance_national_holiday_plans_compensatory_workdays_array_chk CHECK (jsonb_typeof(compensatory_workdays) = 'array');
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS duty_attendance_workday_overrides (
  id serial PRIMARY KEY,
  work_date date NOT NULL UNIQUE,
  name text NOT NULL,
  note text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'HOSPITAL' CHECK (source IN ('HOSPITAL', 'NATIONAL_TEMPLATE')),
  rule_key text NOT NULL DEFAULT '',
  workday_year integer CHECK (workday_year IS NULL OR workday_year BETWEEN 1900 AND 2100),
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS duty_attendance_workday_overrides_source_year_idx ON duty_attendance_workday_overrides(source, workday_year);
