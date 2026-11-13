-- 0037 · Danh mục chức vụ/kiêm nhiệm và quy tắc thứ tự bảng chấm công.
-- users.management_position được GIỮ LẠI làm bản hiển thị tương thích cho API/dữ liệu cũ;
-- quan hệ chuẩn là user_management_positions để một người có thể kiêm nhiều chức vụ.
-- Lệnh này lặp an toàn để hỗ trợ CSDL đã từng nâng cấp dở dang trước migration 0036.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "management_position" text DEFAULT '' NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "management_positions" (
  "id" serial PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "management_positions_code_uq" ON "management_positions" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "management_positions_name_uq" ON "management_positions" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "management_positions_sort_idx" ON "management_positions" USING btree ("sort_order", "name");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_management_positions" (
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "management_position_id" integer NOT NULL REFERENCES "management_positions"("id") ON DELETE restrict,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_management_positions_pk" PRIMARY KEY("user_id", "management_position_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_management_positions_position_idx" ON "user_management_positions" USING btree ("management_position_id");--> statement-breakpoint

-- Chuyển nguyên văn chức vụ đã nhập trước đó vào danh mục và liên kết; không sửa title chuyên môn.
INSERT INTO "management_positions" ("code", "name", "sort_order")
SELECT 'CV' || lpad((row_number() OVER (ORDER BY source.name))::text, 3, '0'), source.name, (row_number() OVER (ORDER BY source.name))::int
FROM (
  SELECT min(btrim("management_position")) AS name
  FROM "users"
  WHERE btrim("management_position") <> ''
  GROUP BY lower(btrim("management_position"))
) source
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "user_management_positions" ("user_id", "management_position_id")
SELECT u."id", mp."id"
FROM "users" u
JOIN "management_positions" mp ON lower(btrim(mp."name")) = lower(btrim(u."management_position"))
WHERE btrim(u."management_position") <> ''
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Mặc định giữ nguyên quy tắc cũ: chức danh chuyên môn (job_titles.sort_order) quyết định thứ tự.
-- Quản trị viên có thể chuyển sang MANAGEMENT_THEN_PROFESSIONAL trong Cấu hình hệ thống.
INSERT INTO "settings" ("key", "value", "group", "label", "description", "value_type", "is_public")
VALUES (
  'dutyAttendance.staffOrderMode',
  '"PROFESSIONAL"'::jsonb,
  'attendance',
  'Thứ tự nhân sự bảng chấm công',
  'Chọn ưu tiên chức danh chuyên môn hoặc chức vụ quản lý/kiêm nhiệm trước chức danh chuyên môn. Trong mỗi tiêu chí luôn dùng cột Thứ tự của danh mục; dữ liệu cũ chưa có danh mục xếp sau.',
  'attendance-staff-order',
  false
)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

-- Quyền quản lý danh mục chức vụ; các vai trò vốn quản lý danh mục chức danh nhận quyền tương ứng.
INSERT INTO "permissions" ("code", "name", "module", "action", "description", "is_system", "sort_order") VALUES
  ('management_position.view', 'Xem danh mục chức vụ', 'management_position', 'view', '', true, 1001),
  ('management_position.create', 'Thêm chức vụ', 'management_position', 'create', '', true, 1002),
  ('management_position.update', 'Sửa chức vụ', 'management_position', 'update', '', true, 1003),
  ('management_position.delete', 'Xoá chức vụ', 'management_position', 'delete', '', true, 1004)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT rp."role_id", management_permission."id"
FROM "role_permissions" rp
JOIN "permissions" title_permission ON title_permission."id" = rp."permission_id" AND title_permission."module" = 'job_title'
JOIN "permissions" management_permission ON management_permission."module" = 'management_position' AND management_permission."action" = title_permission."action"
ON CONFLICT DO NOTHING;
