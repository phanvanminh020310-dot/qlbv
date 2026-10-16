-- Vai trò xếp lịch trực cấp khoa và thu hồi thao tác tự phục vụ khỏi các vai trò hệ thống.
-- Phân công khoa thực tế vẫn được gán riêng qua user_department_scopes trong giao diện Quản trị.

INSERT INTO roles (code, name, description, data_scope, is_system, priority, color, sort_order, active)
VALUES (
  'NGUOI_XEP_LICH_TRUC_KHOA',
  'Người xếp lịch trực khoa',
  'Giao cho Hành chính khoa, Chủ nhiệm khoa hoặc Phó chủ nhiệm khoa để phân công, gỡ phân công, duyệt nghỉ/bận và duyệt đổi/nhường ca trong đúng các khoa được gán',
  'DEPT', true, 35, '#0f766e', 0, true
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  data_scope = EXCLUDED.data_scope,
  is_system = true,
  priority = EXCLUDED.priority,
  color = EXCLUDED.color,
  active = true,
  updated_at = now();

-- Vai trò mới chỉ điều phối trong khoa đã được gán, không có quyền tạo/công bố kỳ.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('duty.view', 'duty.manage', 'duty.swap.approve', 'duty.export')
WHERE r.code = 'NGUOI_XEP_LICH_TRUC_KHOA'
ON CONFLICT DO NOTHING;

-- Bỏ hẳn quyền tự đăng ký/đổi/nhường/báo nghỉ cũ, kể cả ở vai trò tự tạo;
-- sau migration không thể cấp lại qua UI quản trị.
DELETE FROM role_permissions rp
USING permissions p
WHERE rp.permission_id = p.id
  AND p.code = 'duty.register';

DELETE FROM permissions
WHERE code = 'duty.register';

-- Trưởng khoa chỉ được xem lịch với vai trò nền; muốn xếp phải được gán riêng vai trò mới.
DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.code = 'TRUONG_KHOA'
  AND p.code IN ('duty.manage', 'duty.swap.approve', 'duty.export');
