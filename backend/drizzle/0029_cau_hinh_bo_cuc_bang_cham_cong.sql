-- 0029 · Bố cục bảng chấm công cấu hình được, giữ nguyên toàn bộ dữ liệu chấm công đang có.
-- Ký hiệu có giá trị đếm riêng; NN/NT cứng được thay bằng tổng theo từng ký hiệu.
ALTER TABLE duty_attendance_codes
  ADD COLUMN IF NOT EXISTS count_value numeric(12,2) NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE duty_attendance_codes
  DROP CONSTRAINT IF EXISTS duty_attendance_codes_count_value_chk;
--> statement-breakpoint
ALTER TABLE duty_attendance_codes
  ADD CONSTRAINT duty_attendance_codes_count_value_chk CHECK (count_value >= 0);
--> statement-breakpoint

-- Một phần là một dải cột của bảng. ADMIN/DAYS/SYMBOLS là phần hệ thống,
-- REPORT là phần báo cáo mặc định, CUSTOM dùng cho các phần khai báo thêm sau này.
CREATE TABLE IF NOT EXISTS duty_attendance_sections (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL,
  color text NOT NULL DEFAULT '#0f766e',
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT duty_attendance_sections_kind_chk CHECK (kind IN ('ADMIN', 'DAYS', 'SYMBOLS', 'REPORT', 'CUSTOM')),
  CONSTRAINT duty_attendance_sections_color_chk CHECK (color ~ '^#[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS duty_attendance_sections_order_idx ON duty_attendance_sections(active, sort_order);
--> statement-breakpoint

-- FORMULA: kết quả số từ biểu thức an toàn; MANUAL: người dùng nhập text hoặc số.
CREATE TABLE IF NOT EXISTS duty_attendance_columns (
  id serial PRIMARY KEY,
  section_id integer NOT NULL REFERENCES duty_attendance_sections(id) ON DELETE RESTRICT,
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  column_type text NOT NULL,
  data_type text NOT NULL DEFAULT 'NUMBER',
  formula text NOT NULL DEFAULT '',
  placeholder text NOT NULL DEFAULT 'Tự nhập',
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT duty_attendance_columns_type_chk CHECK (column_type IN ('FORMULA', 'MANUAL')),
  CONSTRAINT duty_attendance_columns_data_type_chk CHECK (data_type IN ('NUMBER', 'TEXT'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS duty_attendance_columns_section_order_idx ON duty_attendance_columns(section_id, active, sort_order);
--> statement-breakpoint

-- Ràng buộc tổng quát dùng cùng cú pháp biểu thức với cột công thức,
-- ví dụ: [CONG_A] + [CONG_B] + [CONG_C] == [CONG_HANH_CHINH].
CREATE TABLE IF NOT EXISTS duty_attendance_validations (
  id serial PRIMARY KEY,
  name text NOT NULL,
  expression text NOT NULL,
  message text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS duty_attendance_validations_order_idx ON duty_attendance_validations(active, sort_order);
--> statement-breakpoint

-- Chỉ giá trị cột tự nhập được lưu; cột ký hiệu và công thức luôn được tính lại từ dữ liệu gốc.
CREATE TABLE IF NOT EXISTS duty_attendance_manual_values (
  id serial PRIMARY KEY,
  department_id integer NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  month text NOT NULL,
  column_id integer NOT NULL REFERENCES duty_attendance_columns(id) ON DELETE RESTRICT,
  value text NOT NULL DEFAULT '',
  updated_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT duty_attendance_manual_values_month_chk CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT duty_attendance_manual_values_uq UNIQUE (department_id, user_id, month, column_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS duty_attendance_manual_values_month_idx ON duty_attendance_manual_values(department_id, month, user_id);
--> statement-breakpoint

INSERT INTO duty_attendance_sections (code, name, kind, color, sort_order) VALUES
  ('ADMIN', 'Thông tin hành chính', 'ADMIN', '#0f172a', 10),
  ('DAYS', 'Ngày trong tháng', 'DAYS', '#0369a1', 20),
  ('SYMBOLS', 'Tổng theo ký hiệu', 'SYMBOLS', '#0f766e', 30),
  ('REPORT', 'Báo cáo', 'REPORT', '#7c3aed', 40)
ON CONFLICT (code) DO NOTHING;
