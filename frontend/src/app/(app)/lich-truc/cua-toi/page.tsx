"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Clock3, MapPin } from "lucide-react";
import { useMemo } from "react";
import { KpiTile, ShiftChip, SourceTag } from "@/components/duty/duty-shared";
import { PageHeader } from "@/components/shared/page-header";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Skeleton,
} from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import {
  DUTY_KEYS,
  dutyApi,
  fmtDate,
  fmtDm,
  weekdayLabel,
  type MySlot,
} from "@/lib/duty";

const dayOf = (ymd: string) =>
  weekdayLabel(new Date(`${ymd}T00:00:00Z`).getUTCDay() || 7);

/**
 * Trang cá nhân chỉ để đọc. Bác sĩ/điều dưỡng xem các ca đã được người xếp
 * lịch phân công; mọi thay đổi được thực hiện bởi người xếp lịch khám của khoa.
 */
export default function LichCuaToiPage() {
  const can = useAuth((s) => s.can);
  const canView = can("duty.view");
  const me = useQuery({
    queryKey: DUTY_KEYS.me,
    queryFn: () => dutyApi.me(),
    enabled: canView,
  });

  const { upcoming, past, nextShift } = useMemo(() => {
    const assignments: MySlot[] = me.data?.assignments ?? [];
    const upcoming = assignments.filter((slot) => !slot.past);
    const past = assignments.filter((slot) => slot.past);
    return { upcoming, past, nextShift: upcoming[0] };
  }, [me.data?.assignments]);

  if (!canView) return <EmptyState title="Bạn chưa có quyền xem lịch khám" />;

  return (
    <>
      <PageHeader
        title="Lịch của tôi"
        description="Các ca khám đã được phân công. Nếu cần điều chỉnh lịch hoặc báo nghỉ/bận, vui lòng liên hệ Người xếp lịch khám của khoa."
      />

      {me.isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <Skeleton key={item} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-72 w-full" />
        </div>
      ) : null}

      {me.data ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <KpiTile
              label="Ca khám sắp tới"
              value={upcoming.length}
              hint={
                nextShift
                  ? `Tiếp theo: ${dayOf(nextShift.dutyDate)} ${fmtDm(nextShift.dutyDate)}`
                  : "Chưa có ca khám sắp tới"
              }
              tone="info"
            />
            <KpiTile
              label="Kỳ lịch khám đang hiển thị"
              value={
                me.data.periods.filter((period) => period.status !== "NHAP")
                  .length
              }
              hint="Kỳ đã công bố hoặc đã chốt"
            />
            <KpiTile
              label="Ca khám đã hoàn thành"
              value={past.length}
              hint="Theo dữ liệu lịch khám"
              tone="success"
            />
          </div>

          <Card>
            <CardHeader
              title="Ca khám sắp tới"
              description="Lịch chỉ đọc; thông tin phòng, giờ khám và vai trò được cập nhật ngay khi người xếp lịch phân công."
              actions={
                upcoming.length ? (
                  <Badge tone="brand">{upcoming.length} ca</Badge>
                ) : undefined
              }
            />
            <CardBody>
              {upcoming.length === 0 ? (
                <EmptyState
                  title="Bạn chưa có ca khám sắp tới"
                  description="Khi được phân công, ca khám sẽ xuất hiện tại đây."
                />
              ) : (
                <ul className="grid gap-3 xl:grid-cols-2">
                  {upcoming.map((slot) => (
                    <DutyCard key={slot.id} slot={slot} />
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {past.length ? (
            <Card>
              <CardHeader
                title="Ca khám đã hoàn thành gần đây"
                description="Bản ghi tham khảo, chỉ đọc."
              />
              <CardBody>
                <ul className="divide-y rounded-xl border">
                  {past.slice(0, 12).map((slot) => (
                    <li
                      key={slot.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm text-[var(--muted-foreground)]"
                    >
                      <span className="font-medium text-[var(--foreground)]">
                        {dayOf(slot.dutyDate)} · {fmtDate(slot.dutyDate)}
                      </span>
                      <ShiftChip
                        code={slot.shiftCode}
                        color={slot.shiftColor}
                      />
                      <span>
                        {slot.roomCode} · {slot.roomName}
                      </span>
                      <span>
                        {slot.startTime}–{slot.endTime}
                      </span>
                      <SourceTag source={slot.source} />
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function DutyCard({ slot }: { slot: MySlot }) {
  return (
    <li className="rounded-xl border bg-[var(--card)] p-3.5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="w-14 shrink-0 rounded-lg bg-[var(--accent)] py-2 text-center text-[var(--accent-foreground)]">
          <div className="text-lg font-bold leading-none tabular-nums">
            {fmtDm(slot.dutyDate).slice(0, 5)}
          </div>
          <div className="mt-1 text-[11px] font-medium">
            {dayOf(slot.dutyDate)}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <ShiftChip code={slot.shiftCode} color={slot.shiftColor} />
            <span className="font-semibold">{slot.roleName}</span>
            {slot.locked ? (
              <Badge tone="success">Đã chốt</Badge>
            ) : (
              <Badge tone="muted">Đã phân công</Badge>
            )}
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-sm font-medium">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />{" "}
            {slot.roomCode} · {slot.roomName}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            <Clock3 className="h-3.5 w-3.5 shrink-0" /> {fmtDate(slot.dutyDate)}{" "}
            · {slot.startTime}–{slot.endTime}
            <SourceTag source={slot.source} />
          </p>
        </div>
      </div>
    </li>
  );
}
