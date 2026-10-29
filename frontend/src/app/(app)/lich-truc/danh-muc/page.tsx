"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CrudTable, type CrudField } from "@/components/shared/crud-table";
import { PageHeader } from "@/components/shared/page-header";
import { Tabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { SHIFT_PALETTE } from "@/lib/duty";

type Opt = { id?: number; value?: number | string; name?: string; label?: string };
const toOptions = (list: unknown) =>
  (Array.isArray(list) ? list : []).map((o: Opt) => ({
    value: (o.id ?? o.value) as number | string,
    label: String(o.name ?? o.label ?? ""),
  }));

/** Danh mục nền của Lịch bác sĩ khám: phòng khám, ca khám, vai trò khám, ngày nghỉ */
export default function DanhMucTrucPage() {
  const can = useAuth((s) => s.can);
  const canManage = can("duty.catalog.manage");
  const [tab, setTab] = useState("rooms");

  const departments = useQuery({
    queryKey: ["departments-options-duty"],
    queryFn: () => apiFetch<unknown>("/departments/options"),
    staleTime: 60_000,
  });
  const jobTitles = useQuery({
    queryKey: ["job-titles-options-duty"],
    queryFn: () => apiFetch<unknown>("/job-titles/options"),
    staleTime: 60_000,
  });
  const deptOptions = toOptions(departments.data);
  const titleOptions = toOptions(jobTitles.data).map((o) => ({ value: String(o.label), label: String(o.label) }));

  const roomFields: CrudField[] = [
    { name: "code", label: "Mã phòng", required: true, placeholder: "P1", help: "Viết liền, không dấu. Không phân biệt hoa thường." },
    { name: "name", label: "Tên phòng khám", required: true, placeholder: "Phòng khám số 1" },
    {
      name: "departmentId",
      label: "Khoa quản lý",
      type: "select",
      options: deptOptions.map((o) => ({ value: Number(o.value), label: o.label })),
      help: "Trưởng khoa chỉ xếp bác sĩ khám cho phòng thuộc khoa mình. Bỏ trống: chỉ Điều phối toàn viện xếp.",
      hideInTable: false,
    },
    { name: "location", label: "Vị trí", placeholder: "Tầng 2, khu A", hideInTable: true },
    { name: "sortOrder", label: "Thứ tự hiển thị", type: "number", hideInTable: true, help: "Nhỏ hơn xếp trước trên lịch" },
    { name: "active", label: "Đang sử dụng", type: "switch", defaultValue: true, help: "Tắt để không sinh ô mới (ô cũ vẫn giữ)" },
    { name: "note", label: "Ghi chú", type: "textarea", hideInTable: true },
  ];

  const shiftFields: CrudField[] = [
    { name: "code", label: "Mã ca", required: true, placeholder: "S", help: "Ví dụ: S (sáng), C (chiều), CD (cả ngày), D (đêm)" },
    { name: "name", label: "Tên ca", required: true, placeholder: "Khám buổi sáng" },
    { name: "startTime", label: "Giờ bắt đầu", type: "time", required: true },
    { name: "endTime", label: "Giờ kết thúc", type: "time", required: true, help: "Kết thúc trước giờ bắt đầu = ca qua đêm" },
    { name: "isNight", label: "Ca đêm", type: "switch", defaultValue: false, hideInTable: true, help: "Ca đêm có giới hạn riêng và cần khoảng nghỉ liền kề" },
    { name: "color", label: "Màu hiển thị", type: "color", palette: SHIFT_PALETTE, defaultValue: SHIFT_PALETTE[0].value, hideInTable: true, help: 'Chọn từ bảng màu; cần màu khác thì bấm "Màu khác"' },
    { name: "sortOrder", label: "Thứ tự", type: "number", hideInTable: true },
    { name: "active", label: "Đang sử dụng", type: "switch", defaultValue: true },
    { name: "note", label: "Ghi chú", type: "textarea", hideInTable: true },
  ];

  const roleFields: CrudField[] = [
    { name: "code", label: "Mã vai trò", required: true, placeholder: "BS" },
    { name: "name", label: "Tên vai trò khám", required: true, placeholder: "Bác sĩ khám" },
    {
      name: "requiredTitle",
      label: "Chức danh bắt buộc",
      type: "select",
      options: titleOptions.map((o) => ({ value: o.value, label: o.label })),
      help: "Chỉ người có chức danh này mới được xếp vào vai trò. Bỏ trống: không yêu cầu.",
    },
    { name: "sortOrder", label: "Thứ tự", type: "number", hideInTable: true },
    { name: "active", label: "Đang sử dụng", type: "switch", defaultValue: true },
    { name: "note", label: "Ghi chú", type: "textarea", hideInTable: true },
  ];

  const closedFields: CrudField[] = [
    { name: "date", label: "Ngày nghỉ", type: "date", required: true },
    { name: "name", label: "Tên ngày nghỉ", required: true, placeholder: "Quốc khánh 2/9" },
    { name: "note", label: "Ghi chú", type: "textarea", hideInTable: true },
  ];

  if (!can("duty.catalog.manage")) return <EmptyState title="Trang này dành cho người quản trị danh mục lịch khám" />;

  return (
    <>
      <PageHeader
        title="Danh mục lịch khám"
        description="Phòng khám, ca khám, vai trò khám và ngày nghỉ. Thay đổi ở đây áp dụng cho các kỳ lập sau; ca đã sinh không tự đổi."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          {
            key: "rooms",
            label: "Phòng khám",
            content: (
              <CrudTable
                title="Phòng khám"
                description="Danh sách phòng khám tham gia lịch khám"
                endpoint="/duty/rooms"
                fields={roomFields}
                canCreate={canManage}
                canEdit={canManage}
                canDelete={canManage}
                labelKey="name"
                createLabel="Thêm phòng khám"
                searchPlaceholder="Tìm mã hoặc tên phòng"
              />
            ),
          },
          {
            key: "shifts",
            label: "Ca khám",
            content: (
              <CrudTable
                title="Ca khám"
                description="Khung giờ các ca khám. Có thể cấu hình sáng, chiều hoặc các khung giờ chuyên biệt."
                endpoint="/duty/shifts"
                fields={shiftFields}
                canCreate={canManage}
                canEdit={canManage}
                canDelete={canManage}
                labelKey="name"
                createLabel="Thêm ca khám"
                searchPlaceholder="Tìm mã hoặc tên ca"
              />
            ),
          },
          {
            key: "roles",
            label: "Vai trò khám",
            content: (
              <CrudTable
                title="Vai trò khám"
                description="Vai trò trong một ca khám (bác sĩ, điều dưỡng…) và chức danh tương ứng"
                endpoint="/duty/roles"
                fields={roleFields}
                canCreate={canManage}
                canEdit={canManage}
                canDelete={canManage}
                labelKey="name"
                createLabel="Thêm vai trò"
                searchPlaceholder="Tìm vai trò"
              />
            ),
          },
          {
            key: "closed",
            label: "Ngày nghỉ",
            content: (
              <CrudTable
                title="Ngày nghỉ lễ / nghỉ chung"
                description="Ngày không sinh ca khám khi tạo lịch (ví dụ lễ, Tết)"
                endpoint="/duty/closed-days"
                fields={closedFields}
                canCreate={canManage}
                canEdit={canManage}
                canDelete={canManage}
                labelKey="name"
                createLabel="Thêm ngày nghỉ"
                searchPlaceholder="Tìm ngày nghỉ"
              />
            ),
          },
        ]}
      />
    </>
  );
}
