-- 0042 · Phân quyền Lịch học cán bộ nhân viên.
-- Người được giao vai trò nhập lịch chỉ thao tác trong khoa/phòng được gán;
-- điều phối KHTH có quyền xem và xuất toàn viện, không tự động có quyền nhập thay.

INSERT INTO "permissions" ("code", "name", "module", "action", "description", "is_system") VALUES
  ('staff-learning.view', 'Xem lịch học cán bộ nhân viên', 'staff-learning', 'view', 'Xem lịch học theo phạm vi khoa/phòng được gán', true),
  ('staff-learning.register', 'Đăng ký lịch học cán bộ nhân viên', 'staff-learning', 'register', 'Đăng ký hoặc gỡ lịch học cho nhân viên thuộc khoa/phòng được gán', true),
  ('staff-learning.export', 'Xuất lịch học cán bộ nhân viên', 'staff-learning', 'export', 'Xuất Excel lịch học theo phạm vi khoa/phòng được gán', true)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "module" = EXCLUDED."module",
  "action" = EXCLUDED."action",
  "description" = EXCLUDED."description",
  "is_system" = true;
--> statement-breakpoint

INSERT INTO "roles" ("code", "name", "description", "data_scope", "is_system", "priority", "color", "sort_order", "active") VALUES
  (
    'DANG_KY_LICH_HOC_CAN_BO_NHAN_VIEN',
    'Đăng ký lịch học cán bộ nhân viên',
    'Giao cho nhân viên phụ trách khoa/phòng để xem, đăng ký, gỡ và xuất lịch học của nhân viên trong đúng các khoa/phòng được gán.',
    'DEPT', true, 35, '#0f766e', 0, true
  )
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "data_scope" = EXCLUDED."data_scope",
  "is_system" = true,
  "priority" = EXCLUDED."priority",
  "color" = EXCLUDED."color",
  "active" = true,
  "updated_at" = now();
--> statement-breakpoint

-- Người được giao vai trò nhập lịch được thao tác trong đúng phạm vi khoa/phòng của mình.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'staff-learning.view', 'staff-learning.register', 'staff-learning.export'
)
WHERE r."code" = 'DANG_KY_LICH_HOC_CAN_BO_NHAN_VIEN'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Điều phối KHTH xem/xuất toàn viện theo data_scope=ALL; quyền nhập vẫn phải gán rõ
-- bằng vai trò Đăng ký lịch học cán bộ nhân viên để tránh sửa dữ liệu ngoài ý muốn.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('staff-learning.view', 'staff-learning.export')
WHERE r."code" = 'DIEU_PHOI_TRUC'
ON CONFLICT DO NOTHING;
