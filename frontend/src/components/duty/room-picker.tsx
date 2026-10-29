"use client";

import { Check, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import type { GridRoom } from "@/lib/duty";

const roomLabel = (room: GridRoom) => `${room.code} · ${room.name}${room.location ? ` · ${room.location}` : ""}`;

/**
 * Bộ lọc phòng ngay tại chỗ: gõ là thấy các phòng phù hợp để chọn, thay vì chỉ
 * lọc chữ âm thầm làm người dùng khó biết còn những phòng nào.
 */
export function RoomPicker({
  rooms,
  value,
  onChange,
  className = "",
}: {
  rooms: GridRoom[];
  value: number | null;
  onChange: (roomId: number | null) => void;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = rooms.find((room) => room.id === value) ?? null;

  useEffect(() => {
    setQuery(selected ? roomLabel(selected) : "");
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const closeIfOutside = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeIfOutside);
    return () => document.removeEventListener("pointerdown", closeIfOutside);
  }, []);

  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("vi");
    return rooms.filter((room) => !needle || roomLabel(room).toLocaleLowerCase("vi").includes(needle));
  }, [query, rooms]);

  const choose = (room: GridRoom | null) => {
    onChange(room?.id ?? null);
    setQuery(room ? roomLabel(room) : "");
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 z-10 size-4 text-[var(--muted-foreground)]" />
        <Input
          ref={inputRef}
          aria-label="Tìm và chọn phòng khám"
          aria-autocomplete="list"
          aria-expanded={open}
          role="combobox"
          autoComplete="off"
          value={query}
          onFocus={() => {
            setQuery("");
            setOpen(true);
          }}
          onChange={(event) => {
            onChange(null);
            setQuery(event.target.value);
            setOpen(true);
          }}
          placeholder="Tìm hoặc chọn phòng..."
          className="h-9 w-full pr-8 pl-8 text-xs sm:h-8"
        />
        {query ? (
          <button
            type="button"
            aria-label="Bỏ chọn phòng"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange(null);
              setQuery("");
              setOpen(true);
              inputRef.current?.focus();
            }}
            className="absolute right-1.5 top-1.5 rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] sm:top-1"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      {open ? (
        <div role="listbox" aria-label="Danh sách phòng khám" className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border bg-[var(--card)] p-1 shadow-lg">
          <button
            type="button"
            role="option"
            aria-selected={!value}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(null)}
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors ${!value ? "bg-[var(--accent)] text-[var(--primary)]" : "hover:bg-[var(--muted)]"}`}
          >
            <span className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${!value ? "border-[var(--primary)] bg-[var(--primary)] text-white" : "border-[var(--border)] text-transparent"}`}><Check className="size-3" /></span>
            Tất cả phòng khám <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">{rooms.length}</span>
          </button>
          {matches.map((room) => {
            const active = room.id === value;
            return (
              <button
                key={room.id}
                type="button"
                role="option"
                aria-selected={active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(room)}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors ${active ? "bg-[var(--accent)] text-[var(--primary)]" : "hover:bg-[var(--muted)]"}`}
              >
                <span className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${active ? "border-[var(--primary)] bg-[var(--primary)] text-white" : "border-[var(--border)] text-transparent"}`}><Check className="size-3" /></span>
                <span className="min-w-0 flex-1 truncate"><b className="font-semibold">{room.code}</b> · {room.name}</span>
                {room.location ? <span className="max-w-20 truncate text-[10px] text-[var(--muted-foreground)]">{room.location}</span> : null}
              </button>
            );
          })}
          {!matches.length ? <p className="px-3 py-5 text-center text-xs text-[var(--muted-foreground)]">Không tìm thấy phòng phù hợp.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
