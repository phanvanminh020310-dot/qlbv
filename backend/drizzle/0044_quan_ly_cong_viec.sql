-- 0044 · PHÂN HỆ QUẢN LÝ CÔNG VIỆC (giao việc – thực hiện – duyệt) + nguồn dữ liệu SQL cho bản in.
-- Chỉ THÊM MỚI bảng/chỉ mục/view/quyền/vai trò. Không sửa, không xóa dữ liệu cũ.

CREATE TABLE IF NOT EXISTS "task_projects" (
  "id" serial PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "department_id" integer REFERENCES "departments"("id") ON DELETE SET NULL,
  "owner_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "priority" text DEFAULT 'NORMAL' NOT NULL,
  "start_date" date,
  "due_date" date,
  "color" text DEFAULT '#0f766e' NOT NULL,
  "archived" boolean DEFAULT false NOT NULL,
  "completed_at" timestamp with time zone,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_projects_code_uq" ON "task_projects" ("code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_projects_dept_idx" ON "task_projects" ("department_id", "status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "task_project_members" (
  "project_id" integer NOT NULL REFERENCES "task_projects"("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" text DEFAULT 'MEMBER' NOT NULL,
  "added_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("project_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_project_members_user_idx" ON "task_project_members" ("user_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "task_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "title" text DEFAULT '' NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "priority" text DEFAULT 'NORMAL' NOT NULL,
  "estimate_hours" numeric(8, 2),
  "due_days" integer,
  "checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "labels" text[] DEFAULT '{}'::text[] NOT NULL,
  "department_id" integer REFERENCES "departments"("id") ON DELETE SET NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tasks" (
  "id" serial PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "title" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "project_id" integer REFERENCES "task_projects"("id") ON DELETE SET NULL,
  "parent_id" integer REFERENCES "tasks"("id") ON DELETE SET NULL,
  "department_id" integer REFERENCES "departments"("id") ON DELETE SET NULL,
  "assigner_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "assignee_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewer_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "status" text DEFAULT 'ASSIGNED' NOT NULL,
  "priority" text DEFAULT 'NORMAL' NOT NULL,
  "start_date" date,
  "due_at" timestamp with time zone,
  "estimate_hours" numeric(8, 2),
  "progress" integer DEFAULT 0 NOT NULL,
  "labels" text[] DEFAULT '{}'::text[] NOT NULL,
  "result_content" text DEFAULT '' NOT NULL,
  "submission_count" integer DEFAULT 0 NOT NULL,
  "return_count" integer DEFAULT 0 NOT NULL,
  "status_reason" text DEFAULT '' NOT NULL,
  "assigned_at" timestamp with time zone,
  "accepted_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "submitted_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "approved_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "recurrence" jsonb,
  "recurrence_source_id" integer,
  "template_id" integer REFERENCES "task_templates"("id") ON DELETE SET NULL,
  "due_reminded_at" timestamp with time zone,
  "overdue_notified_at" timestamp with time zone,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "tasks_progress_range" CHECK ("progress" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_code_uq" ON "tasks" ("code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_assignee_idx" ON "tasks" ("assignee_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_assigner_idx" ON "tasks" ("assigner_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_reviewer_idx" ON "tasks" ("reviewer_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_dept_idx" ON "tasks" ("department_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_project_idx" ON "tasks" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_parent_idx" ON "tasks" ("parent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_due_idx" ON "tasks" ("due_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_created_idx" ON "tasks" ("created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "task_watchers" (
  "task_id" integer NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("task_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_watchers_user_idx" ON "task_watchers" ("user_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "task_dependencies" (
  "task_id" integer NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "depends_on_id" integer NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("task_id", "depends_on_id"),
  CONSTRAINT "task_dependencies_not_self" CHECK ("task_id" <> "depends_on_id")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "task_checklist_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "task_id" integer NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "content" text NOT NULL,
  "done" boolean DEFAULT false NOT NULL,
  "done_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "done_at" timestamp with time zone,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_checklist_task_idx" ON "task_checklist_items" ("task_id", "sort_order");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "task_comments" (
  "id" serial PRIMARY KEY NOT NULL,
  "task_id" integer NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "full_name" text DEFAULT '' NOT NULL,
  "content" text NOT NULL,
  "mentions" integer[] DEFAULT '{}'::integer[] NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comments_task_idx" ON "task_comments" ("task_id", "created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "task_attachments" (
  "id" serial PRIMARY KEY NOT NULL,
  "task_id" integer NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "comment_id" integer REFERENCES "task_comments"("id") ON DELETE SET NULL,
  "kind" text DEFAULT 'REFERENCE' NOT NULL,
  "submission_no" integer DEFAULT 0 NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" integer DEFAULT 0 NOT NULL,
  "storage_path" text NOT NULL,
  "uploaded_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "full_name" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_attachments_task_idx" ON "task_attachments" ("task_id", "kind");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "task_worklogs" (
  "id" serial PRIMARY KEY NOT NULL,
  "task_id" integer NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "full_name" text DEFAULT '' NOT NULL,
  "work_date" date NOT NULL,
  "hours" numeric(6, 2) DEFAULT 0 NOT NULL,
  "content" text DEFAULT '' NOT NULL,
  "progress" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_worklogs_task_idx" ON "task_worklogs" ("task_id", "work_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_worklogs_user_idx" ON "task_worklogs" ("user_id", "work_date");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "task_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "task_id" integer NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "username" text DEFAULT '' NOT NULL,
  "full_name" text DEFAULT '' NOT NULL,
  "action" text NOT NULL,
  "from_status" text DEFAULT '' NOT NULL,
  "to_status" text DEFAULT '' NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "changes" jsonb,
  "ip" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_logs_task_idx" ON "task_logs" ("task_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_logs_created_idx" ON "task_logs" ("created_at");
--> statement-breakpoint

-- ===================================================================== VIEW báo cáo / bản in
-- Tên cột tiếng Việt không dấu để người thiết kế bản in dễ chọn trường.

CREATE OR REPLACE VIEW "v_nguoi_dung" AS
SELECT u."id", u."manv" AS "ma_nv", u."username" AS "ten_dang_nhap", u."full_name" AS "ho_ten",
       u."title" AS "chuc_danh", u."department_id" AS "khoa_id", d."name" AS "ten_khoa",
       u."phone" AS "dien_thoai", u."email", u."active" AS "dang_hoat_dong"
FROM "users" u
LEFT JOIN "departments" d ON d."id" = u."department_id"
WHERE u."deleted_at" IS NULL;
--> statement-breakpoint

CREATE OR REPLACE VIEW "v_cv_cong_viec" AS
SELECT
  t."id", t."code" AS "ma", t."title" AS "tieu_de", t."description" AS "mo_ta",
  t."status" AS "trang_thai",
  CASE t."status"
    WHEN 'DRAFT' THEN 'Nháp' WHEN 'ASSIGNED' THEN 'Chờ nhận' WHEN 'ACCEPTED' THEN 'Đã nhận'
    WHEN 'IN_PROGRESS' THEN 'Đang làm' WHEN 'ON_HOLD' THEN 'Tạm hoãn' WHEN 'SUBMITTED' THEN 'Chờ duyệt'
    WHEN 'RETURNED' THEN 'Trả lại' WHEN 'DONE' THEN 'Hoàn thành' WHEN 'CANCELLED' THEN 'Đã hủy'
    WHEN 'DECLINED' THEN 'Từ chối' ELSE t."status" END AS "trang_thai_ten",
  t."priority" AS "uu_tien",
  CASE t."priority" WHEN 'LOW' THEN 'Thấp' WHEN 'NORMAL' THEN 'Bình thường' WHEN 'HIGH' THEN 'Cao'
    WHEN 'URGENT' THEN 'Khẩn' ELSE t."priority" END AS "uu_tien_ten",
  t."department_id" AS "khoa_id", d."name" AS "ten_khoa",
  t."project_id" AS "du_an_id", p."code" AS "ma_du_an", p."name" AS "ten_du_an",
  t."parent_id" AS "viec_cha_id",
  t."assigner_id" AS "nguoi_giao_id", ug."full_name" AS "nguoi_giao",
  t."assignee_id" AS "nguoi_thuc_hien_id", ua."full_name" AS "nguoi_thuc_hien", ua."manv" AS "ma_nv_thuc_hien",
  ua."title" AS "chuc_danh_thuc_hien",
  t."reviewer_id" AS "nguoi_duyet_id", ur."full_name" AS "nguoi_duyet",
  t."start_date" AS "ngay_bat_dau", t."due_at" AS "han_chot",
  COALESCE(t."assigned_at", t."created_at") AS "ngay_giao",
  t."accepted_at" AS "ngay_nhan", t."started_at" AS "ngay_bat_dau_lam", t."submitted_at" AS "ngay_gui_duyet",
  t."completed_at" AS "ngay_hoan_thanh", t."cancelled_at" AS "ngay_huy",
  t."progress" AS "tien_do", t."estimate_hours" AS "gio_uoc_luong",
  COALESCE((SELECT sum(w."hours") FROM "task_worklogs" w WHERE w."task_id" = t."id" AND w."deleted_at" IS NULL), 0) AS "gio_cong",
  t."return_count" AS "so_lan_tra_lai", t."submission_count" AS "so_lan_gui_duyet",
  array_to_string(t."labels", ', ') AS "nhan", t."result_content" AS "ket_qua", t."status_reason" AS "ly_do",
  (t."status" NOT IN ('DONE', 'CANCELLED', 'DRAFT') AND t."due_at" IS NOT NULL AND t."due_at" < now()) AS "qua_han",
  (t."status" = 'DONE' AND t."due_at" IS NOT NULL AND t."completed_at" <= t."due_at") AS "dung_han",
  (t."status" = 'DONE' AND t."due_at" IS NOT NULL AND t."completed_at" > t."due_at") AS "tre_han",
  CASE WHEN t."due_at" IS NULL THEN NULL
       WHEN t."status" = 'DONE' THEN round((EXTRACT(EPOCH FROM (t."completed_at" - t."due_at")) / 86400)::numeric, 1)
       WHEN t."status" NOT IN ('CANCELLED', 'DRAFT') THEN round((EXTRACT(EPOCH FROM (now() - t."due_at")) / 86400)::numeric, 1)
       ELSE NULL END AS "so_ngay_so_voi_han",
  CASE WHEN t."completed_at" IS NOT NULL
       THEN round((EXTRACT(EPOCH FROM (t."completed_at" - COALESCE(t."assigned_at", t."created_at"))) / 3600)::numeric, 1)
       ELSE NULL END AS "gio_hoan_thanh",
  t."created_at" AS "ngay_tao"
FROM "tasks" t
LEFT JOIN "departments" d ON d."id" = t."department_id"
LEFT JOIN "task_projects" p ON p."id" = t."project_id"
LEFT JOIN "users" ug ON ug."id" = t."assigner_id"
LEFT JOIN "users" ua ON ua."id" = t."assignee_id"
LEFT JOIN "users" ur ON ur."id" = t."reviewer_id"
WHERE t."deleted_at" IS NULL;
--> statement-breakpoint

CREATE OR REPLACE VIEW "v_cv_du_an" AS
SELECT p."id", p."code" AS "ma", p."name" AS "ten", p."description" AS "mo_ta", p."status" AS "trang_thai",
  p."department_id" AS "khoa_id", d."name" AS "ten_khoa", p."owner_id" AS "quan_ly_id", uo."full_name" AS "quan_ly",
  p."start_date" AS "ngay_bat_dau", p."due_date" AS "ngay_ket_thuc",
  (SELECT count(*) FROM "task_project_members" m WHERE m."project_id" = p."id") AS "so_thanh_vien",
  (SELECT count(*) FROM "tasks" t WHERE t."project_id" = p."id" AND t."deleted_at" IS NULL AND t."status" <> 'CANCELLED') AS "tong_viec",
  (SELECT count(*) FROM "tasks" t WHERE t."project_id" = p."id" AND t."deleted_at" IS NULL AND t."status" = 'DONE') AS "hoan_thanh",
  (SELECT count(*) FROM "tasks" t WHERE t."project_id" = p."id" AND t."deleted_at" IS NULL
     AND t."status" NOT IN ('DONE', 'CANCELLED', 'DRAFT') AND t."due_at" < now()) AS "qua_han",
  COALESCE((SELECT round(100.0 * count(*) FILTER (WHERE t."status" = 'DONE') / NULLIF(count(*), 0), 1)
     FROM "tasks" t WHERE t."project_id" = p."id" AND t."deleted_at" IS NULL AND t."status" <> 'CANCELLED'), 0) AS "tien_do",
  p."created_at" AS "ngay_tao"
FROM "task_projects" p
LEFT JOIN "departments" d ON d."id" = p."department_id"
LEFT JOIN "users" uo ON uo."id" = p."owner_id"
WHERE p."deleted_at" IS NULL;
--> statement-breakpoint

CREATE OR REPLACE VIEW "v_cv_nhat_ky" AS
SELECT l."id", l."task_id" AS "cong_viec_id", t."code" AS "ma_cong_viec", t."title" AS "tieu_de",
  t."department_id" AS "khoa_id", l."action" AS "thao_tac", l."from_status" AS "tu_trang_thai",
  l."to_status" AS "sang_trang_thai", l."note" AS "ghi_chu", l."full_name" AS "nguoi_thuc_hien_thao_tac",
  l."created_at" AS "thoi_gian"
FROM "task_logs" l JOIN "tasks" t ON t."id" = l."task_id"
WHERE t."deleted_at" IS NULL;
--> statement-breakpoint

CREATE OR REPLACE VIEW "v_cv_trao_doi" AS
SELECT c."id", c."task_id" AS "cong_viec_id", t."code" AS "ma_cong_viec", t."department_id" AS "khoa_id",
  c."full_name" AS "nguoi_viet", c."content" AS "noi_dung", c."created_at" AS "thoi_gian"
FROM "task_comments" c JOIN "tasks" t ON t."id" = c."task_id"
WHERE c."deleted_at" IS NULL AND t."deleted_at" IS NULL;
--> statement-breakpoint

CREATE OR REPLACE VIEW "v_cv_nhat_ky_cong_viec" AS
SELECT w."id", w."task_id" AS "cong_viec_id", t."code" AS "ma_cong_viec", t."title" AS "tieu_de",
  t."department_id" AS "khoa_id", w."user_id" AS "nguoi_dung_id", w."full_name" AS "ho_ten",
  w."work_date" AS "ngay", w."hours" AS "so_gio", w."content" AS "noi_dung", w."progress" AS "tien_do"
FROM "task_worklogs" w JOIN "tasks" t ON t."id" = w."task_id"
WHERE w."deleted_at" IS NULL AND t."deleted_at" IS NULL;
--> statement-breakpoint

-- ===================================================================== Quyền & vai trò

INSERT INTO "permissions" ("code", "name", "module", "action", "description", "is_system") VALUES
  ('task.assign', 'Giao việc / tạo dự án', 'task', 'assign', 'Giao việc, tạo dự án và mẫu công việc cho nhân viên trong phạm vi khoa/phòng', true),
  ('task.manage', 'Quản lý công việc của khoa/phòng', 'task', 'manage', 'Xem, duyệt, trả lại, hủy, sửa mọi công việc thuộc phạm vi khoa/phòng', true),
  ('task.report', 'Xem báo cáo công việc', 'task', 'report', 'Xem tổng quan, thống kê, hiệu suất công việc theo phạm vi', true),
  ('task.export', 'Xuất báo cáo công việc', 'task', 'export', 'Xuất Excel/CSV/Word/PDF báo cáo công việc', true),
  ('print.datasource.sql', 'Soạn nguồn dữ liệu SQL cho bản in', 'print.datasource', 'sql', 'Soạn và chạy truy vấn SQL chỉ đọc làm nguồn dữ liệu bản in', true)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "module" = EXCLUDED."module",
  "action" = EXCLUDED."action",
  "description" = EXCLUDED."description",
  "is_system" = true;
--> statement-breakpoint

INSERT INTO "roles" ("code", "name", "description", "data_scope", "is_system", "priority", "color", "sort_order", "active") VALUES
  (
    'QUAN_LY_CONG_VIEC',
    'Quản lý giao việc khoa/phòng',
    'Giao việc, tạo dự án, duyệt/trả lại/hủy công việc và xem báo cáo hiệu suất của nhân viên trong đúng các khoa/phòng được gán.',
    'DEPT', true, 32, '#2563eb', 0, true
  )
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('task.assign', 'task.manage', 'task.report', 'task.export', 'print.render.view', 'print.render.export')
WHERE r."code" IN ('QUAN_LY_CONG_VIEC', 'TRUONG_KHOA', 'LANH_DAO')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" = 'print.datasource.sql'
WHERE r."code" = 'ADMIN'
ON CONFLICT DO NOTHING;

--> statement-breakpoint

-- ------------------------------------------------------------------ Mẫu in mặc định (nguồn dữ liệu SQL)
INSERT INTO "print_templates" ("code", "name", "description", "module", "doc_type", "paper_size", "orientation", "document", "is_default", "active")
VALUES ('CV_BAO_CAO_TINH_HINH', 'Báo cáo tình hình thực hiện công việc', 'Tổng hợp & danh sách công việc theo kỳ, khoa/phòng — dữ liệu lấy trực tiếp bằng SQL (sửa được trong trình thiết kế).', 'TASK', 'CV_BAO_CAO_TINH_HINH', 'A4', 'landscape', '{"paperSize": "A4", "orientation": "landscape", "margins": {"top": 10, "right": 10, "bottom": 12, "left": 10}, "defaultStyle": {"fontSize": 11}, "pageNumbering": {"show": true, "position": "bottom-right", "label": "Trang {page}/{pages}"}, "pages": [{"id": "p1", "elements": [{"id": "el1", "type": "text", "x": 0, "y": 0, "w": 90, "h": 6, "text": "BỆNH VIỆN", "style": {"fontSize": 11, "bold": true, "align": "center", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el2", "type": "text", "x": 0, "y": 6, "w": 90, "h": 6, "text": "{one.ky.khoa_nguoi_in}", "style": {"fontSize": 10, "bold": false, "align": "center", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el3", "type": "text", "x": 177, "y": 0, "w": 100, "h": 6, "text": "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", "style": {"fontSize": 11, "bold": true, "align": "center", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el4", "type": "text", "x": 177, "y": 6, "w": 100, "h": 6, "text": "Độc lập - Tự do - Hạnh phúc", "style": {"fontSize": 11, "bold": true, "align": "center", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el5", "type": "text", "x": 0, "y": 18, "w": 277, "h": 9, "text": "BÁO CÁO TÌNH HÌNH THỰC HIỆN CÔNG VIỆC", "style": {"fontSize": 15, "bold": true, "align": "center", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el6", "type": "text", "x": 0, "y": 27, "w": 277, "h": 6, "text": "Từ ngày {one.ky.tu_ngay} đến ngày {one.ky.den_ngay} — {one.ky.khoa_bao_cao}", "style": {"fontSize": 10.5, "bold": false, "align": "center", "italic": true, "wrap": true, "verticalAlign": "middle"}}, {"id": "el7", "type": "text", "x": 0, "y": 36, "w": 277, "h": 6, "text": "1. Chỉ tiêu tổng hợp", "style": {"fontSize": 11, "bold": true, "align": "left", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el8", "type": "text", "x": 0, "y": 43, "w": 277, "h": 6, "text": "Được giao: {one.tong_hop.giao}   •   Hoàn thành: {one.tong_hop.hoan_thanh} ({one.tong_hop.ty_le_hoan_thanh}%)   •   Đúng hạn: {one.tong_hop.dung_han} ({one.tong_hop.ty_le_dung_han}%)   •   Trễ hạn: {one.tong_hop.tre_han}", "style": {"fontSize": 10.5, "bold": false, "align": "left", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el9", "type": "text", "x": 0, "y": 49, "w": 277, "h": 6, "text": "Đang mở: {one.tong_hop.dang_mo}   •   Quá hạn: {one.tong_hop.qua_han}   •   Chờ duyệt: {one.tong_hop.cho_duyet}   •   Đã hủy: {one.tong_hop.da_huy}", "style": {"fontSize": 10.5, "bold": false, "align": "left", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el10", "type": "text", "x": 0, "y": 57, "w": 277, "h": 6, "text": "2. Danh sách công việc", "style": {"fontSize": 11, "bold": true, "align": "left", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "tb21", "type": "table", "x": 0, "y": 64, "w": 277, "h": 20, "style": {"fontSize": 9}, "table": {"dataSource": "ds.chi_tiet", "columns": [{"id": "c11", "title": "Mã", "width": 25, "align": "left", "binding": {"source": "row", "path": "ma"}}, {"id": "c12", "title": "Nội dung công việc", "width": 60, "align": "left", "binding": {"source": "row", "path": "tieu_de"}}, {"id": "c13", "title": "Khoa/phòng", "width": 28, "align": "left", "binding": {"source": "row", "path": "ten_khoa"}}, {"id": "c14", "title": "Người thực hiện", "width": 30, "align": "left", "binding": {"source": "row", "path": "nguoi_thuc_hien"}}, {"id": "c15", "title": "Người giao", "width": 27, "align": "left", "binding": {"source": "row", "path": "nguoi_giao"}}, {"id": "c16", "title": "Ưu tiên", "width": 20, "align": "center", "binding": {"source": "row", "path": "uu_tien_ten"}}, {"id": "c17", "title": "Trạng thái", "width": 24, "align": "center", "binding": {"source": "row", "path": "trang_thai_ten"}}, {"id": "c18", "title": "Hạn chót", "width": 24, "align": "center", "binding": {"source": "row", "path": "han_chot", "format": {"type": "datetime", "pattern": "dd/MM/yyyy HH:mm"}}}, {"id": "c19", "title": "Hoàn thành", "width": 24, "align": "center", "binding": {"source": "row", "path": "ngay_hoan_thanh", "format": {"type": "datetime", "pattern": "dd/MM/yyyy HH:mm"}}}, {"id": "c20", "title": "Đánh giá", "width": 18, "align": "center", "binding": {"source": "row", "path": "danh_gia"}}], "repeatHeader": true, "showIndex": true, "zebra": true, "totalRow": false, "minRowHeight": 6, "pushDown": true, "headerStyle": {"bold": true, "align": "center", "backgroundColor": "#e2e8f0", "fontSize": 9}, "bodyStyle": {"fontSize": 9}}}, {"id": "el22", "type": "text", "x": 177, "y": 90, "w": 100, "h": 6, "text": "Ngày {system.day} tháng {system.month} năm {system.year}", "style": {"fontSize": 10.5, "bold": false, "align": "center", "italic": true, "wrap": true, "verticalAlign": "middle"}}, {"id": "el23", "type": "text", "x": 177, "y": 96, "w": 100, "h": 6, "text": "NGƯỜI LẬP BÁO CÁO", "style": {"fontSize": 11, "bold": true, "align": "center", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el24", "type": "text", "x": 177, "y": 120, "w": 100, "h": 6, "text": "{one.ky.nguoi_in}", "style": {"fontSize": 11, "bold": true, "align": "center", "italic": false, "wrap": true, "verticalAlign": "middle"}}]}], "sqlSource": {"queries": [{"key": "chi_tiet", "label": "Danh sách công việc", "sql": "SELECT v.ma, v.tieu_de, v.ten_khoa, v.nguoi_thuc_hien, v.nguoi_giao, v.uu_tien_ten, v.trang_thai_ten, v.ngay_giao, v.han_chot, v.ngay_hoan_thanh, v.tien_do, CASE WHEN v.qua_han THEN ''Quá hạn'' WHEN v.dung_han THEN ''Đúng hạn'' WHEN v.tre_han THEN ''Trễ hạn'' ELSE '''' END AS danh_gia FROM v_cv_cong_viec v WHERE v.trang_thai <> ''DRAFT'' AND (v.ngay_giao AT TIME ZONE ''Asia/Ho_Chi_Minh'')::date BETWEEN COALESCE(:tu_ngay, date_trunc(''month'', now() AT TIME ZONE ''Asia/Ho_Chi_Minh'')::date) AND COALESCE(:den_ngay, (now() AT TIME ZONE ''Asia/Ho_Chi_Minh'')::date) AND (:khoa IS NULL OR v.khoa_id = :khoa) AND (:pham_vi_khoa IS NULL OR v.khoa_id = ANY(:pham_vi_khoa) OR :nguoi_dung_id IN (v.nguoi_giao_id, v.nguoi_thuc_hien_id, v.nguoi_duyet_id)) ORDER BY v.ten_khoa NULLS LAST, v.ngay_giao"}, {"key": "ky", "label": "Kỳ báo cáo & người in", "sql": "SELECT to_char(COALESCE(:tu_ngay, date_trunc(''month'', now() AT TIME ZONE ''Asia/Ho_Chi_Minh'')::date), ''DD/MM/YYYY'') AS tu_ngay, to_char(COALESCE(:den_ngay, (now() AT TIME ZONE ''Asia/Ho_Chi_Minh'')::date), ''DD/MM/YYYY'') AS den_ngay, u.ho_ten AS nguoi_in, u.chuc_danh, COALESCE(u.ten_khoa, '''') AS khoa_nguoi_in, COALESCE((SELECT d.name FROM departments d WHERE d.id = :khoa), ''Tất cả khoa/phòng trong phạm vi'') AS khoa_bao_cao FROM v_nguoi_dung u WHERE u.id = :nguoi_dung_id"}, {"key": "tong_hop", "label": "Chỉ tiêu tổng hợp", "sql": "SELECT count(*) AS giao, count(*) FILTER (WHERE v.trang_thai = ''DONE'') AS hoan_thanh, count(*) FILTER (WHERE v.dung_han) AS dung_han, count(*) FILTER (WHERE v.tre_han) AS tre_han, count(*) FILTER (WHERE v.trang_thai NOT IN (''DONE'',''CANCELLED'')) AS dang_mo, count(*) FILTER (WHERE v.qua_han) AS qua_han, count(*) FILTER (WHERE v.trang_thai = ''SUBMITTED'') AS cho_duyet, count(*) FILTER (WHERE v.trang_thai = ''CANCELLED'') AS da_huy, round(100.0 * count(*) FILTER (WHERE v.trang_thai = ''DONE'') / NULLIF(count(*) FILTER (WHERE v.trang_thai <> ''CANCELLED''), 0), 1) AS ty_le_hoan_thanh, round(100.0 * count(*) FILTER (WHERE v.dung_han) / NULLIF(count(*) FILTER (WHERE v.dung_han OR v.tre_han), 0), 1) AS ty_le_dung_han FROM v_cv_cong_viec v WHERE v.trang_thai <> ''DRAFT'' AND (v.ngay_giao AT TIME ZONE ''Asia/Ho_Chi_Minh'')::date BETWEEN COALESCE(:tu_ngay, date_trunc(''month'', now() AT TIME ZONE ''Asia/Ho_Chi_Minh'')::date) AND COALESCE(:den_ngay, (now() AT TIME ZONE ''Asia/Ho_Chi_Minh'')::date) AND (:khoa IS NULL OR v.khoa_id = :khoa) AND (:pham_vi_khoa IS NULL OR v.khoa_id = ANY(:pham_vi_khoa) OR :nguoi_dung_id IN (v.nguoi_giao_id, v.nguoi_thuc_hien_id, v.nguoi_duyet_id))"}], "params": [{"name": "tu_ngay", "label": "Từ ngày (trống = đầu tháng)", "type": "date", "required": false, "default": ""}, {"name": "den_ngay", "label": "Đến ngày (trống = hôm nay)", "type": "date", "required": false, "default": ""}, {"name": "khoa", "label": "ID khoa/phòng (trống = tất cả trong phạm vi)", "type": "number", "required": false, "default": ""}]}}'::jsonb, true, true)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "print_template_versions" ("template_id", "version", "document", "note")
SELECT t."id", 1, t."document", 'Mẫu mặc định phân hệ Quản lý công việc' FROM "print_templates" t
WHERE t."code" = 'CV_BAO_CAO_TINH_HINH' AND NOT EXISTS (SELECT 1 FROM "print_template_versions" v WHERE v."template_id" = t."id");
--> statement-breakpoint
INSERT INTO "print_templates" ("code", "name", "description", "module", "doc_type", "paper_size", "orientation", "document", "is_default", "active")
VALUES ('CV_HIEU_SUAT_NHAN_VIEN', 'Báo cáo hiệu suất nhân viên', 'Xếp hạng hiệu suất theo nhân viên trong kỳ: giao, hoàn thành, đúng/trễ hạn, bị trả lại, giờ công, điểm hiệu suất.', 'TASK', 'CV_HIEU_SUAT_NHAN_VIEN', 'A4', 'landscape', '{"paperSize": "A4", "orientation": "landscape", "margins": {"top": 10, "right": 10, "bottom": 12, "left": 10}, "defaultStyle": {"fontSize": 11}, "pageNumbering": {"show": true, "position": "bottom-right", "label": "Trang {page}/{pages}"}, "pages": [{"id": "p1", "elements": [{"id": "el1", "type": "text", "x": 0, "y": 0, "w": 90, "h": 6, "text": "BỆNH VIỆN", "style": {"fontSize": 11, "bold": true, "align": "center", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el2", "type": "text", "x": 0, "y": 6, "w": 90, "h": 6, "text": "{one.ky.khoa_nguoi_in}", "style": {"fontSize": 10, "bold": false, "align": "center", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el3", "type": "text", "x": 177, "y": 0, "w": 100, "h": 6, "text": "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", "style": {"fontSize": 11, "bold": true, "align": "center", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el4", "type": "text", "x": 177, "y": 6, "w": 100, "h": 6, "text": "Độc lập - Tự do - Hạnh phúc", "style": {"fontSize": 11, "bold": true, "align": "center", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el5", "type": "text", "x": 0, "y": 18, "w": 277, "h": 9, "text": "BÁO CÁO HIỆU SUẤT THỰC HIỆN CÔNG VIỆC CỦA NHÂN VIÊN", "style": {"fontSize": 15, "bold": true, "align": "center", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el6", "type": "text", "x": 0, "y": 27, "w": 277, "h": 6, "text": "Từ ngày {one.ky.tu_ngay} đến ngày {one.ky.den_ngay} — {one.ky.khoa_bao_cao}", "style": {"fontSize": 10.5, "bold": false, "align": "center", "italic": true, "wrap": true, "verticalAlign": "middle"}}, {"id": "tb22", "type": "table", "x": 0, "y": 36, "w": 277, "h": 20, "style": {"fontSize": 8.5}, "table": {"dataSource": "ds.hieu_suat", "columns": [{"id": "c7", "title": "Mã NV", "width": 16, "align": "center", "binding": {"source": "row", "path": "ma_nv"}}, {"id": "c8", "title": "Họ và tên", "width": 40, "align": "left", "binding": {"source": "row", "path": "ho_ten"}}, {"id": "c9", "title": "Chức danh", "width": 26, "align": "left", "binding": {"source": "row", "path": "chuc_danh"}}, {"id": "c10", "title": "Khoa/phòng", "width": 32, "align": "left", "binding": {"source": "row", "path": "ten_khoa"}}, {"id": "c11", "title": "Giao", "width": 12, "align": "center", "binding": {"source": "row", "path": "giao"}}, {"id": "c12", "title": "Xong", "width": 12, "align": "center", "binding": {"source": "row", "path": "hoan_thanh"}}, {"id": "c13", "title": "Đúng hạn", "width": 14, "align": "center", "binding": {"source": "row", "path": "dung_han"}}, {"id": "c14", "title": "Trễ", "width": 11, "align": "center", "binding": {"source": "row", "path": "tre_han"}}, {"id": "c15", "title": "Đang mở", "width": 13, "align": "center", "binding": {"source": "row", "path": "dang_mo"}}, {"id": "c16", "title": "Quá hạn", "width": 13, "align": "center", "binding": {"source": "row", "path": "qua_han"}}, {"id": "c17", "title": "Trả lại", "width": 12, "align": "center", "binding": {"source": "row", "path": "bi_tra_lai"}}, {"id": "c18", "title": "Giờ công", "width": 14, "align": "center", "binding": {"source": "row", "path": "gio_cong"}}, {"id": "c19", "title": "% hoàn thành", "width": 17, "align": "center", "binding": {"source": "row", "path": "ty_le_hoan_thanh", "format": {"type": "number", "decimals": 1, "suffix": "%"}}}, {"id": "c20", "title": "% đúng hạn", "width": 16, "align": "center", "binding": {"source": "row", "path": "ty_le_dung_han", "format": {"type": "number", "decimals": 1, "suffix": "%"}}}, {"id": "c21", "title": "Điểm", "width": 13, "align": "center", "binding": {"source": "row", "path": "diem"}}], "repeatHeader": true, "showIndex": true, "zebra": true, "totalRow": false, "minRowHeight": 6, "pushDown": true, "headerStyle": {"bold": true, "align": "center", "backgroundColor": "#e2e8f0", "fontSize": 8.5}, "bodyStyle": {"fontSize": 8.5}}}, {"id": "el23", "type": "text", "x": 0, "y": 62, "w": 277, "h": 6, "text": "Điểm hiệu suất = 50% × tỷ lệ đúng hạn + 30% × tỷ lệ hoàn thành + 20% × (100% − tỷ lệ bị trả lại).", "style": {"fontSize": 9, "bold": false, "align": "left", "italic": true, "wrap": true, "verticalAlign": "middle", "color": "#475569"}}, {"id": "el24", "type": "text", "x": 177, "y": 72, "w": 100, "h": 6, "text": "Ngày {system.day} tháng {system.month} năm {system.year}", "style": {"fontSize": 10.5, "bold": false, "align": "center", "italic": true, "wrap": true, "verticalAlign": "middle"}}, {"id": "el25", "type": "text", "x": 177, "y": 78, "w": 100, "h": 6, "text": "NGƯỜI LẬP BÁO CÁO", "style": {"fontSize": 11, "bold": true, "align": "center", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el26", "type": "text", "x": 177, "y": 102, "w": 100, "h": 6, "text": "{one.ky.nguoi_in}", "style": {"fontSize": 11, "bold": true, "align": "center", "italic": false, "wrap": true, "verticalAlign": "middle"}}]}], "sqlSource": {"queries": [{"key": "hieu_suat", "label": "Hiệu suất theo nhân viên", "sql": "WITH s AS (SELECT v.nguoi_thuc_hien_id, max(v.nguoi_thuc_hien) AS ho_ten, max(v.ma_nv_thuc_hien) AS ma_nv, max(v.chuc_danh_thuc_hien) AS chuc_danh, max(v.ten_khoa) AS ten_khoa, count(*) AS giao, count(*) FILTER (WHERE v.trang_thai = ''CANCELLED'') AS huy, count(*) FILTER (WHERE v.trang_thai = ''DONE'') AS hoan_thanh, count(*) FILTER (WHERE v.dung_han) AS dung_han, count(*) FILTER (WHERE v.tre_han) AS tre_han, count(*) FILTER (WHERE v.qua_han) AS qua_han, count(*) FILTER (WHERE v.trang_thai NOT IN (''DONE'',''CANCELLED'')) AS dang_mo, count(*) FILTER (WHERE v.so_lan_gui_duyet > 0) AS da_gui, count(*) FILTER (WHERE v.so_lan_tra_lai > 0) AS bi_tra_lai, round(sum(v.gio_cong)::numeric, 1) AS gio_cong FROM v_cv_cong_viec v WHERE v.nguoi_thuc_hien_id IS NOT NULL AND v.trang_thai <> ''DRAFT'' AND (v.ngay_giao AT TIME ZONE ''Asia/Ho_Chi_Minh'')::date BETWEEN COALESCE(:tu_ngay, date_trunc(''month'', now() AT TIME ZONE ''Asia/Ho_Chi_Minh'')::date) AND COALESCE(:den_ngay, (now() AT TIME ZONE ''Asia/Ho_Chi_Minh'')::date) AND (:khoa IS NULL OR v.khoa_id = :khoa) AND (:pham_vi_khoa IS NULL OR v.khoa_id = ANY(:pham_vi_khoa) OR :nguoi_dung_id IN (v.nguoi_giao_id, v.nguoi_thuc_hien_id, v.nguoi_duyet_id)) GROUP BY v.nguoi_thuc_hien_id), r AS (SELECT s.*, 100.0 * hoan_thanh / NULLIF(giao - huy, 0) AS tl_ht, 100.0 * dung_han / NULLIF(dung_han + tre_han, 0) AS tl_dh, 100.0 * bi_tra_lai / NULLIF(da_gui, 0) AS tl_tl FROM s) SELECT ma_nv, ho_ten, chuc_danh, ten_khoa, giao, hoan_thanh, dung_han, tre_han, dang_mo, qua_han, bi_tra_lai, gio_cong, round(tl_ht, 1) AS ty_le_hoan_thanh, round(tl_dh, 1) AS ty_le_dung_han, round(tl_tl, 1) AS ty_le_tra_lai, CASE WHEN tl_ht IS NULL AND tl_dh IS NULL THEN NULL ELSE round((0.5 * COALESCE(tl_dh, tl_ht) + 0.3 * COALESCE(tl_ht, tl_dh) + 0.2 * (100 - COALESCE(tl_tl, 0)))::numeric, 1) END AS diem FROM r ORDER BY diem DESC NULLS LAST, hoan_thanh DESC, ho_ten"}, {"key": "ky", "label": "Kỳ báo cáo & người in", "sql": "SELECT to_char(COALESCE(:tu_ngay, date_trunc(''month'', now() AT TIME ZONE ''Asia/Ho_Chi_Minh'')::date), ''DD/MM/YYYY'') AS tu_ngay, to_char(COALESCE(:den_ngay, (now() AT TIME ZONE ''Asia/Ho_Chi_Minh'')::date), ''DD/MM/YYYY'') AS den_ngay, u.ho_ten AS nguoi_in, u.chuc_danh, COALESCE(u.ten_khoa, '''') AS khoa_nguoi_in, COALESCE((SELECT d.name FROM departments d WHERE d.id = :khoa), ''Tất cả khoa/phòng trong phạm vi'') AS khoa_bao_cao FROM v_nguoi_dung u WHERE u.id = :nguoi_dung_id"}], "params": [{"name": "tu_ngay", "label": "Từ ngày (trống = đầu tháng)", "type": "date", "required": false, "default": ""}, {"name": "den_ngay", "label": "Đến ngày (trống = hôm nay)", "type": "date", "required": false, "default": ""}, {"name": "khoa", "label": "ID khoa/phòng (trống = tất cả trong phạm vi)", "type": "number", "required": false, "default": ""}]}}'::jsonb, true, true)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "print_template_versions" ("template_id", "version", "document", "note")
SELECT t."id", 1, t."document", 'Mẫu mặc định phân hệ Quản lý công việc' FROM "print_templates" t
WHERE t."code" = 'CV_HIEU_SUAT_NHAN_VIEN' AND NOT EXISTS (SELECT 1 FROM "print_template_versions" v WHERE v."template_id" = t."id");
--> statement-breakpoint
INSERT INTO "print_templates" ("code", "name", "description", "module", "doc_type", "paper_size", "orientation", "document", "is_default", "active")
VALUES ('CV_PHIEU_GIAO_VIEC', 'Phiếu giao việc', 'Phiếu giao việc cho một công việc: người giao/nhận, hạn, yêu cầu, danh mục kiểm tra, kết quả, ký nhận.', 'TASK', 'CV_PHIEU_GIAO_VIEC', 'A4', 'portrait', '{"paperSize": "A4", "orientation": "portrait", "margins": {"top": 12, "right": 10, "bottom": 12, "left": 10}, "defaultStyle": {"fontSize": 11}, "pages": [{"id": "p1", "elements": [{"id": "el1", "type": "text", "x": 0, "y": 0, "w": 85, "h": 6, "text": "BỆNH VIỆN", "style": {"fontSize": 11, "bold": true, "align": "center", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el2", "type": "text", "x": 0, "y": 6, "w": 85, "h": 6, "text": "{one.cv.ten_khoa}", "style": {"fontSize": 10, "bold": false, "align": "center", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el3", "type": "text", "x": 95, "y": 0, "w": 95, "h": 6, "text": "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", "style": {"fontSize": 11, "bold": true, "align": "center", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el4", "type": "text", "x": 95, "y": 6, "w": 95, "h": 6, "text": "Độc lập - Tự do - Hạnh phúc", "style": {"fontSize": 11, "bold": true, "align": "center", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el5", "type": "text", "x": 0, "y": 13, "w": 85, "h": 6, "text": "Số: {one.cv.ma}", "style": {"fontSize": 10, "bold": false, "align": "center", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el6", "type": "text", "x": 0, "y": 22, "w": 190, "h": 10, "text": "PHIẾU GIAO VIỆC", "style": {"fontSize": 17, "bold": true, "align": "center", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el7", "type": "text", "x": 0, "y": 34, "w": 190, "h": 7, "text": "Nội dung: {one.cv.tieu_de}", "style": {"fontSize": 12, "bold": true, "align": "left", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el8", "type": "text", "x": 0, "y": 42, "w": 110, "h": 6, "text": "Người giao: {one.cv.nguoi_giao}", "style": {"fontSize": 11, "bold": false, "align": "left", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el9", "type": "text", "x": 115, "y": 42, "w": 75, "h": 6, "text": "Ngày giao: {one.cv.ngay_giao_text}", "style": {"fontSize": 11, "bold": false, "align": "left", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el10", "type": "text", "x": 0, "y": 48, "w": 190, "h": 6, "text": "Người thực hiện: {one.cv.nguoi_thuc_hien} — {one.cv.chuc_danh_thuc_hien}", "style": {"fontSize": 11, "bold": false, "align": "left", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el11", "type": "text", "x": 0, "y": 54, "w": 110, "h": 6, "text": "Người duyệt kết quả: {one.cv.nguoi_duyet}", "style": {"fontSize": 11, "bold": false, "align": "left", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el12", "type": "text", "x": 115, "y": 54, "w": 75, "h": 6, "text": "Mức ưu tiên: {one.cv.uu_tien_ten}", "style": {"fontSize": 11, "bold": false, "align": "left", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el13", "type": "text", "x": 0, "y": 60, "w": 110, "h": 6, "text": "Hạn hoàn thành: {one.cv.han_chot_text}", "style": {"fontSize": 11, "bold": false, "align": "left", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el14", "type": "text", "x": 115, "y": 60, "w": 75, "h": 6, "text": "Tiến độ: {one.cv.tien_do}%", "style": {"fontSize": 11, "bold": false, "align": "left", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el15", "type": "text", "x": 0, "y": 66, "w": 110, "h": 6, "text": "Trạng thái hiện tại: {one.cv.trang_thai_ten}", "style": {"fontSize": 11, "bold": false, "align": "left", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el16", "type": "text", "x": 115, "y": 66, "w": 75, "h": 6, "text": "Dự án: {one.cv.du_an_text}", "style": {"fontSize": 11, "bold": false, "align": "left", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el17", "type": "text", "x": 0, "y": 74, "w": 190, "h": 6, "text": "Yêu cầu chi tiết:", "style": {"fontSize": 11, "bold": true, "align": "left", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el18", "type": "text", "x": 0, "y": 80, "w": 190, "h": 30, "text": "{one.cv.mo_ta}", "style": {"fontSize": 11, "bold": false, "align": "left", "italic": false, "wrap": true, "verticalAlign": "top"}}, {"id": "el19", "type": "text", "x": 0, "y": 112, "w": 190, "h": 6, "text": "Danh mục cần thực hiện:", "style": {"fontSize": 11, "bold": true, "align": "left", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "tb22", "type": "table", "x": 0, "y": 118, "w": 190, "h": 20, "style": {"fontSize": 10}, "table": {"dataSource": "ds.checklist", "columns": [{"id": "c20", "title": "Nội dung", "width": 150, "align": "left", "binding": {"source": "row", "path": "noi_dung"}}, {"id": "c21", "title": "Đã xong", "width": 25, "align": "center", "binding": {"source": "row", "path": "xong"}}], "repeatHeader": true, "showIndex": true, "zebra": true, "totalRow": false, "minRowHeight": 6, "pushDown": true, "headerStyle": {"bold": true, "align": "center", "backgroundColor": "#e2e8f0", "fontSize": 10}, "bodyStyle": {"fontSize": 10}}}, {"id": "el23", "type": "text", "x": 0, "y": 140, "w": 190, "h": 6, "text": "Kết quả thực hiện:", "style": {"fontSize": 11, "bold": true, "align": "left", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el24", "type": "text", "x": 0, "y": 146, "w": 190, "h": 24, "text": "{one.cv.ket_qua}", "style": {"fontSize": 11, "bold": false, "align": "left", "italic": false, "wrap": true, "verticalAlign": "top"}}, {"id": "el25", "type": "text", "x": 0, "y": 178, "w": 95, "h": 6, "text": "NGƯỜI NHẬN VIỆC", "style": {"fontSize": 11, "bold": true, "align": "center", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el26", "type": "text", "x": 0, "y": 184, "w": 95, "h": 5, "text": "(Ký, ghi rõ họ tên)", "style": {"fontSize": 9.5, "bold": false, "align": "center", "italic": true, "wrap": true, "verticalAlign": "middle"}}, {"id": "el27", "type": "text", "x": 0, "y": 206, "w": 95, "h": 6, "text": "{one.cv.nguoi_thuc_hien}", "style": {"fontSize": 11, "bold": true, "align": "center", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el28", "type": "text", "x": 95, "y": 172, "w": 95, "h": 6, "text": "Ngày {system.day} tháng {system.month} năm {system.year}", "style": {"fontSize": 10.5, "bold": false, "align": "center", "italic": true, "wrap": true, "verticalAlign": "middle"}}, {"id": "el29", "type": "text", "x": 95, "y": 178, "w": 95, "h": 6, "text": "NGƯỜI GIAO VIỆC", "style": {"fontSize": 11, "bold": true, "align": "center", "italic": false, "wrap": true, "verticalAlign": "middle"}}, {"id": "el30", "type": "text", "x": 95, "y": 184, "w": 95, "h": 5, "text": "(Ký, ghi rõ họ tên)", "style": {"fontSize": 9.5, "bold": false, "align": "center", "italic": true, "wrap": true, "verticalAlign": "middle"}}, {"id": "el31", "type": "text", "x": 95, "y": 206, "w": 95, "h": 6, "text": "{one.cv.nguoi_giao}", "style": {"fontSize": 11, "bold": true, "align": "center", "italic": false, "wrap": true, "verticalAlign": "middle"}}]}], "sqlSource": {"queries": [{"key": "cv", "label": "Thông tin công việc", "sql": "SELECT v.*, COALESCE(to_char(v.han_chot AT TIME ZONE ''Asia/Ho_Chi_Minh'', ''HH24:MI DD/MM/YYYY''), ''Không đặt hạn'') AS han_chot_text, to_char(v.ngay_giao AT TIME ZONE ''Asia/Ho_Chi_Minh'', ''DD/MM/YYYY'') AS ngay_giao_text, COALESCE(v.ten_du_an, ''Không thuộc dự án'') AS du_an_text FROM v_cv_cong_viec v WHERE v.id = :cong_viec_id AND (:pham_vi_khoa IS NULL OR v.khoa_id = ANY(:pham_vi_khoa) OR :nguoi_dung_id IN (v.nguoi_giao_id, v.nguoi_thuc_hien_id, v.nguoi_duyet_id))"}, {"key": "checklist", "label": "Danh mục kiểm tra", "sql": "SELECT c.content AS noi_dung, CASE WHEN c.done THEN ''☑'' ELSE ''☐'' END AS xong FROM task_checklist_items c JOIN v_cv_cong_viec v ON v.id = c.task_id WHERE c.task_id = :cong_viec_id AND (:pham_vi_khoa IS NULL OR v.khoa_id = ANY(:pham_vi_khoa) OR :nguoi_dung_id IN (v.nguoi_giao_id, v.nguoi_thuc_hien_id, v.nguoi_duyet_id)) ORDER BY c.sort_order, c.id"}, {"key": "viec_con", "label": "Việc con", "sql": "SELECT v.ma, v.tieu_de, v.nguoi_thuc_hien, v.trang_thai_ten, v.han_chot FROM v_cv_cong_viec v WHERE v.viec_cha_id = :cong_viec_id AND (:pham_vi_khoa IS NULL OR v.khoa_id = ANY(:pham_vi_khoa) OR :nguoi_dung_id IN (v.nguoi_giao_id, v.nguoi_thuc_hien_id, v.nguoi_duyet_id)) ORDER BY v.id"}], "params": [{"name": "cong_viec_id", "label": "ID công việc", "type": "number", "required": true, "default": ""}]}}'::jsonb, true, true)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "print_template_versions" ("template_id", "version", "document", "note")
SELECT t."id", 1, t."document", 'Mẫu mặc định phân hệ Quản lý công việc' FROM "print_templates" t
WHERE t."code" = 'CV_PHIEU_GIAO_VIEC' AND NOT EXISTS (SELECT 1 FROM "print_template_versions" v WHERE v."template_id" = t."id");
