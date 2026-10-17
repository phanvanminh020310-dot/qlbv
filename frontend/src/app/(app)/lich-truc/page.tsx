"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Download, Printer, Settings2, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AssignDialog, CellDialog, QuickCreateNextPeriodDialog } from "@/components/duty/duty-dialogs";
import { CurrentWeekBadge, errorText, KpiTile, PhaseBadge, PhaseBanner, ShiftChip } from "@/components/duty/duty-shared";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, Skeleton } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { useRealtimeInvalidate } from "@/lib/realtime";
import { useAuth } from "@/lib/auth";
import { bkkTodayYmd, DUTY_KEYS, dutyApi, fmtDate, fmtDm, type GridSlot } from "@/lib/duty";
import { downloadFile } from "@/lib/api";

type CellKey = string;
const cellKey = (roomId: number, date: string) => `${roomId}|${date}`;

/** Chọn kỳ mặc định: kỳ đang diễn ra hoặc kỳ sắp tới gần nhất (ưu tiên kỳ đã công bố) */
function pickDefaultPeriod(periods: { id: number; startDate: string; endDate: string; status: string }[]): number | null {
  if (!periods.length) return null;
  const today = bkkTodayYmd();
  const visible = periods.filter((p) => p.status !== "NHAP");
  const pool = visible.length ? visible : periods;
  const current = pool.find((p) => p.startDate <= today && p.endDate >= today);
  if (current) return current.id;
  const upcoming = [...pool].filter((p) => p.startDate > today).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  return (upcoming ?? [...pool].sort((a, b) => b.startDate.localeCompare(a.startDate))[0]).id;
}

/** Nội dung một ô phòng × ngày: các ca và người trực */
function CellPreview({ slots, meId }: { slots: GridSlot[]; meId: number }) {
  if (!slots.length) return <span className="text-xs text-[var(--muted-foreground)]/60">—</span>;
  return (
    <div className="space-y-1">
      {slots.map((s) => {
        const mine = s.assignments.some((a) => a.userId === meId);
        const short = s.filled < s.requiredCount;
        const names = s.assignments.map((a) => a.fullName).join(", ");
        return (
          <div
            key={s.id}
            className={`flex items-start gap-1.5 rounded-md px-1.5 py-1 ${mine ? "bg-[var(--accent)] ring-1 ring-[var(--primary)]/40" : "bg-[var(--muted)]/50"}`}
          >
            <ShiftChip code={s.shiftCode} color={s.shiftColor} className="mt-px" />
            <div className="min-w-0 flex-1 text-[11.5px] leading-snug">
              <div className="truncate" title={names}>
                {names || <span className="font-medium text-amber-600 dark:text-amber-400">Chưa có người</span>}
              </div>
              <div className="flex items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
                <span>{s.roleName}</span>
                <span>·</span>
                <span className={short ? "font-semibold text-amber-600 dark:text-amber-400" : ""}>
                  {s.filled}/{s.requiredCount}
                </span>
                {s.past ? <span>· đã qua</span> : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function LichTrucPage() {
  const can = useAuth((s) => s.can);
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [roomFilter, setRoomFilter] = useState<string>("ALL");
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [mobileDate, setMobileDate] = useState<string | null>(null);
  const [cell, setCell] = useState<{ key: CellKey; title: string; subtitle: string } | null>(null);
  const [assignSlotId, setAssignSlotId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);

  const canView = can("duty.view");
  const periods = useQuery({ queryKey: DUTY_KEYS.periods, queryFn: () => dutyApi.periods(), enabled: canView });
  useEffect(() => {
    if (periodId === null && periods.data?.length) setPeriodId(pickDefaultPeriod(periods.data));
  }, [periods.data, periodId]);

  const today = bkkTodayYmd();
  const sortedPeriods = useMemo(() => periods.data ?? [], [periods.data]);
  const currentPeriod = useMemo(
    () => sortedPeriods.find((p) => p.startDate <= today && p.endDate >= today) ?? null,
    [sortedPeriods, today],
  );
  const currentIndex = useMemo(() => sortedPeriods.findIndex((p) => p.id === periodId), [sortedPeriods, periodId]);

  const groupedPeriods = useMemo(() => {
    const map = new Map<string, typeof sortedPeriods>();
    for (const p of sortedPeriods) {
      const [y, m] = p.startDate.split("-");
      const key = `Tháng ${m}/${y}`;
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [sortedPeriods]);

  const isViewingCurrent = currentPeriod && periodId === currentPeriod.id;

  const grid = useQuery({
    queryKey: DUTY_KEYS.grid(periodId ?? 0),
    queryFn: () => dutyApi.grid(periodId as number),
    enabled: canView && !!periodId,
  });
  const g = grid.data;
  useEffect(() => {
    if (!g?.days.length) return;
    if (mobileDate && g.days.some((day) => day.date === mobileDate)) return;
    setMobileDate(g.days.find((day) => day.date === today)?.date ?? g.days[0].date);
  }, [g?.days, mobileDate, today]);

  useRealtimeInvalidate({
    duty: [["duty-grid"], ["duty-periods"], ["duty-options"], ["duty-me"], ["duty-requests"], ["duty-candidates"]],
  });

  const slotsByCell = useMemo(() => {
    const m = new Map<CellKey, GridSlot[]>();
    for (const s of g?.slots ?? []) {
      const k = cellKey(s.roomId, s.dutyDate);
      const list = m.get(k) ?? [];
      list.push(s);
      m.set(k, list);
    }
    for (const list of m.values()) list.sort((a, b) => a.start - b.start || a.roleName.localeCompare(b.roleName, "vi"));
    return m;
  }, [g]);

  const rooms = useMemo(() => {
    const selected = (g?.rooms ?? []).filter((r) => roomFilter === "ALL" || String(r.id) === roomFilter);
    if (!showMissingOnly) return selected;
    return selected.filter((room) =>
      (g?.slots ?? []).some((slot) => slot.roomId === room.id && slot.filled < slot.requiredCount),
    );
  }, [g, roomFilter, showMissingOnly]);
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
      await downloadFile(dutyApi.exportPath(periodId), `lich-truc-${g.period.startDate}_${g.period.endDate}.xlsx`);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setExporting(false);
    }
  };

  if (!canView) {
    return <EmptyState title="Bạn chưa có quyền xem lịch trực" description="Liên hệ Khoa Kế hoạch tổng hợp để được cấp quyền." />;
  }

  return (
    <>
      <PageHeader
        title="Lịch trực khám bệnh"
        description="Chọn tuần → chọn ngày → chạm vào phòng để xem ca và xếp người. Trên điện thoại, ưu tiên các vị trí còn thiếu để thao tác nhanh."
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
                    setRoomFilter("ALL");
                  }
                }}
                title="Tuần trước"
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
                    setRoomFilter("ALL");
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
                    setRoomFilter("ALL");
                  }
                }}
                title="Tuần kế tiếp"
                className="h-8 px-2"
              >
                <span className="hidden md:inline mr-0.5 text-xs">Sau</span>
                <ChevronRight className="h-4 w-4" />
              </Button>

              <Select
                className="order-last col-span-3 h-9 w-full border-0 bg-transparent text-xs font-medium shadow-none focus:ring-0 sm:order-none sm:col-auto sm:h-8 sm:min-w-[16rem] sm:w-auto"
                aria-label="Chọn kỳ lịch"
                value={periodId ? String(periodId) : ""}
                onChange={(e) => {
                  setPeriodId(e.target.value ? Number(e.target.value) : null);
                  setRoomFilter("ALL");
                }}
              >
                {groupedPeriods.map(([groupLabel, groupItems]) => (
                  <optgroup key={groupLabel} label={`── ${groupLabel} ──`}>
                    {groupItems.map((p) => {
                      const isCur = p.startDate <= today && p.endDate >= today;
                      return (
                        <option key={p.id} value={p.id}>
                          {p.name} ({fmtDm(p.startDate)}–{fmtDm(p.endDate)}) {isCur ? "★ [Tuần này]" : ""} [{p.status === "NHAP" ? "Nháp" : p.locked ? "Đã chốt" : "Đã công bố"}]
                        </option>
                      );
                    })}
                  </optgroup>
                ))}
              </Select>
            </div>

            {can("duty.period.manage") ? (
              <Button
                variant="outline"
                size="sm"
                className="h-9 w-full border-emerald-400 bg-emerald-50/80 text-emerald-800 shadow-xs hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/60 sm:w-auto"
                onClick={() => setQuickCreateOpen(true)}
              >
                <Sparkles className="h-4 w-4 mr-1 text-emerald-600 dark:text-emerald-400" /> Tạo tuần tiếp theo
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
          title="Chưa có kỳ lịch trực"
          description={can("duty.period.manage") ? "Tạo kỳ lịch tuần đầu tiên để bắt đầu lập lịch trực." : "Lịch trực sẽ hiển thị khi kỳ lịch được công bố."}
          action={
            can("duty.period.manage") ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  onClick={() => setQuickCreateOpen(true)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                >
                  <Sparkles className="h-4 w-4 mr-1" /> Tạo tuần tiếp theo
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
            <KpiTile label="Ca trực trong tuần" value={g.summary.slots} hint={`${g.days.filter((d) => !d.closed).length} ngày làm việc`} />
            <KpiTile label="Người trực" value={g.summary.people} hint="Số nhân viên được xếp" tone="info" />
            <KpiTile
              label="Đã đủ người"
              value={`${g.summary.required ? Math.round((Math.min(g.summary.filled, g.summary.required) / g.summary.required) * 100) : 0}%`}
              hint={`${g.summary.filled}/${g.summary.required} vị trí`}
              tone="success"
            />
            <KpiTile
              label="Còn thiếu người"
              value={g.summary.missing}
              hint={g.summary.missing ? "Ô chưa đủ người trực" : "Không có ô thiếu"}
              tone={g.summary.missing ? "warning" : "default"}
            />
          </div>

          <Card>
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-[var(--primary)]" /> Lịch tuần {fmtDate(g.period.startDate)} – {fmtDate(g.period.endDate)}
                  <PhaseBadge period={g.period} />
                </span>
              }
              description={
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {g.shifts.map((s) => (
                    <span key={s.id} className="inline-flex items-center gap-1.5">
                      <ShiftChip code={s.code} color={s.color} />
                      <span>
                        {s.name} ({s.startTime}–{s.endTime})
                      </span>
                    </span>
                  ))}
                </span>
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
                      {showMissingOnly ? "Đang xem ô thiếu" : `${g.summary.missing} vị trí cần xếp`}
                    </button>
                  ) : null}
                  <Select className="h-9 w-full text-xs sm:h-8 sm:w-44" aria-label="Lọc theo phòng" value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)}>
                    <option value="ALL">Tất cả phòng</option>
                    {g.rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.code} — {r.name}
                      </option>
                    ))}
                  </Select>
                </div>
              }
            />
            <CardBody className="p-0">
              {/* Lưới trên màn hình rộng */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[860px] border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 w-28 border-b bg-[var(--card)] px-3 py-2.5 text-left text-xs font-semibold text-[var(--muted-foreground)]">
                        Phòng khám
                      </th>
                      {g.days.map((d) => (
                        <th
                          key={d.date}
                          className={`border-b border-l px-2 py-2 text-center ${d.date === today ? "bg-[var(--accent)]" : "bg-[var(--card)]"} ${d.closed ? "bg-[var(--muted)]" : ""}`}
                        >
                          <div className="text-xs font-semibold">{d.label}</div>
                          <div className="text-[11px] text-[var(--muted-foreground)]">{fmtDm(d.date)}</div>
                          {d.closed ? (
                            <div className="mt-0.5 truncate text-[10px] font-medium text-rose-600" title={d.closedName}>
                              Nghỉ · {d.closedName}
                            </div>
                          ) : null}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rooms.map((r) => (
                      <tr key={r.id}>
                        <td className="sticky left-0 z-10 border-b bg-[var(--card)] px-3 py-2 align-top">
                          <div className="font-semibold">{r.code}</div>
                          <div className="line-clamp-2 text-[11px] text-[var(--muted-foreground)]">{r.name}</div>
                        </td>
                        {g.days.map((d) => {
                          const list = slotsByCell.get(cellKey(r.id, d.date)) ?? [];
                          return (
                            <td
                              key={d.date}
                              onClick={() => list.length && openCell(r.id, d.date)}
                              className={`border-b border-l p-1.5 align-top transition-colors ${d.closed ? "bg-[var(--muted)]/60" : ""} ${list.length ? "cursor-pointer hover:bg-[var(--accent)]/60" : ""} ${d.date === today ? "bg-[var(--accent)]/30" : ""}`}
                              style={{ minWidth: 120 }}
                            >
                              <CellPreview slots={list} meId={g.viewer.userId} />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {rooms.length === 0 ? (
                      <tr>
                        <td colSpan={g.days.length + 1} className="px-4 py-10 text-center text-sm text-[var(--muted-foreground)]">
                          Kỳ lịch chưa có ô trực. {can("duty.manage") ? "Vào Kỳ lịch để sinh ô trực." : ""}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              {/* Mobile: chọn một ngày để tránh danh sách 7 ngày × nhiều phòng quá dài, rối. */}
              <div className="md:hidden">
                <div className="sticky top-0 z-10 border-b bg-[var(--card)] px-2 py-2 shadow-sm">
                  <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
                    {g.days.map((day) => {
                      const selected = day.date === mobileDate;
                      const count = rooms.filter(
                        (room) =>
                          (slotsByCell.get(cellKey(room.id, day.date)) ?? [])
                            .length > 0,
                      ).length;
                      const missing = rooms.reduce(
                        (total, room) => total + (slotsByCell.get(cellKey(room.id, day.date)) ?? [])
                          .reduce((sum, slot) => sum + Math.max(0, slot.requiredCount - slot.filled), 0),
                        0,
                      );
                      return (
                        <button
                          key={day.date}
                          type="button"
                          onClick={() => setMobileDate(day.date)}
                          className={`min-w-[4.15rem] shrink-0 rounded-lg border px-2 py-1.5 text-center transition-colors ${
                            selected
                              ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                              : day.date === today
                                ? "border-[var(--primary)]/40 bg-[var(--accent)]"
                                : "bg-[var(--card)]"
                          }`}
                          aria-pressed={selected}
                        >
                          <span className="block text-[11px] font-semibold">
                            {day.label}
                          </span>
                          <span
                            className={`block text-[10px] ${selected ? "text-[var(--primary-foreground)]/80" : "text-[var(--muted-foreground)]"}`}
                          >
                            {fmtDm(day.date)}
                          </span>
                          <span
                            className={`block text-[9px] ${selected ? "text-[var(--primary-foreground)]/80" : "text-[var(--muted-foreground)]"}`}
                          >
                            {missing ? `${missing} cần xếp` : `${count} phòng`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {(() => {
                  const day =
                    g.days.find((item) => item.date === mobileDate) ??
                    g.days[0];
                  const rowsOfDay = rooms.filter(
                    (room) =>
                      (slotsByCell.get(cellKey(room.id, day.date)) ?? [])
                        .length > 0,
                  );
                  return (
                    <section
                      className={`px-3 py-3 ${day.date === today ? "bg-[var(--accent)]/40" : ""}`}
                    >
                      <header className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-base font-semibold">
                            {day.label}{" "}
                            <span className="font-normal text-[var(--muted-foreground)]">
                              {fmtDate(day.date)}
                            </span>
                          </div>
                          {day.closed ? (
                            <div className="mt-0.5 text-xs text-rose-600">
                              Nghỉ · {day.closedName}
                            </div>
                          ) : (
                            <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                              {rowsOfDay.length} phòng có ca trực
                            </div>
                          )}
                        </div>
                        {day.date === today ? (
                          <span className="shrink-0 rounded-full bg-[var(--primary)] px-2 py-0.5 text-[10px] font-semibold text-[var(--primary-foreground)]">
                            Hôm nay
                          </span>
                        ) : null}
                      </header>
                      {rowsOfDay.length === 0 ? (
                        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-[var(--muted-foreground)]">
                          {day.closed
                            ? "Không có ca trực trong ngày nghỉ."
                            : "Chưa có ca trực trong ngày này."}
                        </p>
                      ) : (
                        <div className="space-y-2.5">
                          {rowsOfDay.map((room) => {
                            const slots =
                              slotsByCell.get(cellKey(room.id, day.date)) ?? [];
                            const missing = slots.reduce((total, slot) => total + Math.max(0, slot.requiredCount - slot.filled), 0);
                            return (
                              <button
                                key={room.id}
                                type="button"
                                onClick={() => openCell(room.id, day.date)}
                                className={`w-full rounded-xl border bg-[var(--card)] p-3 text-left shadow-sm transition active:scale-[0.99] ${
                                  missing ? "border-amber-200 ring-1 ring-amber-100 dark:border-amber-900 dark:ring-amber-950" : ""
                                }`}
                              >
                                <div className="mb-2 flex items-start justify-between gap-2">
                                  <div className="min-w-0 text-sm font-semibold">
                                    {room.code}{" "}
                                    <span className="font-normal text-[var(--muted-foreground)]">
                                      · {room.name}
                                    </span>
                                  </div>
                                  {missing ? (
                                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
                                      <CircleAlert className="h-3 w-3" /> {missing} cần xếp
                                    </span>
                                  ) : (
                                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
                                      <CheckCircle2 className="h-3 w-3" /> Đủ người
                                    </span>
                                  )}
                                </div>
                                <CellPreview
                                  slots={slots}
                                  meId={g.viewer.userId}
                                />
                                <span className="mt-2 block text-right text-[11px] font-medium text-[var(--primary)]">
                                  Chạm để xem và xếp người →
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  );
                })()}
              </div>
            </CardBody>
          </Card>

          {g.viewer.canManage && g.summary.missing > 0 ? (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100 print:hidden">
              <Users className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                Còn <b>{g.summary.missing}</b> vị trí chưa đủ người trực. Dùng nút <b>vị trí cần xếp</b>, chọn ngày rồi chạm vào phòng để phân công ngay.
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
