-- 0045 · Tổng hợp công việc hàng tuần (web + Telegram).
-- Mặc định bật cho mọi người dùng; người dùng tự tắt ở trang Cá nhân.
-- `task_digest_sent_at` là cờ chống gởi trùng trong cùng ngày (nhận một lần mỗi tuần).
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "task_digest_enabled" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "task_digest_sent_at" timestamp with time zone;
