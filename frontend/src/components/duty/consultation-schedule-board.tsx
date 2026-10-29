"use client";

import { CalendarDays, CheckCircle2, CircleAlert, MousePointerClick, Stethoscope, UserPlus } from "lucide-react";
import { ShiftChip } from "@/components/duty/duty-shared";
import { Badge, EmptyState } from "@/components/ui/card";
import { fmtDate, fmtDm, type GridResponse, type GridRoom, type GridSlot } from "@/lib/duty";

type CellKey = string;
const cellKey = (roomId: number, date: string) => `${roomId}|${date}`;
const missingOf = (slots: GridSlot[]) => slots.reduce((total, slot) => total + Math.max(0, slot.requiredCount - slot.filled), 0);

/** Một hàng ca gọn, ưu tiên đọc nhanh tên bác sĩ trên điện thoại. */
function SlotTile({
  slot,
  currentUserId,
  canAssign,
  onSelect,
}: {
  slot: GridSlot;
  currentUserId: number;
  canAssign: boolean;
  onSelect: (slot: GridSlot) => void;
}) {
  const mine = slot.assignments.some((assignment) => assignment.userId === currentUserId);
  const missing = Math.max(0, slot.requiredCount - slot.filled);
  const names = slot.assignments.map((assignment) => assignment.fullName).join(", ");
  const body = (
    <>
      <ShiftChip code={slot.shiftCode} color={slot.shiftColor} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-semibold">{slot.shiftName}</span>
          <span className="shrink-0 text-[10px] text-[var(--muted-foreground)]">{slot.startTime}–{slot.endTime}</span>
        </span>
        <span title={names} className={`mt-0.5 block truncate text-[11px] ${names ? "text-[var(--muted-foreground)]" : "font-medium text-amber-700 dark:text-amber-300"}`}>
          {names || "Chưa xếp bác sĩ"}
        </span>
      </span>
      <Badge tone={missing ? "warning" : "success"} className="shrink-0 text-[10px]">{slot.filled}/{slot.requiredCount}</Badge>
      {canAssign ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-transparent px-1.5 py-1 text-[10px] font-semibold text-[var(--primary)] transition-colors group-hover:border-[var(--primary)]/25 group-hover:bg-[var(--accent)] group-focus-visible:border-[var(--primary)]/25 group-focus-visible:bg-[var(--accent)]">
          <UserPlus className="size-3.5" /> Xếp
        </span>
      ) : null}
    </>
  );

  const classes = `group flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
    mine
      ? "border-[var(--primary)]/45 bg-[var(--accent)]/60"
      : missing
        ? "border-amber-200 bg-amber-50/55 hover:border-amber-400 hover:bg-amber-100/70 dark:border-amber-900 dark:bg-amber-950/25 dark:hover:bg-amber-950/45"
        : "bg-[var(--card)] hover:border-[var(--primary)]/55 hover:bg-[var(--accent)]/45"
  }`;

  if (!canAssign) return <div className={classes}>{body}</div>;

  return (
    <button
      type="button"
      onClick={() => onSelect(slot)}
      title={`Xếp bác sĩ: ${slot.shiftName} · ${slot.startTime}–${slot.endTime} · ${slot.roleName}`}
      aria-label={`Xếp bác sĩ cho ${slot.shiftName}, ${slot.roomName}, ${fmtDate(slot.dutyDate)}`}
      className={classes}
    >
      {body}
    </button>
  );
}

/**
 * Lịch một ngày theo phòng. Trên điện thoại, thanh ngày cuộn ngang như giao
 * diện cũ nhưng từng ca vẫn bấm được ngay để xếp bác sĩ.
 */
export function ConsultationScheduleBoard({
  grid,
  rooms,
  selectedDate,
  onSelectDate,
  onSelectSlot,
  onInspectRoom,
}: {
  grid: GridResponse;
  rooms: GridRoom[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  onSelectSlot: (slot: GridSlot) => void;
  onInspectRoom: (room: GridRoom, date: string) => void;
}) {
  const slotsByCell = new Map<CellKey, GridSlot[]>();
  for (const slot of grid.slots) {
    const key = cellKey(slot.roomId, slot.dutyDate);
    const slots = slotsByCell.get(key) ?? [];
    slots.push(slot);
    slotsByCell.set(key, slots);
  }
  for (const slots of slotsByCell.values()) slots.sort((a, b) => a.start - b.start || a.roleName.localeCompare(b.roleName, "vi"));

  const day = grid.days.find((item) => item.date === selectedDate) ?? grid.days[0];
  if (!day) return null;
  const roomRows = rooms
    .map((room) => ({ room, slots: slotsByCell.get(cellKey(room.id, day.date)) ?? [] }))
    .filter((row) => row.slots.length > 0);
  const dayMissing = roomRows.reduce((total, row) => total + missingOf(row.slots), 0);
  const canAssign = grid.viewer.canManage && !grid.period.locked;

  return (
    <div className="space-y-3">
      <section className="rounded-xl border bg-[var(--muted)]/20 p-2.5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
            <CalendarDays className="size-4 shrink-0 text-[var(--primary)]" />
            <span>Chọn ngày xem lịch phòng khám</span>
          </div>
          {dayMissing ? <Badge tone="warning"><CircleAlert className="size-3.5" /> {dayMissing} cần xếp</Badge> : <Badge tone="success"><CheckCircle2 className="size-3.5" /> Đã đủ bác sĩ</Badge>}
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] sm:grid sm:grid-cols-4 sm:overflow-visible lg:grid-cols-7">
          {grid.days.map((item) => {
            const active = item.date === day.date;
            const slots = rooms.flatMap((room) => slotsByCell.get(cellKey(room.id, item.date)) ?? []);
            const missing = missingOf(slots);
            return (
              <button
                key={item.date}
                type="button"
                onClick={() => onSelectDate(item.date)}
                className={`min-w-[4.65rem] shrink-0 rounded-lg border px-2 py-1.5 text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] sm:min-w-0 sm:text-left ${
                  active
                    ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)] shadow-sm"
                    : item.date === new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
                      ? "border-[var(--primary)]/45 bg-[var(--accent)] hover:border-[var(--primary)]"
                      : "bg-[var(--card)] hover:border-[var(--primary)]/50 hover:bg-[var(--accent)]"
                }`}
                aria-pressed={active}
              >
                <span className="block text-[11px] font-semibold sm:text-xs">{item.label}</span>
                <span className={`block text-[10px] sm:text-[11px] ${active ? "text-[var(--primary-foreground)]/80" : "text-[var(--muted-foreground)]"}`}>{fmtDm(item.date)}</span>
                <span className={`mt-0.5 block text-[9px] sm:text-[10px] ${active ? "text-[var(--primary-foreground)]/85" : missing ? "font-semibold text-amber-700 dark:text-amber-300" : "text-[var(--muted-foreground)]"}`}>
                  {item.closed ? "Nghỉ" : missing ? `${missing} cần xếp` : `${slots.length} ca`}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className={day.date === new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10) ? "rounded-xl border border-[var(--primary)]/15 bg-[var(--accent)]/20 p-2.5 sm:p-3" : "px-0.5"}>
        <header className="mb-2.5 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold sm:text-base"><Stethoscope className="size-4 text-[var(--primary)]" /> {day.label} · {fmtDate(day.date)}</h3>
            <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
              {day.closed ? `Nghỉ: ${day.closedName}` : `${roomRows.length} phòng đang hiển thị · bấm thẳng ca để xếp bác sĩ`}
            </p>
          </div>
          {canAssign ? <span className="inline-flex items-center gap-1 rounded-full border border-[var(--primary)]/20 bg-[var(--card)] px-2 py-1 text-[10px] font-medium text-[var(--primary)]"><MousePointerClick className="size-3.5" /> Bấm ca để xếp</span> : null}
        </header>

        {day.closed ? (
          <EmptyState title="Ngày nghỉ" description={day.closedName || "Không có lịch khám trong ngày này."} />
        ) : roomRows.length === 0 ? (
          <EmptyState title="Chưa có lịch khám" description="Không có ca khám phù hợp với phòng đã chọn hoặc bộ lọc vị trí thiếu." />
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 2xl:grid-cols-3">
            {roomRows.map(({ room, slots }) => {
              const missing = missingOf(slots);
              return (
                <article key={room.id} className={`overflow-hidden rounded-xl border bg-[var(--card)] shadow-sm transition-colors hover:border-[var(--primary)]/45 ${missing ? "border-amber-200 dark:border-amber-900" : ""}`}>
                  <div className="flex items-center justify-between gap-2 border-b bg-[var(--muted)]/35 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[var(--primary)] text-[10px] font-bold text-white">{room.code}</span>
                      <span className="truncate text-sm font-semibold">{room.name}</span>
                      {room.location ? <span className="hidden truncate text-[10px] text-[var(--muted-foreground)] sm:inline">· {room.location}</span> : null}
                    </div>
                    {missing ? <Badge tone="warning" className="shrink-0 text-[10px]">{missing} thiếu</Badge> : <Badge tone="success" className="shrink-0 text-[10px]">Đủ</Badge>}
                  </div>
                  <div className="space-y-1.5 p-2">
                    {slots.map((slot) => <SlotTile key={slot.id} slot={slot} currentUserId={grid.viewer.userId} canAssign={canAssign} onSelect={onSelectSlot} />)}
                  </div>
                  {!canAssign ? (
                    <button type="button" onClick={() => onInspectRoom(room, day.date)} className="flex w-full items-center justify-center border-t px-3 py-2 text-xs font-medium text-[var(--primary)] hover:bg-[var(--accent)]">
                      Xem chi tiết ca khám
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
