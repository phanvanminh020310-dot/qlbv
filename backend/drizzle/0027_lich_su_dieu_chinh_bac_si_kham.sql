-- 0027 · Tăng tốc tra cứu/xuất báo cáo lịch sử điều chỉnh trực tiếp bác sĩ khám
-- duty_logs là nguồn nhật ký bất biến; chỉ thêm chỉ mục, không đổi hay sao chép dữ liệu lịch sử.
CREATE INDEX IF NOT EXISTS "duty_logs_action_created_idx"
  ON "duty_logs" ("action", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "duty_logs_action_period_created_idx"
  ON "duty_logs" ("action", "period_id", "created_at" DESC);
