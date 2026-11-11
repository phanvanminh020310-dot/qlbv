-- 0031 · Biến công thức nghiệp vụ cho bảng chấm công.
-- Chỉ bổ sung metadata cấu hình và cột báo cáo mặc định; không sửa/xóa bất kỳ dòng chấm công lịch sử nào.
ALTER TABLE duty_attendance_codes
  ADD COLUMN IF NOT EXISTS calculation_role text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS deducts_workday boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rest_source text NOT NULL DEFAULT 'ANY_DUTY';
--> statement-breakpoint
ALTER TABLE duty_attendance_codes DROP CONSTRAINT IF EXISTS duty_attendance_codes_calculation_role_chk;
--> statement-breakpoint
ALTER TABLE duty_attendance_codes
  ADD CONSTRAINT duty_attendance_codes_calculation_role_chk CHECK (calculation_role IN ('NONE', 'DUTY', 'REINFORCEMENT', 'REST'));
--> statement-breakpoint
ALTER TABLE duty_attendance_codes DROP CONSTRAINT IF EXISTS duty_attendance_codes_rest_source_chk;
--> statement-breakpoint
ALTER TABLE duty_attendance_codes
  ADD CONSTRAINT duty_attendance_codes_rest_source_chk CHECK (rest_source IN ('ANY_DUTY', 'DUTY', 'REINFORCEMENT'));
--> statement-breakpoint

-- Mặc định chỉ gán nghĩa nghiệp vụ cho các mã đã công bố trong bảng mẫu;
-- ký hiệu tùy biến giữ NONE để kế toán tự khai báo, không đoán sai dữ liệu cũ.
UPDATE duty_attendance_codes
SET calculation_role = CASE upper(code)
  WHEN 'T' THEN 'DUTY'
  WHEN 'TC' THEN 'REINFORCEMENT'
  WHEN 'TC2' THEN 'REINFORCEMENT'
  WHEN 'N' THEN 'REST'
  WHEN 'N2' THEN 'REST'
  ELSE calculation_role
END,
rest_source = CASE WHEN upper(code) IN ('N', 'N2') THEN 'ANY_DUTY' ELSE rest_source END
WHERE calculation_role = 'NONE' OR upper(code) IN ('N', 'N2');
--> statement-breakpoint

-- Phép, công tác, học, ốm và các mã mẫu nghỉ bù/nghỉ không lương/thai sản
-- trừ đúng count_value khi rơi vào ngày làm việc; T/TC không trừ Ngày công.
UPDATE duty_attendance_codes
SET deducts_workday = true
WHERE upper(code) IN ('P', 'CT', 'H', 'H2', 'N', 'N2', 'O', 'NK', 'TS')
   OR upper("group") IN ('LEAVE', 'BUSINESS', 'STUDY', 'SICK');
--> statement-breakpoint

-- Các cột báo cáo mẫu lấy trực tiếp từ biến nghiệp vụ. Mỗi dòng chỉ được thêm khi
-- đơn vị chưa có cùng mã hoặc tên, nên các công thức cũ do người dùng tự khai báo không bị sửa.
-- Ngày công là Thứ Hai–Sáu trừ ngày lễ và các ký hiệu được đánh dấu trừ ngày công.
WITH default_columns(key, name, formula, sort_order) AS (
  VALUES
    ('NGAY_CONG', 'Ngày công', '[SYS_NGAY_CONG]', 10),
    ('TRUC_NGAY_LE', 'Trực ngày lễ', '[SYS_TRUC_NGAY_LE]', 20),
    ('NGHI_TRUC_NGAY_LE', 'Nghỉ trực ngày lễ', '[SYS_NGHI_TRUC_NGAY_LE]', 30),
    ('TANG_CUONG_NGAY_LE', 'Tăng cường ngày lễ', '[SYS_TANG_CUONG_NGAY_LE]', 40),
    ('NGHI_TANG_CUONG_NGAY_LE', 'Nghỉ tăng cường ngày lễ', '[SYS_NGHI_TANG_CUONG_NGAY_LE]', 50),
    ('TRUC_NGAY_NGHI', 'Trực ngày nghỉ', '[SYS_TRUC_NGAY_NGHI]', 60),
    ('NGHI_TRUC_NGAY_NGHI', 'Nghỉ trực ngày nghỉ', '[SYS_NGHI_TRUC_NGAY_NGHI]', 70),
    ('TANG_CUONG_NGAY_NGHI', 'Tăng cường ngày nghỉ', '[SYS_TANG_CUONG_NGAY_NGHI]', 80),
    ('NGHI_TANG_CUONG_NGAY_NGHI', 'Nghỉ tăng cường ngày nghỉ', '[SYS_NGHI_TANG_CUONG_NGAY_NGHI]', 90),
    ('TRUC_NGAY_THUONG', 'Trực ngày thường', '[SYS_TRUC_NGAY_THUONG]', 100),
    ('NGHI_TRUC_NGAY_THUONG', 'Nghỉ trực ngày thường', '[SYS_NGHI_TRUC_NGAY_THUONG]', 110),
    ('TANG_CUONG_NGAY_THUONG', 'Tăng cường ngày thường', '[SYS_TANG_CUONG_NGAY_THUONG]', 120),
    ('NGHI_TANG_CUONG_NGAY_THUONG', 'Nghỉ tăng cường ngày thường', '[SYS_NGHI_TANG_CUONG_NGAY_THUONG]', 130),
    ('NGHI_BU_CHUA_GAN', 'Nghỉ bù chưa ghép ca', '[SYS_NGHI_BU_CHUA_GAN]', 140)
)
INSERT INTO duty_attendance_columns (section_id, key, name, column_type, data_type, formula, placeholder, sort_order, active)
SELECT section.id, defaults.key, defaults.name, 'FORMULA', 'NUMBER', defaults.formula, '', defaults.sort_order, true
FROM duty_attendance_sections AS section
CROSS JOIN default_columns AS defaults
WHERE section.code = 'REPORT'
  AND NOT EXISTS (SELECT 1 FROM duty_attendance_columns WHERE key = defaults.key)
  AND NOT EXISTS (SELECT 1 FROM duty_attendance_columns WHERE lower(name) = lower(defaults.name));
