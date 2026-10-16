/* ============================================================
   0023 — Bổ sung vai trò Nhân viên trực khám cho bác sĩ hiện hữu

   - Đồng bộ dữ liệu đã có trên VPS khi chức danh là “Bác sĩ” hoặc “Bác Sỹ”.
   - Chỉ bổ sung, không thay thế hay thu hồi bất kỳ vai trò hiện có nào.
   - Chạy lặp an toàn nhờ khoá chính (user_id, role_id).
   ============================================================ */

-- Phòng trường hợp một CSDL cũ chưa có dữ liệu vai trò từ migration lịch trực.
INSERT INTO roles (code, name, description, data_scope, is_system, priority, color)
SELECT 'NHAN_VIEN_TRUC', 'Nhân viên trực khám',
       'Bác sĩ, điều dưỡng tham gia trực phòng khám: chỉ xem lịch trực đã công bố; việc xếp, đổi/nhường ca và ghi nhận nghỉ/bận do người xếp lịch trực khoa xử lý',
       'OWN', true, 90, '#16a34a'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'NHAN_VIEN_TRUC');

-- lower() nhận cả cách viết “Bác sĩ” và “Bác Sỹ”, không phụ thuộc hoa/thường.
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
CROSS JOIN roles r
WHERE r.code = 'NHAN_VIEN_TRUC'
  AND u.deleted_at IS NULL
  AND lower(trim(u.title)) IN ('bác sĩ', 'bác sỹ')
ON CONFLICT (user_id, role_id) DO NOTHING;
