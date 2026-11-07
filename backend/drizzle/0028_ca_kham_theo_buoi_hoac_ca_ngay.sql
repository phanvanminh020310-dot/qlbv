-- Một phòng/ngày/vai trò chỉ dùng một trong hai cách xếp: theo buổi hoặc ca Hành chính cả ngày.
-- Các dữ liệu cũ được giữ nguyên; ca Hành chính thông dụng được nhận diện một lần để không buộc nhập lại.
ALTER TABLE "duty_shift_types"
  ADD COLUMN IF NOT EXISTS "schedule_mode" text NOT NULL DEFAULT 'THEO_BUOI';

UPDATE "duty_shift_types"
SET "schedule_mode" = 'CA_NGAY'
WHERE lower("code") IN ('hc', 'hcc', 'cd', 'cngay', 'hanhchinh', 'hanh-chinh', 'hanh_chinh')
   OR lower("name") LIKE '%hành chính%'
   OR lower("name") LIKE '%hanh chinh%';

ALTER TABLE "duty_shift_types"
  DROP CONSTRAINT IF EXISTS "duty_shift_types_schedule_mode_chk";
ALTER TABLE "duty_shift_types"
  ADD CONSTRAINT "duty_shift_types_schedule_mode_chk"
  CHECK ("schedule_mode" IN ('THEO_BUOI', 'CA_NGAY', 'DOC_LAP'));
