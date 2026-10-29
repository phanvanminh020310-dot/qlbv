"use client";

import { CalendarDays, CheckCircle2, CircleAlert, MapPin, MousePointerClick, Stethoscope, UserPlus } from "lucide-react";
import { ShiftChip } from "@/components/duty/duty-shared";
import { Badge, EmptyState } from "@/components/ui/card";
import { fmtDate, fmtDm, type GridResponse, type GridRoom, type GridSlot } from "@/lib/duty";

type CellKey = string;
const cellKey = (roomId: number, date: string) => `${roomId}|${date}`;
const missingOf = (slots: GridSlot[]) => slots.reduce((total, slot) => total + Math.max(0, slot.requiredCount - slot.filled), 0);

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
  const content = (
    <>
      <div className="flex min-w-0 items-start gap-2">
        <ShiftChip code={slot.shiftCode} color={slot.shiftColor} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="text-xs font-semibold">{slot.shiftName}</span>
            <span className="text-[11px] text-[var(--muted-foreground)]">{slot.startTime}–{slot.endTime}</span>
          </span>
          <span className="mt-0.5 block text-[11px] text-[var(--muted-foreground)]">{slot.roleName}</span>
        </span>
        <Badge tone={missing ? "warning" : "success"} className="shrink-0 text-[10px]">{slot.filled}/{slot.requiredCount}</Badge>
      </div>
      <div className={`mt-2 line-clamp-2 min-h-8 text-xs leading-snug ${names ? "text-[var(--foreground)]" : "font-medium text-amber-700 dark:text-amber-300"}`}>
        {names || "Chưa xếp bác sĩ"}
      </div>
      {canAssign ? (
        <span className="mt-2 flex items-center justify-end gap-1 text-[11px] font-semibold text-[var(--primary)] opacity-75 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <UserPlus className="size-3.5" /> Nhấn để xếp bác sĩ
        </span>
      ) : null}
    </>
  );

  if (!canAssign) {
    return <div className={`rounded-lg border p-2.5 ${mine ? "border-[var(--primary)]/35 bg-[var(--accent)]/45" : "bg-[var(--muted)]/25"}`}>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(slot)}
      title={`Xếp bác sĩ: ${slot.shiftName} · ${slot.startTime}–${slot.endTime} · ${slot.roleName}`}
      aria-label={`Xếp bác sĩ cho ${slot.shiftName}, ${slot.roomName}, ${fmtDate(slot.dutyDate)}`}
      className={`group w-full rounded-lg border p-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
        mine
          ? "border-[var(--primary)]/50 bg-[var(--accent)]/65"
          : missing
            ? "border-amber-200 bg-amber-50/55 hover:border-amber-400 hover:bg-amber-100/70 dark:border-amber-900 dark:bg-amber-950/25 dark:hover:bg-amber-950/45"
            : "bg-[var(--card)] hover:border-[var(--primary)]/55 hover:bg-[var(--accent)]/45"
      } hover:-translate-y-px hover:shadow-sm active:translate-y-0`}
    >
      {content}
    </button>
  );
}

/**
 * Lịch ngày theo phòng: các ca sáng/chiều tách thành từng ô thao tác độc lập.
 * Người xếp chỉ cần bấm đúng ca để mở ngay danh sách bác sĩ, không đi qua hộp
 * quản lý nhân sự trung gian.
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
    const list = slotsByCell.get(key) ?? [];
    list.push(slot);
    slotsByCell.set(key, list);
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
    <div className="space-y-4">
      <div className="rounded-xl border bg-[var(--muted)]/20 p-2.5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
            <CalendarDays className="size-4 text-[var(--primary)]" />
            <span>Chọn ngày để xem toàn bộ phòng và ca khám</span>
          </div>
          {dayMissing ? <Badge tone="warning"><CircleAlert className="size-3.5" /> {dayMissing} vị trí cần xếp</Badge> : <Badge tone="success"><CheckCircle2 className="size-3.5" /> Đã đủ bác sĩ</Badge>}
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
          {grid.days.map((item) => {
            const active = item.date === day.date;
            const slots = rooms.flatMap((room) => slotsByCell.get(cellKey(room.id, item.date)) ?? []);
            const missing = missingOf(slots);
            return (
              <button
                key={item.date}
                type="button"
                onClick={() => onSelectDate(item.date)}
                className={`rounded-lg border px-2 py-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
                  active
                    ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)] shadow-sm"
                    : item.date === new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
                      ? "border-[var(--primary)]/45 bg-[var(--accent)] hover:border-[var(--primary)]"
                      : "bg-[var(--card)] hover:border-[var(--primary)]/50 hover:bg-[var(--accent)]"
                }`}
                aria-pressed={active}
              >
                <span className="block text-xs font-semibold">{item.label}</span>
                <span className={`block text-[11px] ${active ? "text-[var(--primary-foreground)]/80" : "text-[var(--muted-foreground)]"}`}>{fmtDm(item.date)}</span>
                <span className={`mt-1 block text-[10px] ${active ? "text-[var(--primary-foreground)]/85" : missing ? "font-semibold text-amber-700 dark:text-amber-300" : "text-[var(--muted-foreground)]"}`}>
                  {item.closed ? "Nghỉ" : missing ? `${missing} cần xếp` : `${slots.length} ca khám`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <section className={`${day.date === new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10) ? "rounded-xl bg-[var(--accent)]/25 p-3 sm:p-4" : ""}`}>
        <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold"><Stethoscope className="size-4 text-[var(--primary)]" /> {day.label} · {fmtDate(day.date)}</h3>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              {day.closed ? `Nghỉ: ${day.closedName}` : `${roomRows.length} phòng có lịch khám · bấm trực tiếp vào ca sáng/chiều để xếp bác sĩ`}
            </p>
          </div>
          {canAssign ? <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--primary)]/20 bg-[var(--card)] px-2.5 py-1 text-[11px] font-medium text-[var(--primary)] shadow-sm"><MousePointerClick className="size-3.5" /> Bấm ca để xếp ngay</span> : null}
        </header>

        {day.closed ? (
          <EmptyState title="Ngày nghỉ" description={day.closedName || "Không có lịch khám trong ngày này."} />
        ) : roomRows.length === 0 ? (
          <EmptyState title="Chưa có lịch khám" description="Không có ca khám phù hợp với phòng hoặc bộ lọc hiện tại." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {roomRows.map(({ room, slots }) => {
              const missing = missingOf(slots);
              return (
                <article key={room.id} className={`group overflow-hidden rounded-xl border bg-[var(--card)] shadow-sm transition-all hover:-translate-y-0.5 hover:border-[var(--primary)]/45 hover:shadow-md ${missing ? "border-amber-200 dark:border-amber-900" : ""}`}>
                  <div className="flex items-start justify-between gap-2 border-b bg-[var(--muted)]/35 px-3.5 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[var(--primary)] text-[11px] font-bold text-white">{room.code}</span>
                        <span className="truncate text-sm font-semibold">{room.name}</span>
                      </div>
                      {room.location ? <div className="mt-1 flex items-center gap-1 truncate pl-9 text-[11px] text-[var(--muted-foreground)]"><MapPin className="size-3 shrink-0" /> {room.location}</div> : null}
                    </div>
                    {missing ? <Badge tone="warning" className="shrink-0">{missing} cần xếp</Badge> : <Badge tone="success" className="shrink-0">Đủ lịch</Badge>}
                  </div>
                  <div className="space-y-2 p-3">
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
