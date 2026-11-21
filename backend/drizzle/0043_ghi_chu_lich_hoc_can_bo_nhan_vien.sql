-- 0043 · Ghi chú theo từng lượt học cán bộ nhân viên.
-- Default rỗng bảo toàn toàn bộ đăng ký lịch sử, không đổi ngày/khoa/người đã có.
ALTER TABLE "staff_learning_registrations"
  ADD COLUMN IF NOT EXISTS "note" text NOT NULL DEFAULT '';
