-- Nghỉ bù chuyển sang quy tắc số lượng tích lũy theo người (tổng nghỉ bù ≤ tổng Trực),
-- không còn ghép với ca Trực gần nhất trong N ngày. Bỏ cấu hình khoảng dò đã hết tác dụng.
DELETE FROM "settings" WHERE "key" = 'dutyAttendance.restPairLookbackDays';
