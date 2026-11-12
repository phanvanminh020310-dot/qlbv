-- 0035 · Lịch sử chuyển khoa phục vụ bảng chấm công.
-- Không sửa/chuyển bất kỳ dòng chấm công hay số liệu tự nhập cũ nào. Mỗi mốc
-- bắt đầu hiệu lực từ đầu ngày, mốc tiếp theo của cùng nhân viên tự khép mốc trước.
CREATE TABLE IF NOT EXISTS duty_attendance_department_assignments (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  department_id integer NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  effective_from date NOT NULL,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT duty_attendance_department_assignments_user_from_uq UNIQUE (user_id, effective_from)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS duty_attendance_department_assignments_department_from_idx
  ON duty_attendance_department_assignments(department_id, effective_from);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS duty_attendance_department_assignments_user_from_idx
  ON duty_attendance_department_assignments(user_id, effective_from);
--> statement-breakpoint
-- Tạo mốc nền thật xa trong quá khứ cho nhân viên đang có khoa. Dữ liệu lịch sử
-- vốn đã nằm ở duty_attendance_entries/manual_values vẫn giữ nguyên department_id
-- và luôn được bảng/biểu mẫu đọc thêm, kể cả khi chưa thể suy luận ngày chuyển cũ.
INSERT INTO duty_attendance_department_assignments (user_id, department_id, effective_from)
SELECT id, department_id, DATE '1900-01-01'
FROM users
WHERE department_id IS NOT NULL
ON CONFLICT (user_id, effective_from) DO NOTHING;
