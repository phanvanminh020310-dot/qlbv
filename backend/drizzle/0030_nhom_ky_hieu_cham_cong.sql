-- 0030 · Danh mục nhóm ký hiệu chấm công. Không sửa dữ liệu ký hiệu/lịch sử hiện có.
CREATE TABLE IF NOT EXISTS duty_attendance_code_groups (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS duty_attendance_code_groups_active_idx ON duty_attendance_code_groups(active, sort_order);
--> statement-breakpoint

-- Nhóm chuẩn tiếng Việt cho dữ liệu khởi tạo và lựa chọn nhanh.
INSERT INTO duty_attendance_code_groups (code, name, sort_order) VALUES
  ('DUTY', 'Trực', 10),
  ('LEAVE', 'Nghỉ phép', 20),
  ('BUSINESS', 'Công tác', 30),
  ('STUDY', 'Học tập', 40),
  ('SICK', 'Ốm', 50),
  ('OVERTIME', 'Tăng cường / làm thêm', 60),
  ('OTHER', 'Khác', 70)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

-- Bất kỳ nhóm tùy biến cũ nào cũng được đưa vào danh mục trước, để mọi mã ký hiệu
-- và lịch sử của đơn vị tiếp tục hợp lệ sau cập nhật.
INSERT INTO duty_attendance_code_groups (code, name, sort_order)
SELECT DISTINCT upper(trim("group")), trim("group"), 100
FROM duty_attendance_codes
WHERE trim("group") <> ''
ON CONFLICT (code) DO NOTHING;
