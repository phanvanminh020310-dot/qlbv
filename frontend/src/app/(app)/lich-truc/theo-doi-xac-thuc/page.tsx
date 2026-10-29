"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CheckCircle2,
  Clock3,
  MapPin,
  Radio,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  UserRoundCheck,
  Users,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader, StatCard } from "@/components/shared/page-header";
import { errorText } from "@/components/duty/duty-shared";
import { Badge, Card, CardBody, EmptyState, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { RealtimeDot, useRealtimeInvalidate } from "@/lib/realtime";
import { DUTY_KEYS, dutyApi, fmtDateTime, type LiveMonitorRoom } from "@/lib/duty";

function roomHealth(room: LiveMonitorRoom): "success" | "warning" | "danger" {
  const doctors = room.slots.flatMap((slot) => slot.doctors);
  const unassigned = room.slots.reduce((sum, slot) => sum + slot.unassigned, 0);
  if (unassigned > 0) return "danger";
  if (doctors.some((doctor) => doctor.absent)) return "warning";
  return doctors.length > 0 && doctors.every((doctor) => doctor.verified) ? "success" : "warning";
}

function hasItOverride(room: LiveMonitorRoom): boolean {
  return room.slots.some((slot) => slot.doctors.some((doctor) => !!doctor.itOverrideAt));
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function RoomCard({ room }: { room: LiveMonitorRoom }) {
  const health = roomHealth(room);
  const doctors = room.slots.flatMap((slot) => slot.doctors);
  const activeDoctors = doctors.filter((doctor) => !doctor.absent);
  const verified = activeDoctors.filter((doctor) => doctor.verified).length;
  const unassigned = room.slots.reduce((sum, slot) => sum + slot.unassigned, 0);
  const tone = health === "success"
    ? { label: "Đủ xác thực", badge: "success" as const, border: "border-emerald-200 dark:border-emerald-900/70" }
    : health === "danger"
      ? { label: "Thiếu phân công", badge: "danger" as const, border: "border-rose-200 dark:border-rose-900/70" }
      : { label: "Cần theo dõi", badge: "warning" as const, border: "border-amber-200 dark:border-amber-900/70" };

  return (
    <Card className={`overflow-hidden ${tone.border}`}>
      <div className="flex items-start justify-between gap-3 border-b bg-[linear-gradient(135deg,var(--card),var(--muted))] px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)] text-sm font-bold text-white shadow-sm">
              {room.code}
            </span>
            <div className="min-w-0">
              <div className="truncate font-semibold">{room.name}</div>
              <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-[var(--muted-foreground)]">
                <MapPin className="size-3 shrink-0" />
                <span>{room.location || "Chưa cập nhật vị trí"}</span>
              </div>
            </div>
          </div>
        </div>
        <Badge tone={tone.badge}>{health === "success" ? <CheckCircle2 className="size-3.5" /> : <TriangleAlert className="size-3.5" />}{tone.label}</Badge>
      </div>

      <CardBody className="space-y-3 p-3">
        <div className="flex items-center justify-between rounded-lg bg-[var(--muted)]/55 px-3 py-2 text-xs">
          <span className="text-[var(--muted-foreground)]">Xác thực khuôn mặt</span>
          <span className={`font-semibold tabular-nums ${verified === doctors.length && !unassigned ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
            {verified}/{activeDoctors.length} bác sĩ
          </span>
        </div>

        {room.slots.map((slot) => (
          <div key={slot.id} className="rounded-xl border bg-[var(--card)] p-3 shadow-sm">
            <div className="mb-2.5 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span className="size-2 rounded-full" style={{ backgroundColor: slot.shiftColor }} />
                  <span className="truncate">{slot.roleName}</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                  <Clock3 className="size-3.5" />
                  <span>{slot.shiftName} · {slot.startTime}–{slot.endTime}</span>
                </div>
              </div>
              <Badge tone="muted" className="text-[10px]">{slot.shiftCode}</Badge>
            </div>

            <div className="space-y-2">
              {slot.doctors.map((doctor) => (
                <div key={doctor.userId} className="flex items-center gap-2.5 rounded-lg bg-[var(--muted)]/45 px-2.5 py-2">
                  <div className={`flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${doctor.verified ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : doctor.itOverrideAt ? "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"}`}>
                    {initials(doctor.fullName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold">{doctor.title ? `${doctor.title} ` : ""}{doctor.fullName}</div>
                    <div className="truncate text-[11px] text-[var(--muted-foreground)]">{doctor.departmentName || "Nhân viên trực"}</div>
                  </div>
                  {doctor.absent ? (
                    <Badge tone="muted" className="px-1.5 py-0 text-[10px]"><TriangleAlert className="size-3" /> Vắng đã ghi nhận</Badge>
                  ) : doctor.verified ? (
                    <div className="shrink-0 text-right">
                      <Badge tone="success" className="px-1.5 py-0 text-[10px]"><ShieldCheck className="size-3" /> Đã xác thực</Badge>
                      <div className="mt-1 text-[10px] text-[var(--muted-foreground)]">{fmtDateTime(doctor.verifiedAt).split(", ").at(-1)}</div>
                      {doctor.itOverrideAt ? (
                        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-violet-700 dark:text-violet-300" title="Đã có lần mở khoá kỹ thuật trong ca này; không phải xác thực khuôn mặt.">
                          <Wrench className="size-3" /> Đã ghi nhận mở IT
                        </div>
                      ) : null}
                    </div>
                  ) : doctor.itOverrideAt ? (
                    <div className="shrink-0 text-right">
                      <Badge tone="info" className="px-1.5 py-0 text-[10px]"><Wrench className="size-3" /> Mở khẩn cấp IT</Badge>
                      <div className="mt-1 max-w-28 text-[10px] leading-tight text-violet-700 dark:text-violet-300">{fmtDateTime(doctor.itOverrideAt).split(", ").at(-1)} · Chưa xác thực khuôn mặt</div>
                    </div>
                  ) : (
                    <Badge tone="warning" className="px-1.5 py-0 text-[10px]"><Clock3 className="size-3" /> Chờ xác thực</Badge>
                  )}
                </div>
              ))}
              {slot.unassigned > 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-dashed border-rose-300 bg-rose-50/70 px-2.5 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                  <TriangleAlert className="size-4 shrink-0" />
                  Còn thiếu {slot.unassigned}/{slot.requiredCount} vị trí chưa được phân công
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

export default function TheoDoiXacThucPage() {
  const can = useAuth((state) => state.can);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"ALL" | "ATTENTION" | "VERIFIED" | "IT_OVERRIDE">("ALL");
  const canMonitor = can("duty.manage") || can("duty.manage-all");
  const monitor = useQuery({
    queryKey: DUTY_KEYS.liveMonitor,
    queryFn: dutyApi.liveMonitor,
    enabled: canMonitor,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  // Khi điện thoại xác thực thành công, Kiosk phát SSE; chỉ làm mới trang điều
  // phối thay vì polling dày đặc. Poll 60 giây là lớp dự phòng khi tab bị sleep.
  useRealtimeInvalidate({ "duty-attendance": [["duty-live-monitor"]] }, 250);

  const rooms = useMemo(() => (monitor.data?.rooms ?? []).filter((room) => {
    const keyword = search.trim().toLocaleLowerCase("vi");
    const matchesText = !keyword || `${room.code} ${room.name} ${room.location}`.toLocaleLowerCase("vi").includes(keyword);
    const health = roomHealth(room);
    const matchesStatus = status === "ALL"
      || (status === "VERIFIED" ? health === "success" : status === "IT_OVERRIDE" ? hasItOverride(room) : health !== "success");
    return matchesText && matchesStatus;
  }), [monitor.data?.rooms, search, status]);

  if (!canMonitor) {
    return <EmptyState title="Bạn chưa có quyền theo dõi xác thực ca khám" description="Trang này dành cho người được phân công quản lý hoặc điều phối lịch khám." />;
  }

  const summary = monitor.data?.summary;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Theo dõi xác thực ca khám"
        description="Quan sát các phòng đang trong ca khám. Mở khẩn cấp IT được ghi riêng, không bao giờ thay thế xác thực khuôn mặt."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <RealtimeDot className="rounded-full border bg-[var(--card)] px-2.5 py-1.5 shadow-sm" />
            <Button size="sm" variant="outline" onClick={() => void monitor.refetch()} disabled={monitor.isFetching}>
              <RefreshCw className={`size-3.5 ${monitor.isFetching ? "animate-spin" : ""}`} />
              Làm mới
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Phòng đang trong ca" value={summary?.rooms ?? "—"} hint={monitor.data?.scope === "ALL" ? "Toàn viện" : "Trong phạm vi khoa được giao"} icon={<Activity className="size-5" />} tone="primary" />
        <StatCard label="Xác thực khuôn mặt" value={summary ? `${summary.verified}/${summary.expected}` : "—"} hint="Chỉ tính sinh trắc học AI" icon={<UserRoundCheck className="size-5" />} tone="success" />
        <StatCard label="Mở khẩn cấp IT" value={summary?.itOverrides ?? "—"} hint="Đã ghi nhận, không phải sinh trắc học" icon={<Wrench className="size-5" />} tone={summary?.itOverrides ? "primary" : "default"} />
        <StatCard label="Chờ xác thực" value={summary?.pending ?? "—"} hint="Chưa có sinh trắc học hoặc mở IT" icon={<Clock3 className="size-5" />} tone="warning" />
        <StatCard label="Thiếu phân công" value={summary?.unassigned ?? "—"} hint="Vị trí cần xử lý trong ca hiện tại" icon={<Users className="size-5" />} tone={summary?.unassigned ? "danger" : "default"} />
      </div>

      <Card>
        <CardBody className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2 text-xs text-[var(--muted-foreground)]">
            <Radio className="size-4 shrink-0 text-emerald-600" />
            <span className="truncate">Dữ liệu ghi nhận lúc {monitor.data ? fmtDateTime(monitor.data.serverTime) : "—"}; tự cập nhật khi có sinh trắc học hoặc mở khẩn cấp IT.</span>
          </div>
          <div className="grid gap-2 sm:flex sm:items-center">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm phòng hoặc vị trí" className="h-9 sm:w-52" />
            <Select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="h-9 sm:w-44">
              <option value="ALL">Tất cả trạng thái</option>
              <option value="ATTENTION">Cần theo dõi</option>
              <option value="VERIFIED">Đủ xác thực</option>
              <option value="IT_OVERRIDE">Có mở khẩn cấp IT</option>
            </Select>
          </div>
        </CardBody>
      </Card>

      {monitor.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-72" />)}</div>
      ) : monitor.isError ? (
        <EmptyState title="Không thể tải bảng theo dõi" description={errorText(monitor.error)} action={<Button variant="outline" onClick={() => void monitor.refetch()}>Thử lại</Button>} />
      ) : rooms.length ? (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">{rooms.map((room) => <RoomCard key={room.id} room={room} />)}</div>
      ) : monitor.data?.rooms.length ? (
        <EmptyState title="Không có phòng khớp bộ lọc" description="Thử đổi từ khoá tìm kiếm hoặc trạng thái theo dõi." />
      ) : (
        <EmptyState title="Hiện không có ca khám nào đang diễn ra" description="Chỉ các ca khám đã công bố hoặc chốt và đang trong đúng khung giờ mới xuất hiện tại đây." />
      )}
    </div>
  );
}
