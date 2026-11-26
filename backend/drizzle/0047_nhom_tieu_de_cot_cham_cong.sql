-- 0047 · Nhóm tiêu đề cột nhiều tầng cho bảng chấm công (VD: Trực theo quy định › Ngày lễ › Trực/Nghỉ trực/Làm thêm).
-- Chỉ là cấu hình hiển thị: không đổi mã cột, công thức hay số liệu đã nhập. Nhóm có thể lồng nhau
-- (parent_id), thuộc một phần Báo cáo/phần tự tạo; cột chưa gán nhóm hiển thị như trước.
CREATE TABLE IF NOT EXISTS duty_attendance_column_groups (
  id serial PRIMARY KEY,
  section_id integer NOT NULL REFERENCES duty_attendance_sections(id) ON DELETE RESTRICT,
  parent_id integer REFERENCES duty_attendance_column_groups(id) ON DELETE RESTRICT,
  name text NOT NULL,
  color text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS duty_attendance_column_groups_tree_idx
  ON duty_attendance_column_groups(section_id, parent_id, sort_order);
--> statement-breakpoint
ALTER TABLE duty_attendance_columns
  ADD COLUMN IF NOT EXISTS group_id integer REFERENCES duty_attendance_column_groups(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS duty_attendance_columns_group_idx ON duty_attendance_columns(group_id);
