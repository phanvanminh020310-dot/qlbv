-- 0036 · Tách chức danh chuyên môn và chức vụ quản lý/kiêm nhiệm.
-- users.title được giữ nguyên tuyệt đối để tương thích dữ liệu, lịch trực và bảng chấm công cũ.
-- Không tự suy đoán bác sĩ từ chức vụ như “Chủ nhiệm khoa”: quản trị viên phải xác nhận
-- chức danh chuyên môn thực tế khi cập nhật hồ sơ để tránh cấp nhầm điều kiện xếp lịch khám.
ALTER TABLE users ADD COLUMN IF NOT EXISTS management_position text DEFAULT '' NOT NULL;
