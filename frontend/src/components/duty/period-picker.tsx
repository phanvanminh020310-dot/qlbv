"use client";

import { CalendarRange, Check, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/card";
import { fmtDate, periodShortLabel, type DutyPeriod } from "@/lib/duty";

const phaseLabel: Record<DutyPeriod["phase"], string> = {
  NHAP: "Nháp",
  MO: "Đã công bố",
  CHOT: "Đã chốt",
};

const phaseTone: Record<DutyPeriod["phase"], "muted" | "info" | "success"> = {
  NHAP: "muted",
  MO: "info",
  CHOT: "success",
};

/**
 * Chọn kỳ lịch khám có tìm kiếm, lọc năm và danh sách cuộn độc lập.
 * Không dùng native select để vẫn thao tác tốt khi tích luỹ hàng trăm kỳ qua nhiều năm.
 */
export function PeriodPicker({
  periods,
  value,
  onChange,
  disabled = false,
  id,
  label = "Kỳ lịch khám",
  placeholder = "Chọn kỳ lịch khám",
  className = "",
}: {
  periods: DutyPeriod[];
  value: number | null | undefined;
  onChange: (id: number) => void;
  disabled?: boolean;
  id?: string;
  label?: string;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = periods.find((period) => period.id === value) ?? null;
  const years = useMemo(
    () => Array.from(new Set(periods.map((period) => period.startDate.slice(0, 4)))).sort((a, b) => b.localeCompare(a)),
    [periods],
  );
  const [year, setYear] = useState<string>("");

  const openPicker = () => {
    setQuery("");
    setYear(selected?.startDate.slice(0, 4) ?? years[0] ?? "");
    setOpen(true);
  };

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("vi");
    return [...periods]
      .filter((period) => !year || period.startDate.startsWith(`${year}-`))
      .filter((period) => {
        if (!needle) return true;
        return [
          period.name,
          periodShortLabel(period),
          fmtDate(period.startDate),
          fmtDate(period.endDate),
          `tuần ${period.isoWeek ?? ""}`,
        ].join(" ").toLocaleLowerCase("vi").includes(needle);
      })
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  }, [periods, query, year]);

  return (
    <>
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={openPicker}
        className={`flex min-h-9 min-w-0 items-center gap-2 rounded-lg border bg-[var(--card)] px-2.5 py-1.5 text-left shadow-sm transition-colors hover:border-[var(--primary)] hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        aria-haspopup="dialog"
        aria-label={label}
      >
        <CalendarRange className="size-4 shrink-0 text-[var(--primary)]" />
        <span className="min-w-0 flex-1">
          {selected ? (
            <>
              <span className="block truncate text-xs font-semibold">{periodShortLabel(selected)}</span>
              <span className="block truncate text-[10px] text-[var(--muted-foreground)]">{fmtDate(selected.startDate)} – {fmtDate(selected.endDate)}</span>
            </>
          ) : (
            <span className="block truncate text-xs text-[var(--muted-foreground)]">{placeholder}</span>
          )}
        </span>
        <span className="text-xs text-[var(--muted-foreground)]" aria-hidden="true">⌄</span>
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title="Chọn kỳ lịch khám"
        description="Tìm theo tuần, ngày hoặc tên; lọc theo năm để danh sách luôn gọn khi dùng lâu dài."
      >
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="space-y-1">
              <Label htmlFor={`${id ?? "period"}-search`} className="text-xs">Tìm kỳ lịch</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-[var(--muted-foreground)]" />
                <Input
                  id={`${id ?? "period"}-search`}
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Ví dụ: tuần 42, 14/10, khám..."
                  className="pl-8"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Năm</Label>
              <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg border bg-[var(--muted)]/40 p-1">
                <button
                  type="button"
                  onClick={() => setYear("")}
                  className={`shrink-0 rounded-md px-2 py-1.5 text-xs font-medium ${!year ? "bg-[var(--card)] shadow-sm text-[var(--primary)]" : "text-[var(--muted-foreground)] hover:bg-[var(--card)]"}`}
                >
                  Tất cả
                </button>
                {years.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setYear(item)}
                    className={`shrink-0 rounded-md px-2 py-1.5 text-xs font-medium ${year === item ? "bg-[var(--card)] shadow-sm text-[var(--primary)]" : "text-[var(--muted-foreground)] hover:bg-[var(--card)]"}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span>{visible.length} kỳ phù hợp</span>
            {year ? <button type="button" onClick={() => setYear("")} className="font-medium text-[var(--primary)] hover:underline">Xem tất cả năm</button> : null}
          </div>

          <div className="max-h-[min(54vh,31rem)] divide-y overflow-y-auto rounded-xl border">
            {visible.map((period) => {
              const active = period.id === selected?.id;
              return (
                <button
                  key={period.id}
                  type="button"
                  onClick={() => {
                    onChange(period.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 px-3 py-3 text-left transition-colors ${active ? "bg-[var(--accent)]" : "hover:bg-[var(--muted)]/65"}`}
                >
                  <span className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${active ? "border-[var(--primary)] bg-[var(--primary)] text-white" : "border-[var(--border)] text-transparent"}`}>
                    <Check className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{periodShortLabel(period)}</span>
                      <Badge tone={phaseTone[period.phase]}>{phaseLabel[period.phase]}</Badge>
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
                      {fmtDate(period.startDate)} – {fmtDate(period.endDate)}{period.name !== periodShortLabel(period) ? ` · ${period.name}` : ""}
                    </span>
                  </span>
                </button>
              );
            })}
            {!visible.length ? <div className="px-4 py-10 text-center text-sm text-[var(--muted-foreground)]">Không tìm thấy kỳ lịch khám phù hợp.</div> : null}
          </div>
        </div>
      </Dialog>
    </>
  );
}
