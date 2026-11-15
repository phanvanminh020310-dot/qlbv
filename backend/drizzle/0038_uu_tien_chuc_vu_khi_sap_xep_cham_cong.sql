-- 0038 · Bảng chấm công mặc định ưu tiên thứ tự danh mục chức vụ/kiêm nhiệm,
-- sau đó mới đến thứ tự chức danh chuyên môn. Quản trị viên vẫn có thể đổi lại
-- PROFESSIONAL tại Cấu hình hệ thống nếu quy trình đơn vị yêu cầu.
-- Chỉ nâng giá trị mặc định cũ PROFESSIONAL; dữ liệu/sắp xếp danh mục không đổi.
UPDATE "settings"
SET "value" = '"MANAGEMENT_THEN_PROFESSIONAL"'::jsonb,
    "updated_at" = now()
WHERE "key" = 'dutyAttendance.staffOrderMode'
  AND "value" = '"PROFESSIONAL"'::jsonb;
