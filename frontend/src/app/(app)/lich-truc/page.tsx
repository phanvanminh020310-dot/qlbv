"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, CircleAlert, Download, Printer, Settings2, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ConsultationScheduleBoard } from "@/components/duty/consultation-schedule-board";
import { RoomPicker } from "@/components/duty/room-picker";
import { AssignDialog, CellDialog, QuickCreateNextPeriodDialog } from "@/components/duty/duty-dialogs";
import { PeriodPicker } from "@/components/duty/period-picker";
import { errorText, KpiTile, PhaseBadge, PhaseBanner, ShiftChip } from "@/components/duty/duty-shared";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, Skeleton } from "@/components/ui/card";
import { useRealtimeInvalidate } from "@/lib/realtime";
import { useAuth } from "@/lib/auth";
import { bkkTodayYmd, DUTY_KEYS, dutyApi, fmtDate, type GridSlot } from "@/lib/duty";
import { pickDefaultDutyPeriod } from "@/lib/duty-period-selection";
import { downloadFile } from "@/lib/api";

type CellKey = string;
const cellKey = (roomId: number, date: string) => `${roomId}|${date}`;

export default function LichTrucPage() {
  const can = useAuth((s) => s.can);
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [roomId, setRoomId] = useState<number | null>(null);
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [cell, setCell] = useState<{ key: CellKey; title: string; subtitle: string } | null>(null);
  const [assignSlotId, setAssignSlotId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);

  const canView = can("duty.view");
  const periods = useQuery({ queryKey: DUTY_KEYS.periods, queryFn: () => dutyApi.periods(), enabled: canView });
  useEffect(() => {
    if (periodId === null && periods.data?.length) {
      setPeriodId(pickDefaultDutyPeriod(periods.data, bkkTodayYmd()));
    }
  }, [periods.data, periodId]);

  const today = bkkTodayYmd();
  const sortedPeriods = useMemo(() => periods.data ?? [], [periods.data]);
  const currentPeriod = useMemo(
    () => sortedPeriods.find((p) => p.startDate <= today && p.endDate >= today) ?? null,
    [sortedPeriods, today],
  );
  const currentIndex = useMemo(() => sortedPeriods.findIndex((p) => p.id === periodId), [sortedPeriods, periodId]);


  const isViewingCurrent = currentPeriod && periodId === currentPeriod.id;

  const grid = useQuery({
    queryKey: DUTY_KEYS.grid(periodId ?? 0),
    queryFn: () => dutyApi.grid(periodId as number),
    enabled: canView && !!periodId,
  });
  const g = grid.data;
  useEffect(() => {
    if (!g?.days.length) return;
    if (selectedDate && g.days.some((day) => day.date === selectedDate)) return;
    setSelectedDate(g.days.find((day) => day.date === today)?.date ?? g.days[0].date);
  }, [g?.days, selectedDate, today]);

  useRealtimeInvalidate({
    duty: [["duty-grid"], ["duty-periods"], ["duty-options"], ["duty-me"], ["duty-requests"], ["duty-candidates"]],
  });

  // Chỉ dùng khi người xem không có quyền xếp và cần mở chi tiết một phòng.
  const slotsByCell = useMemo(() => {
    const map = new Map<CellKey, GridSlot[]>();
    for (const slot of g?.slots ?? []) {
      const key = cellKey(slot.roomId, slot.dutyDate);
      const list = map.get(key) ?? [];
      list.push(slot);
      map.set(key, list);
    }
    for (const slots of map.values()) slots.sort((a, b) => a.start - b.start || a.roleName.localeCompare(b.roleName, "vi"));
    return map;
  }, [g]);

  const rooms = useMemo(() => {
    const selected = (g?.rooms ?? []).filter((room) => roomId === null || room.id === roomId);
    if (!showMissingOnly) return selected;
    return selected.filter((room) =>
      (g?.slots ?? []).some((slot) => slot.roomId === room.id && slot.filled < slot.requiredCount),
    );
  }, [g, roomId, showMissingOnly]);
  const assignSlot = useMemo(() => g?.slots.find((s) => s.id === assignSlotId) ?? null, [g, assignSlotId]);

  const openCell = (roomId: number, date: string) => {
    if (!g) return;
    const room = g.rooms.find((r) => r.id === roomId);
    const day = g.days.find((d) => d.date === date);
    setCell({
      key: cellKey(roomId, date),
      title: `${room?.code ?? ""} · ${day?.label ?? ""} ${fmtDate(date)}`,
      subtitle: `${room?.name ?? ""}${day?.closed ? ` · Nghỉ: ${day.closedName}` : ""}`,
    });
  };

  const onExport = async () => {
    if (!periodId || !g) return;
    setExporting(true);
    try {
      await downloadFile(dutyApi.exportPath(periodId), `lich-kham-${g.period.startDate}_${g.period.endDate}.xlsx`);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setExporting(false);
    }
  };

  if (!canView) {
    return <EmptyState title="Bạn chưa có quyền xem lịch khám" description="Liên hệ Khoa Kế hoạch tổng hợp để được cấp quyền." />;
  }

  return (
    <>
      <PageHeader
        title="Lịch bác sĩ khám bệnh"
        description="Chọn kỳ khám và ngày; bấm trực tiếp vào ca sáng hoặc chiều để xếp bác sĩ ngay. Lịch theo ngày giúp nhiều phòng vẫn rõ ràng, dễ thao tác."
        actions={
          <div className="grid w-full gap-2 print:hidden sm:flex sm:w-auto sm:flex-wrap sm:items-center">
            {/* Thanh điều hướng tuần: chọn nhanh trên điện thoại, đầy đủ trên desktop */}
            <div className="grid w-full grid-cols-[auto_auto_auto] items-center gap-1 rounded-xl border bg-[var(--card)] p-1 shadow-sm sm:flex sm:w-auto">
              <Button
                size="sm"
                variant="ghost"
                disabled={currentIndex < 0 || currentIndex >= sortedPeriods.length - 1}
                onClick={() => {
                  if (currentIndex < sortedPeriods.length - 1) {
                    setPeriodId(sortedPeriods[currentIndex + 1].id);
                    setRoomId(null);
                  }
                }}
                title="Kỳ khám trước"
                className="h-8 px-2"
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="hidden md:inline ml-0.5 text-xs">Trước</span>
              </Button>

              <Button
                size="sm"
                variant={isViewingCurrent ? "default" : "outline"}
                onClick={() => {
                  if (currentPeriod) {
                    setPeriodId(currentPeriod.id);
                    setRoomId(null);
                  }
                }}
                disabled={!currentPeriod}
                className="h-8 px-2.5 text-xs font-semibold"
                title="Nhảy nhanh về tuần đang diễn ra"
              >
                ★ Tuần này
              </Button>

              <Button
                size="sm"
                variant="ghost"
                disabled={currentIndex <= 0}
                onClick={() => {
                  if (currentIndex > 0) {
                    setPeriodId(sortedPeriods[currentIndex - 1].id);
                    setRoomId(null);
                  }
                }}
                title="Kỳ khám kế tiếp"
                className="h-8 px-2"
              >
                <span className="hidden md:inline mr-0.5 text-xs">Sau</span>
                <ChevronRight className="h-4 w-4" />
              </Button>

              <PeriodPicker
                periods={sortedPeriods}
                value={periodId}
                onChange={(id) => {
                  setPeriodId(id);
                  setRoomId(null);
                }}
                className="order-last col-span-3 w-full sm:order-none sm:col-auto sm:min-w-[15.5rem]"
              />
            </div>

            {can("duty.period.manage") ? (
              <Button
                variant="outline"
                size="sm"
                className="h-9 w-full border-emerald-400 bg-emerald-50/80 text-emerald-800 shadow-xs hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/60 sm:w-auto"
                onClick={() => setQuickCreateOpen(true)}
              >
                <Sparkles className="h-4 w-4 mr-1 text-emerald-600 dark:text-emerald-400" /> Tạo kỳ khám kế tiếp
              </Button>
            ) : null}

            {g?.viewer.canExport ? (
              <Button variant="outline" size="sm" className="h-9 w-full sm:w-auto" onClick={onExport} disabled={exporting}>
                <Download className="h-4 w-4" /> Xuất Excel
              </Button>
            ) : null}
            <Button variant="outline" size="sm" className="h-9 w-full sm:w-auto" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> In
            </Button>
            {can("duty.period.manage") ? (
              <Link href="/lich-truc/ky-lich">
                <Button variant="outline" size="sm" className="h-9 w-full sm:w-auto">
                  <Settings2 className="h-4 w-4" /> Quản lý kỳ
                </Button>
              </Link>
            ) : null}
          </div>
        }
      />

      {periods.isLoading || (periodId && grid.isLoading) ? (
        <div className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      ) : null}

      {!periods.isLoading && !periods.data?.length ? (
        <EmptyState
          title="Chưa có kỳ lịch khám"
          description={can("duty.period.manage") ? "Tạo kỳ lịch khám đầu tiên để bắt đầu xếp bác sĩ." : "Lịch khám sẽ hiển thị khi kỳ được công bố."}
          action={
            can("duty.period.manage") ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  onClick={() => setQuickCreateOpen(true)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                >
                  <Sparkles className="h-4 w-4 mr-1" /> Tạo kỳ khám kế tiếp
                </Button>
                <Link href="/lich-truc/ky-lich">
                  <Button variant="outline">Quản lý kỳ lịch</Button>
                </Link>
              </div>
            ) : undefined
          }
        />
      ) : null}

      {g ? (
        <div className="space-y-4">
          <PhaseBanner period={g.period} canManage={g.viewer.canManage} />

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile label="Ca khám trong kỳ" value={g.summary.slots} hint={`${g.days.filter((d) => !d.closed).length} ngày làm việc`} />
            <KpiTile label="Bác sĩ đã xếp" value={g.summary.people} hint="Số người được phân công khám" tone="info" />
            <KpiTile
              label="Đã đủ người"
              value={`${g.summary.required ? Math.round((Math.min(g.summary.filled, g.summary.required) / g.summary.required) * 100) : 0}%`}
              hint={`${g.summary.filled}/${g.summary.required} vị trí`}
              tone="success"
            />
            <KpiTile
              label="Còn thiếu người"
              value={g.summary.missing}
              hint={g.summary.missing ? "Vị trí khám chưa đủ bác sĩ" : "Không có vị trí thiếu"}
              tone={g.summary.missing ? "warning" : "default"}
            />
          </div>

          <Card>
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-[var(--primary)]" />
                  <span className="sm:hidden">Lịch theo phòng</span>
                  <span className="hidden sm:inline">Lịch bác sĩ khám bệnh · {fmtDate(g.period.startDate)} – {fmtDate(g.period.endDate)}</span>
                  <PhaseBadge period={g.period} />
                </span>
              }
              description={
                <>
                  <span className="text-xs text-[var(--muted-foreground)] sm:hidden">Ca sáng · Ca chiều · Cả ngày</span>
                  <span className="hidden flex-wrap items-center gap-x-3 gap-y-1 sm:flex">
                    {g.shifts.map((shift) => (
                      <span key={shift.id} className="inline-flex items-center gap-1.5">
                        <ShiftChip code={shift.code} color={shift.color} />
                        <span>{shift.name} ({shift.startTime}–{shift.endTime})</span>
                      </span>
                    ))}
                  </span>
                </>
              }
              actions={
                <div className="grid w-full gap-2 print:hidden sm:flex sm:w-auto sm:items-center">
                  {g.viewer.canManage && g.summary.missing > 0 ? (
                    <button
                      type="button"
                      aria-pressed={showMissingOnly}
                      onClick={() => setShowMissingOnly((value) => !value)}
                      className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors sm:h-8 ${
                        showMissingOnly
                          ? "border-amber-500 bg-amber-100 text-amber-900 dark:border-amber-500 dark:bg-amber-950/60 dark:text-amber-200"
                          : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
                      }`}
                    >
                      <CircleAlert className="h-3.5 w-3.5" />
                      {showMissingOnly ? "Đang xem vị trí thiếu" : `${g.summary.missing} vị trí cần xếp`}
                    </button>
                  ) : null}
                  <RoomPicker
                    rooms={g.rooms}
                    value={roomId}
                    onChange={setRoomId}
                    className="w-full sm:w-64"
                  />
                </div>
              }
            />
            <CardBody className="p-3 sm:p-4">
              <ConsultationScheduleBoard
                grid={g}
                rooms={rooms}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                onSelectSlot={(slot) => setAssignSlotId(slot.id)}
                onInspectRoom={(room, date) => openCell(room.id, date)}
              />
            </CardBody>
          </Card>

          {g.viewer.canManage && g.summary.missing > 0 ? (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100 print:hidden">
              <Users className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                Còn <b>{g.summary.missing}</b> vị trí khám chưa đủ bác sĩ. Lọc vị trí thiếu, chọn ngày rồi bấm trực tiếp vào ca sáng hoặc chiều để xếp ngay.
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Chi tiết một ô phòng × ngày */}
      {g && cell ? (
        <CellDialog
          open={!!cell}
          onClose={() => setCell(null)}
          title={cell.title}
          subtitle={cell.subtitle}
          slots={slotsByCell.get(cell.key) ?? []}
          grid={g}
          onAssign={(s) => {
            setCell(null);
            setAssignSlotId(s.id);
          }}
        />
      ) : null}

      {g ? (
        <AssignDialog
          open={!!assignSlot}
          onClose={() => setAssignSlotId(null)}
          slot={assignSlot}
          canManageAll={g.viewer.canManageAll}
          locked={g.period.locked}
        />
      ) : null}

      {quickCreateOpen ? (
        <QuickCreateNextPeriodDialog
          onClose={() => setQuickCreateOpen(false)}
          onCreated={(newId) => {
            setPeriodId(newId);
            setQuickCreateOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
