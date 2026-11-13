"use client";

import { CrudTable, type CrudField } from "@/components/shared/crud-table";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";

/** Danh mục chức vụ quản lý/kiêm nhiệm, độc lập với chức danh chuyên môn. */
export default function ManagementPositionsPage() {
  const can = useAuth((state) => state.can);
  const fields: CrudField[] = [
    { name: "code", label: "Mã", required: true, placeholder: "CNK", help: "Viết liền, không dấu — tự chuyển chữ hoa" },
    { name: "name", label: "Tên chức vụ", required: true, placeholder: "Chủ nhiệm khoa" },
    { name: "sortOrder", label: "Thứ tự", type: "number", hideInTable: true, help: "Dùng để hiển thị và ưu tiên khi bảng chấm công được cấu hình ưu tiên chức vụ." },
    { name: "active", label: "Đang sử dụng", type: "switch", defaultValue: true, help: "Tắt để ẩn khỏi ô chọn; không làm mất chức vụ đang gán cho hồ sơ cũ." },
    { name: "note", label: "Ghi chú", type: "textarea", hideInTable: true, placeholder: "Không bắt buộc" },
  ];
  return <>
    <PageHeader title="Chức vụ kiêm nhiệm" description="Danh mục chức vụ quản lý/kiêm nhiệm, có thứ tự riêng và có thể gán nhiều chức vụ cho một người." />
    <CrudTable
      title="Danh sách chức vụ"
      endpoint="/management-positions"
      fields={fields}
      createLabel="Thêm chức vụ"
      searchPlaceholder="Tìm theo mã, tên chức vụ…"
      canCreate={can("management_position.create")}
      canEdit={can("management_position.update")}
      canDelete={can("management_position.delete")}
      labelKey="name"
      pageSize={50}
      columns={[
        { key: "sortOrder", label: "TT", className: "w-12 text-[var(--muted-foreground)]" },
        { key: "code", label: "Mã", render: (row) => <span className="font-mono text-xs">{String(row.code)}</span> },
        { key: "name", label: "Tên chức vụ", render: (row) => <span className="font-medium">{String(row.name)}</span> },
        { key: "userCount", label: "Số người kiêm nhiệm", render: (row) => Number(row.userCount) > 0 ? <Badge tone="info">{String(row.userCount)} người</Badge> : <span className="text-[var(--muted-foreground)]">—</span> },
        { key: "active", label: "Trạng thái", render: (row) => row.active ? <Badge tone="success">Đang dùng</Badge> : <Badge tone="muted">Ngừng</Badge> },
      ]}
    />
  </>;
}
