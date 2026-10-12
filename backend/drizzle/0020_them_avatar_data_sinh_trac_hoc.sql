-- 0020 · Bổ sung trường avatar_data lưu ảnh chân dung sinh trắc học Base64 vào CSDL để tự động sao lưu và phục hồi
ALTER TABLE "user_biometrics" ADD COLUMN IF NOT EXISTS "avatar_data" text;
