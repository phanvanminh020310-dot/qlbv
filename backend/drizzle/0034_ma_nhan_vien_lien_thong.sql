-- 0034 · Mã nhân viên liên thông (MANV).
-- Chỉ bổ sung một cột độc lập: tuyệt đối không đổi/tạo lại users.id nên mọi FK,
-- gồm user_biometrics.user_id, vẫn giữ nguyên liên kết sinh trắc học và dữ liệu lịch sử.
-- Không đặt UNIQUE: quy tắc được xác nhận lấy 4 ký tự đầu username có thể trùng ở dữ liệu cũ;
-- cưỡng bức unique sẽ làm đợt nâng cấp thất bại hoặc buộc sửa sai dữ liệu lịch sử.
ALTER TABLE users ADD COLUMN IF NOT EXISTS manv text;
--> statement-breakpoint
-- Chỉ điền các dòng chưa có mã. Giá trị MANV đã được nhập trước đó luôn được giữ nguyên.
UPDATE users
SET manv = left(username, 4)
WHERE manv IS NULL OR btrim(manv) = '';
--> statement-breakpoint
ALTER TABLE users ALTER COLUMN manv SET DEFAULT '';
--> statement-breakpoint
ALTER TABLE users ALTER COLUMN manv SET NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS users_manv_idx ON users(manv);
