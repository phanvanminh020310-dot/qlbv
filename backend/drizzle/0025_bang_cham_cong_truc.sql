-- 0025 · Bảng chấm công trực và chấm công khác (nhập tay, tách khỏi lịch trực khám)
CREATE TABLE IF NOT EXISTS duty_attendance_codes (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  "group" text NOT NULL,
  color text NOT NULL DEFAULT '#0f766e',
  counts_as_duty boolean NOT NULL DEFAULT false,
  show_summary boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS duty_attendance_codes_active_idx ON duty_attendance_codes(active, sort_order);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS duty_attendance_holidays (
  id serial PRIMARY KEY,
  holiday_date date NOT NULL UNIQUE,
  name text NOT NULL,
  note text NOT NULL DEFAULT '',
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS duty_attendance_entries (
  id serial PRIMARY KEY,
  department_id integer NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  work_date date NOT NULL,
  code_id integer NOT NULL REFERENCES duty_attendance_codes(id) ON DELETE RESTRICT,
  note text NOT NULL DEFAULT '',
  updated_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT duty_attendance_entries_day_user_uq UNIQUE (user_id, work_date)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS duty_attendance_entries_dept_month_idx ON duty_attendance_entries(department_id, work_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS duty_attendance_entries_code_idx ON duty_attendance_entries(code_id);
--> statement-breakpoint
INSERT INTO duty_attendance_codes (code, name, "group", color, counts_as_duty, show_summary, sort_order, note) VALUES
 ('T', 'Trực', 'DUTY', '#0f766e', true, false, 10, 'Trực; tự tổng NN (ngày nghỉ) và NT (ngày thường)'),
 ('P', 'Phép', 'LEAVE', '#2563eb', false, true, 20, 'Nghỉ phép'),
 ('CT', 'Công tác', 'BUSINESS', '#7c3aed', false, true, 30, 'Công tác'),
 ('H', 'Học', 'STUDY', '#0891b2', false, true, 40, 'Học tập'),
 ('O', 'Ốm', 'SICK', '#dc2626', false, true, 50, 'Ốm'),
 ('TC', 'Tăng cường', 'OVERTIME', '#ea580c', false, false, 60, 'Tăng cường'),
 ('K', 'Khác', 'OTHER', '#64748b', false, true, 70, 'Khác')
ON CONFLICT (code) DO NOTHING;
