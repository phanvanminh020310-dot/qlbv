-- 0032 · Phương án lịch nghỉ lễ Nhà nước theo năm, luôn được bệnh viện xem trước/xác nhận.
-- Không sửa ngày lễ hoặc dữ liệu chấm công đã có: các ngày cũ mặc định là HOSPITAL.
ALTER TABLE duty_attendance_holidays
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'HOSPITAL',
  ADD COLUMN IF NOT EXISTS rule_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS holiday_year integer;
--> statement-breakpoint
ALTER TABLE duty_attendance_holidays DROP CONSTRAINT IF EXISTS duty_attendance_holidays_source_chk;
--> statement-breakpoint
ALTER TABLE duty_attendance_holidays
  ADD CONSTRAINT duty_attendance_holidays_source_chk CHECK (source IN ('HOSPITAL', 'NATIONAL_TEMPLATE'));
--> statement-breakpoint
ALTER TABLE duty_attendance_holidays DROP CONSTRAINT IF EXISTS duty_attendance_holidays_year_chk;
--> statement-breakpoint
ALTER TABLE duty_attendance_holidays
  ADD CONSTRAINT duty_attendance_holidays_year_chk CHECK (holiday_year IS NULL OR holiday_year BETWEEN 1900 AND 2100);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS duty_attendance_holidays_source_year_idx ON duty_attendance_holidays(source, holiday_year);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS duty_attendance_national_holiday_plans (
  year integer PRIMARY KEY CHECK (year BETWEEN 1900 AND 2100),
  tet_start_offset integer NOT NULL DEFAULT -2 CHECK (tet_start_offset BETWEEN -10 AND 10),
  tet_day_count integer NOT NULL DEFAULT 5 CHECK (tet_day_count BETWEEN 1 AND 10),
  national_day_adjacent text NOT NULL DEFAULT 'AFTER' CHECK (national_day_adjacent IN ('BEFORE', 'AFTER')),
  compensate_weekly_rest boolean NOT NULL DEFAULT true,
  note text NOT NULL DEFAULT '',
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  updated_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
