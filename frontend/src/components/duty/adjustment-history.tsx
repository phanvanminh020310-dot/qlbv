"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Download, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PeriodPicker } from "@/components/duty/period-picker";
import { errorText } from "@/components/duty/duty-shared";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Skeleton } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { downloadFile } from "@/lib/api";
import {
  DUTY_KEYS,
  dutyApi,
  fmtDateTime,
  fmtDm,
  weekdayLabel,
  type AdjustmentHistoryItem,
} from "@/lib/duty";

function dayLabel(ymd: string): string {
  if (!ymd) return "Ca đã xoá";
  return `${weekdayLabel(new Date(`${ymd}T00:00:00Z`).getUTCDay() || 7)} ${fmtDm(ymd)}`;
}

function doctorChange(row: AdjustmentHistoryItem) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="min-w-0 truncate">{row.removedName}</span>
      <ArrowRight className="size-3.5 shrink-0 text-[var(--muted-foreground)]" aria-hidden="true" />
      <span className="min-w-0 truncate font-medium">{row.addedName}</span>
    </span>
  );
}

/** KHTH report view for immutable duty_logs action=OVERRIDE records. */
export function AdjustmentHistory() {
  const [periodId, setPeriodId] = useState(0);
  const [query, setQuery] = useState("");
  const periods = useQuery({ queryKey: DUTY_KEYS.periods, queryFn: () => dutyApi.periods() });
  const history = useQuery({
    queryKey: DUTY_KEYS.adjustments(periodId || undefined),
    queryFn: () => dutyApi.adjustments(periodId ? { periodId } : undefined),
  });
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("vi");
    if (!needle) return history.data ?? [];
    return (history.data ?? []).filter((row) =>
      [
        row.periodName,
        row.dutyDate,
        row.roomCode,
        row.roomName,
        row.shiftCode,
        row.shiftName,
        row.roleName,
        row.removedName,
        row.addedName,
        row.actorName,
        row.reason,
      ].join(" ").toLocaleLowerCase("vi").includes(needle),
    );
  }, [history.data, query]);
  const selectedPeriod = (periods.data ?? []).find((period) => period.id === periodId);

  const exportExcel = async () => {
    try {
      await downloadFile(
        dutyApi.adjustmentExportPath(periodId ? { periodId } : undefined),
        `lich-su-dieu-chinh-bac-si-kham${selectedPeriod ? `-${selectedPeriod.startDate}_${selectedPeriod.endDate}` : ""}.xlsx`,
      );
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Lịch sử điều chỉnh trực tiếp bác sĩ khám</h3>
          <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-[var(--muted-foreground)]">
            Mỗi lần KHTH gỡ hoặc xếp bác sĩ qua chức năng Điều chỉnh trực tiếp được lưu bất biến cùng phòng, ca, người trước/sau, lý do và người thực hiện.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportExcel} disabled={history.isLoading}>
          <Download className="h-4 w-4" /> Xuất Excel
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(15rem,.85fr)_minmax(16rem,1.15fr)]">
        <div className="space-y-1.5">
          <Label>Kỳ lịch khám</Label>
          <div className="flex gap-2">
            <PeriodPicker
              periods={periods.data ?? []}
              value={periodId || null}
              onChange={setPeriodId}
              placeholder="Tất cả kỳ lịch"
              className="min-w-0 flex-1"
            />
            {periodId ? <Button size="sm" variant="ghost" onClick={() => setPeriodId(0)}>Tất cả</Button> : null}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="adjustment-history-search">Tìm trong lịch sử đang xem</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-[var(--muted-foreground)]" />
            <Input
              id="adjustment-history-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Phòng, ca, bác sĩ, người điều chỉnh hoặc lý do…"
              className="pl-8"
            />
          </div>
        </div>
      </div>

      {history.isLoading ? <Skeleton className="h-52 w-full" /> : null}
      {history.isError ? <EmptyState title="Không tải được lịch sử điều chỉnh" description="Vui lòng thử lại hoặc kiểm tra quyền Điều phối lịch khám." /> : null}
      {!history.isLoading && !history.isError && !rows.length ? (
        <EmptyState
          title="Chưa có điều chỉnh trực tiếp"
          description={periodId ? "Kỳ lịch đã chọn chưa có thao tác KHTH gỡ/xếp bác sĩ trực tiếp." : "Các điều chỉnh trực tiếp của KHTH sẽ xuất hiện tại đây."}
        />
      ) : null}

      {rows.length ? (
        <>
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span>{rows.length} lần điều chỉnh{query.trim() ? " phù hợp" : ""}</span>
            <span>{selectedPeriod ? selectedPeriod.name : "Tất cả kỳ lịch"}</span>
          </div>
          <div className="space-y-3 md:hidden">
            {rows.map((row) => (
              <article key={row.id} className="rounded-xl border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold">{dayLabel(row.dutyDate)} · {row.roomCode || "Phòng đã xoá"}</div>
                    <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                      {[row.shiftCode, row.shiftName, row.startTime && row.endTime ? `${row.startTime}–${row.endTime}` : "", row.roleName].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {row.forced ? <Badge tone="warning">Bỏ qua ràng buộc</Badge> : null}
                </div>
                <div className="mt-3 rounded-lg bg-[var(--muted)]/55 px-2.5 py-2 text-sm">{doctorChange(row)}</div>
                <p className="mt-2 text-xs leading-relaxed">Lý do: {row.reason || "—"}</p>
                {row.violations.length ? <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Cảnh báo: {row.violations.join(" · ")}</p> : null}
                <div className="mt-2 text-[11px] text-[var(--muted-foreground)]">{fmtDateTime(row.createdAt)} · {row.actorName} · {row.periodName}</div>
              </article>
            ))}
          </div>
          <div className="hidden overflow-hidden rounded-xl border md:block">
            <TableWrap className="max-h-[min(58vh,39rem)] overflow-y-auto">
              <thead>
                <tr>
                  <Th>Thời điểm</Th>
                  <Th>Ca khám</Th>
                  <Th>Thay đổi bác sĩ</Th>
                  <Th>Người điều chỉnh</Th>
                  <Th>Lý do / cảnh báo</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Tr key={row.id}>
                    <Td className="whitespace-nowrap text-xs">{fmtDateTime(row.createdAt)}<div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">{row.periodName}</div></Td>
                    <Td className="min-w-52">
                      <div className="font-medium">{dayLabel(row.dutyDate)} · {row.roomCode || "Phòng đã xoá"}</div>
                      <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">{[row.shiftCode, row.shiftName, row.startTime && row.endTime ? `${row.startTime}–${row.endTime}` : "", row.roleName].filter(Boolean).join(" · ")}</div>
                    </Td>
                    <Td className="min-w-60 text-xs">{doctorChange(row)}</Td>
                    <Td className="whitespace-nowrap text-xs">{row.actorName}</Td>
                    <Td className="min-w-72 text-xs">
                      <div className="leading-relaxed">{row.reason || "—"}</div>
                      {row.forced ? <Badge tone="warning" className="mt-1">Bỏ qua ràng buộc</Badge> : null}
                      {row.violations.length ? <div className="mt-1 text-amber-700 dark:text-amber-300">{row.violations.join(" · ")}</div> : null}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        </>
      ) : null}
    </div>
  );
}
