"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  Filter,
  Lock,
  Pencil,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  Unlock,
  Wand2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ClonePeriodDialog, QuickCreateNextPeriodDialog, useRefreshDuty } from "@/components/duty/duty-dialogs";
import { DeletePeriodDialog } from "@/components/duty/delete-period-dialog";
import { CurrentWeekBadge, errorText, KpiTile, PhaseBadge, ShiftChip } from "@/components/duty/duty-shared";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, Badge, Skeleton } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Switch, Textarea } from "@/components/ui/input";
import { TableWrap, Td, Th, Tr } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { downloadFile } from "@/lib/api";
import {
  ACTION_LABEL,
  addDaysYmd,
  bkkLocalToIso,
  bkkTodayYmd,
  defaultLockAtLocal,
  DUTY_KEYS,
  dutyApi,
  fmtDate,
  fmtDateTime,
  fmtDm,
  hoursText,
  isoToBkkLocal,
  isoWeekNumber,
  isoWeekRange,
  nextMondayYmd,
  smartPeriodTitle,
  weekdayLabel,
  type DutyPeriod,
  type DutyRules,
  type GridSlot,
} from "@/lib/duty";

const DEFAULT_RULES: DutyRules = {
  maxShiftsPerDay: 0,
  maxShiftsPerPeriod: 0,
  maxNightShiftsPerPeriod: 0,
  maxHoursPerDay: 0,
  maxHoursPerWeek: 0,
  minRestHours: 0,
  crossDeptPolicy: "CANH_BAO",
  allowSelfRegister: true,
  swapNeedsApproval: true,
  requireFullBeforePublish: true,
};

/* ================================================================== Tạo / sửa kỳ lịch */

/** Mount lại mỗi lần mở (parent đặt key) nên state khởi tạo đúng từ props */
function PeriodDialog({ onClose, period }: { onClose: () => void; period: DutyPeriod | null }) {
  const refresh = useRefreshDuty();
  const isEdit = !!period;
  const today = bkkTodayYmd();
  const initialYear = Number(today.slice(0, 4));

  const [createMode, setCreateMode] = useState<"week" | "custom">("week");
  const [selectedYear, setSelectedYear] = useState<number>(initialYear);
  const [selectedWeek, setSelectedWeek] = useState<number>(() => {
    const nextMon = nextMondayYmd();
    return isoWeekNumber(nextMon).week;
  });

  const nextMon = nextMondayYmd();
  const defaultRange = useMemo(
    () => ({
      startDate: nextMon,
      endDate: addDaysYmd(nextMon, 6),
    }),
    [nextMon],
  );

  const [name, setName] = useState(period?.name ?? smartPeriodTitle(defaultRange.startDate, defaultRange.endDate));
  const [startDate, setStartDate] = useState(period?.startDate ?? defaultRange.startDate);
  const [endDate, setEndDate] = useState(period?.endDate ?? defaultRange.endDate);
  const [lockAt, setLockAt] = useState(period ? isoToBkkLocal(period.lockAt) : defaultLockAtLocal(defaultRange.startDate));
  const [opensAt, setOpensAt] = useState(isoToBkkLocal(period?.registrationOpensAt));
  const [note, setNote] = useState(period?.note ?? "");
  const [rules, setRules] = useState<DutyRules>(period?.rules ?? DEFAULT_RULES);

  const [autoGenSlots, setAutoGenSlots] = useState(false);
  const [copyPeriodId, setCopyPeriodId] = useState<string>("");
  const [copyAssigns, setCopyAssigns] = useState(true);

  const existingPeriods = useQuery({ queryKey: DUTY_KEYS.periods, queryFn: () => dutyApi.periods(), enabled: !isEdit });

  const weeksOfYear = useMemo(() => {
    const list: Array<{ week: number; startDate: string; endDate: string; label: string }> = [];
    for (let w = 1; w <= 52; w++) {
      const range = isoWeekRange(selectedYear, w);
      const [, m] = range.startDate.split("-").map(Number);
      list.push({
        week: w,
        startDate: range.startDate,
        endDate: range.endDate,
        label: `Tuần ${w} (${fmtDm(range.startDate)} – ${fmtDm(range.endDate)}) · Tháng ${String(m).padStart(2, "0")}`,
      });
    }
    return list;
  }, [selectedYear]);

  const onSelectWeek = (w: number) => {
    setSelectedWeek(w);
    const range = isoWeekRange(selectedYear, w);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
    setName(smartPeriodTitle(range.startDate, range.endDate));
    setLockAt(defaultLockAtLocal(range.startDate));
  };

  const onSelectYear = (y: number) => {
    setSelectedYear(y);
    const range = isoWeekRange(y, selectedWeek);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
    setName(smartPeriodTitle(range.startDate, range.endDate));
    setLockAt(defaultLockAtLocal(range.startDate));
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        startDate,
        endDate,
        lockAt: bkkLocalToIso(lockAt),
        registrationOpensAt: opensAt ? bkkLocalToIso(opensAt) : null,
        note,
        rules,
        autoGenerateSlots: !isEdit && autoGenSlots && !copyPeriodId,
        copyFromPeriodId: !isEdit && copyPeriodId ? Number(copyPeriodId) : undefined,
        copyAssignments: !isEdit && !!copyPeriodId && copyAssigns,
      };
      return period ? dutyApi.updatePeriod(period.id, body) : dutyApi.createPeriod(body);
    },
    onSuccess: (res) => {
      toast.success(isEdit ? "Đã lưu kỳ lịch" : `Đã tạo kỳ lịch "${res?.name || name}" thành công!`);
      refresh();
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const set = <K extends keyof DutyRules>(k: K, v: DutyRules[K]) => setRules((r) => ({ ...r, [k]: v }));
  const num = (v: string) => (v === "" ? 0 : Number(v));
  const locked = !!period?.locked;

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={isEdit ? "Sửa cấu hình kỳ lịch" : "Tạo kỳ lịch trực mới"}
      description="Quản lý thời gian, mốc chốt và thiết lập tự động hóa phân công trực tuần."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button
            onClick={() => {
              if (!name.trim()) return toast.error("Nhập tên kỳ lịch");
              if (startDate > endDate) return toast.error("Ngày bắt đầu phải trước ngày kết thúc");
              save.mutate();
            }}
            disabled={save.isPending}
          >
            {isEdit ? "Lưu thay đổi" : "Tạo kỳ lịch"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {locked ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            Kỳ lịch đã chốt: chỉ sửa được tên và ghi chú. Muốn đổi thời gian hay ràng buộc, hãy mở chốt trước.
          </div>
        ) : null}

        {/* Chế độ tạo (chỉ khi tạo mới) */}
        {!isEdit ? (
          <div className="grid grid-cols-1 gap-1 rounded-xl border bg-[var(--muted)]/50 p-1 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setCreateMode("week")}
              className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all ${
                createMode === "week"
                  ? "bg-white shadow text-teal-700 dark:bg-slate-800 dark:text-teal-300"
                  : "text-[var(--muted-foreground)] hover:text-foreground"
              }`}
            >
              📅 Chọn theo Tuần trong Năm (ISO Week)
            </button>
            <button
              type="button"
              onClick={() => setCreateMode("custom")}
              className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all ${
                createMode === "custom"
                  ? "bg-white shadow text-teal-700 dark:bg-slate-800 dark:text-teal-300"
                  : "text-[var(--muted-foreground)] hover:text-foreground"
              }`}
            >
              🛠️ Tùy chỉnh khoảng ngày
            </button>
          </div>
        ) : null}

        {!isEdit && createMode === "week" ? (
          <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-3.5 space-y-3 dark:border-teal-900 dark:bg-teal-950/20">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="w-year" className="text-xs">Năm</Label>
                <Select id="w-year" value={String(selectedYear)} onChange={(e) => onSelectYear(Number(e.target.value))}>
                  {[initialYear - 1, initialYear, initialYear + 1].map((y) => (
                    <option key={y} value={y}>Năm {y}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="w-week" className="text-xs">Chọn tuần trong năm</Label>
                <Select id="w-week" value={String(selectedWeek)} onChange={(e) => onSelectWeek(Number(e.target.value))}>
                  {weeksOfYear.map((w) => (
                    <option key={w.week} value={w.week}>{w.label}</option>
                  ))}
                </Select>
              </div>
            </div>
            <p className="text-[11px] text-teal-800 dark:text-teal-300">
              ✓ Đã tự động tính Thứ 2 ({fmtDate(startDate)}) đến Chủ Nhật ({fmtDate(endDate)}) và mốc chốt 17h Thứ Sáu tuần trước.
            </p>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="p-name">Tên kỳ lịch *</Label>
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ví dụ: Tuần 42 (12/10 – 18/10/2026) - Tháng 10" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-start">Từ ngày (Thứ 2)</Label>
            <Input id="p-start" type="date" value={startDate} disabled={locked || (isEdit && period?.status !== "NHAP")} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-end">Đến ngày (Chủ Nhật)</Label>
            <Input id="p-end" type="date" value={endDate} disabled={locked || (isEdit && period?.status !== "NHAP")} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-lock">Mốc chốt lịch *</Label>
            <Input id="p-lock" type="datetime-local" value={lockAt} disabled={locked} onChange={(e) => setLockAt(e.target.value)} />
            <p className="text-[11px] text-[var(--muted-foreground)]">Sau mốc này lịch tự khoá. Thay đổi cần qua yêu cầu ngoại lệ.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-open">Mở đăng ký tự nguyện</Label>
            <Input id="p-open" type="datetime-local" value={opensAt} disabled={locked} onChange={(e) => setOpensAt(e.target.value)} />
            <p className="text-[11px] text-[var(--muted-foreground)]">Để trống: nhân viên đăng ký ngay sau khi công bố.</p>
          </div>
        </div>

        {/* Khối tự động hóa sinh ô trực khi tạo mới */}
        {!isEdit ? (
          <div className="rounded-xl border p-3.5 space-y-3 bg-[var(--card)]">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Tự động hóa ô trực & phân công
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <div>
                  <div className="font-medium">Sao chép cấu trúc từ kỳ trước</div>
                  <div className="text-xs text-[var(--muted-foreground)]">Lấy các ô trực từ một kỳ đã có sang kỳ này</div>
                </div>
                <Select
                  className="w-48 text-xs"
                  value={copyPeriodId}
                  onChange={(e) => {
                    setCopyPeriodId(e.target.value);
                    if (e.target.value) setAutoGenSlots(false);
                  }}
                >
                  <option value="">— Không sao chép —</option>
                  {(existingPeriods.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </div>

              {copyPeriodId ? (
                <div className="pl-3 pt-1 border-l-2 border-teal-500">
                  <ToggleRow
                    label="Sao chép cả danh sách người trực từ kỳ đó"
                    checked={copyAssigns}
                    onChange={setCopyAssigns}
                  />
                </div>
              ) : null}

              {!copyPeriodId ? (
                <ToggleRow
                  label="Tự động sinh toàn bộ ô trực từ danh mục (mọi phòng và ca active)"
                  checked={autoGenSlots}
                  onChange={setAutoGenSlots}
                />
              ) : null}
            </div>
          </div>
        ) : null}

        <div>
          <h4 className="mb-2 text-sm font-semibold">Ràng buộc xếp trực</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <NumField label="Ca tối đa / ngày" value={rules.maxShiftsPerDay} onChange={(v) => set("maxShiftsPerDay", num(v))} hint="Mặc định 0 = không giới hạn" />
            <NumField label="Giờ trực tối đa / ngày" value={rules.maxHoursPerDay} onChange={(v) => set("maxHoursPerDay", num(v))} hint="Mặc định 0 = không giới hạn" />
            <NumField label="Giờ trực tối đa / tuần" value={rules.maxHoursPerWeek} onChange={(v) => set("maxHoursPerWeek", num(v))} hint="Mặc định 0 = không giới hạn" />
            <NumField label="Nghỉ tối thiểu giữa hai ca (giờ)" value={rules.minRestHours} onChange={(v) => set("minRestHours", num(v))} hint="Mặc định 0; ca đêm liền kề vẫn bị chặn" />
            <NumField label="Ca tối đa / kỳ" value={rules.maxShiftsPerPeriod} onChange={(v) => set("maxShiftsPerPeriod", num(v))} hint="Mặc định 0 = không giới hạn" />
            <NumField label="Ca đêm tối đa / kỳ" value={rules.maxNightShiftsPerPeriod} onChange={(v) => set("maxNightShiftsPerPeriod", num(v))} hint="Mặc định 0 = không giới hạn" />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="p-dept">Nhân viên khác khoa với phòng</Label>
              <Select id="p-dept" value={rules.crossDeptPolicy} onChange={(e) => set("crossDeptPolicy", e.target.value as DutyRules["crossDeptPolicy"])}>
                <option value="CANH_BAO">Cảnh báo (vẫn cho xếp)</option>
                <option value="CHAN">Chặn xếp</option>
                <option value="CHO_PHEP">Cho phép, không cảnh báo</option>
              </Select>
            </div>
            <div className="space-y-2 pt-1">
              <ToggleRow label="Cho phép nhân viên tự đăng ký ca trống" checked={rules.allowSelfRegister} onChange={(v) => set("allowSelfRegister", v)} />
              <ToggleRow label="Đổi/nhường ca cần Trưởng khoa duyệt" checked={rules.swapNeedsApproval} onChange={(v) => set("swapNeedsApproval", v)} />
              <ToggleRow label="Chặn công bố khi còn ô thiếu người" checked={rules.requireFullBeforePublish} onChange={(v) => set("requireFullBeforePublish", v)} />
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="p-note">Ghi chú</Label>
          <Textarea id="p-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
    </Dialog>
  );
}

function NumField({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: string) => void; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type="number" min={0} step="0.5" value={value} onChange={(e) => onChange(e.target.value)} />
      {hint ? <p className="text-[11px] text-[var(--muted-foreground)]">{hint}</p> : null}
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/* ================================================================== Sinh ô hàng loạt */

function GenerateDialog({ open, onClose, periodId }: { open: boolean; onClose: () => void; periodId: number }) {
  const refresh = useRefreshDuty();
  const [roomIds, setRoomIds] = useState<number[]>([]);
  const [shiftIds, setShiftIds] = useState<number[]>([]);
  const [roleIds, setRoleIds] = useState<number[]>([]);
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [required, setRequired] = useState(1);
  const [skipClosed, setSkipClosed] = useState(true);
  const catalog = useCatalogOptions(open);
  const toggle = (arr: number[], v: number, set: (a: number[]) => void) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const gen = useMutation({
    mutationFn: () => dutyApi.generate(periodId, { roomIds, shiftIds, roleIds, weekdays, requiredCount: required, skipClosedDays: skipClosed }),
    onSuccess: (r) => {
      toast.success(`Đã tạo ${r.created} ô trực${r.skipped ? ` (bỏ qua ${r.skipped} ô đã có hoặc nghỉ)` : ""}`);
      refresh();
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const total = weekdays.length * roomIds.length * shiftIds.length * roleIds.length;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Sinh ô trực hàng loạt"
      description="Hệ thống tạo ô cho mọi ngày × phòng × ca × vai trò đã chọn. Ngày nghỉ lễ sẽ được bỏ qua."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button disabled={!total || gen.isPending} onClick={() => gen.mutate()}>
            <Wand2 className="h-4 w-4" /> Tạo {total ? `${total} ô` : "ô trực"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <CheckGroup label="Phòng khám" items={catalog.rooms} selected={roomIds} onToggle={(v) => toggle(roomIds, v, setRoomIds)} />
        <CheckGroup label="Ca trực" items={catalog.shifts} selected={shiftIds} onToggle={(v) => toggle(shiftIds, v, setShiftIds)} />
        <CheckGroup label="Vai trò trực" items={catalog.roles} selected={roleIds} onToggle={(v) => toggle(roleIds, v, setRoleIds)} />
        <div>
          <Label className="mb-1.5 block text-xs">Các ngày trong tuần</Label>
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggle(weekdays, d, setWeekdays)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${weekdays.includes(d) ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]" : "bg-[var(--card)] hover:bg-[var(--accent)]"}`}
              >
                {weekdayLabel(d)}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <NumField label="Chỉ tiêu người trực mỗi ô" value={required} onChange={(v) => setRequired(Math.max(1, Number(v) || 1))} hint="Không giới hạn số người mà người xếp lịch có thể phân công" />
          <div className="flex items-end gap-2 pb-2">
            <Switch checked={skipClosed} onCheckedChange={setSkipClosed} />
            <span className="text-sm">Bỏ qua ngày nghỉ lễ</span>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function CheckGroup({
  label,
  items,
  selected,
  onToggle,
}: {
  label: string;
  items: { value: number; label: string }[];
  selected: number[];
  onToggle: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <button type="button" className="text-xs text-[var(--primary)] hover:underline" onClick={() => items.forEach((i) => !selected.includes(i.value) && onToggle(i.value))}>
          Chọn tất cả
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.length === 0 ? <span className="text-xs text-[var(--muted-foreground)]">Chưa có dữ liệu trong danh mục</span> : null}
        {items.map((i) => (
          <button
            key={i.value}
            type="button"
            onClick={() => onToggle(i.value)}
            className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${selected.includes(i.value) ? "border-[var(--primary)] bg-[var(--accent)] font-semibold" : "bg-[var(--card)] hover:bg-[var(--accent)]"}`}
          >
            {i.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Danh mục đang dùng (chỉ mục đang bật) cho các hộp thoại */
function useCatalogOptions(enabled: boolean) {
  const rooms = useQuery({ queryKey: ["duty-room-options"], queryFn: () => dutyApi.roomOptions(), enabled, staleTime: 60_000 });
  const shifts = useQuery({ queryKey: ["duty-shift-options"], queryFn: () => dutyApi.shiftOptions(), enabled, staleTime: 60_000 });
  const roles = useQuery({ queryKey: ["duty-role-options"], queryFn: () => dutyApi.roleOptions(), enabled, staleTime: 60_000 });
  return {
    rooms: (rooms.data ?? []).filter((r) => r.active).map((r) => ({ value: r.value, label: r.label })),
    shifts: (shifts.data ?? []).filter((s) => s.active).map((s) => ({ value: s.value, label: `${s.code} · ${s.startTime}–${s.endTime}` })),
    roles: (roles.data ?? []).filter((r) => r.active).map((r) => ({ value: r.value, label: r.label })),
  };
}

/* ================================================================== Thêm một ô lẻ */

function SlotDialog({ open, onClose, period }: { open: boolean; onClose: () => void; period: DutyPeriod }) {
  const refresh = useRefreshDuty();
  const catalog = useCatalogOptions(open);
  const [date, setDate] = useState(period.startDate);
  const [roomId, setRoomId] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [required, setRequired] = useState("1");
  const create = useMutation({
    mutationFn: () =>
      dutyApi.createSlot(period.id, { dutyDate: date, roomId: Number(roomId), shiftId: Number(shiftId), roleId: Number(roleId), requiredCount: Number(required) || 1 }),
    onSuccess: () => {
      toast.success("Đã thêm ô trực");
      refresh();
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Thêm ô trực"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button disabled={!roomId || !shiftId || !roleId || create.isPending} onClick={() => create.mutate()}>Thêm ô</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="s-date">Ngày trực</Label>
          <Input id="s-date" type="date" min={period.startDate} max={period.endDate} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-room">Phòng khám</Label>
          <Select id="s-room" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">— Chọn —</option>
            {catalog.rooms.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-shift">Ca trực</Label>
          <Select id="s-shift" value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
            <option value="">— Chọn —</option>
            {catalog.shifts.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-role">Vai trò</Label>
          <Select id="s-role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">— Chọn —</option>
            {catalog.roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
        </div>
        <NumField label="Chỉ tiêu người trực" value={Number(required)} onChange={setRequired} hint="Không giới hạn số người mà người xếp lịch có thể phân công" />
      </div>
    </Dialog>
  );
}

/* ================================================================== Phân trang */

function PaginationBar({
  total,
  page,
  pageSize,
  onPage,
  noun,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  noun: string;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const start = total ? (safePage - 1) * pageSize + 1 : 0;
  const end = Math.min(total, safePage * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-[var(--muted)]/15 px-3 py-2.5 text-xs text-[var(--muted-foreground)] sm:px-4">
      <span>
        Hiển thị <b className="text-[var(--foreground)]">{start}–{end}</b> / {total} {noun}
      </span>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          disabled={safePage <= 1}
          onClick={() => onPage(safePage - 1)}
          title="Trang trước"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="min-w-20 text-center tabular-nums">Trang {safePage}/{pageCount}</span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          disabled={safePage >= pageCount}
          onClick={() => onPage(safePage + 1)}
          title="Trang sau"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/* ================================================================== Trang chính */

export default function KyLichPage() {
  const can = useAuth((s) => s.can);
  const refresh = useRefreshDuty();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState<DutyPeriod | null>(null);
  const [creating, setCreating] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [clonePeriod, setClonePeriod] = useState<DutyPeriod | null>(null);
  const [generating, setGenerating] = useState(false);
  const [addingSlot, setAddingSlot] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [forcePublish, setForcePublish] = useState(false);
  const [confirmLock, setConfirmLock] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockReason, setUnlockReason] = useState("");
  const [unlockAt, setUnlockAt] = useState(isoToBkkLocal(new Date(Date.now() + 24 * 3600e3).toISOString()));
  const [tab, setTab] = useState("slots");
  const [deleteSlot, setDeleteSlot] = useState<GridSlot | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Bộ lọc lịch sử thông minh
  const [yearFilter, setYearFilter] = useState<string>("ALL");
  const [monthFilter, setMonthFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [search, setSearch] = useState<string>("");
  const [periodPage, setPeriodPage] = useState(1);
  const PERIODS_PAGE_SIZE = 8;

  const canManage = can("duty.period.manage");
  /** Giờ trực tổng hợp và nhật ký chỉ dành cho người quản lý lịch */
  const canOversee = can("duty.manage") || can("duty.manage-all");
  const periods = useQuery({ queryKey: DUTY_KEYS.periods, queryFn: () => dutyApi.periods(), enabled: can("duty.view") });
  const allPeriods = useMemo(() => periods.data ?? [], [periods.data]);
  const today = bkkTodayYmd();

  const availableYears = useMemo(() => {
    const s = new Set<string>();
    for (const p of allPeriods) s.add(p.startDate.slice(0, 4));
    const currentYear = today.slice(0, 4);
    if (!s.has(currentYear)) s.add(currentYear);
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [allPeriods, today]);

  const filteredPeriods = useMemo(() => {
    return allPeriods.filter((p) => {
      const pYear = p.startDate.slice(0, 4);
      const pMonth = String(Number(p.startDate.slice(5, 7)));
      const isCur = p.startDate <= today && p.endDate >= today;

      if (yearFilter !== "ALL" && pYear !== yearFilter) return false;
      if (monthFilter !== "ALL" && pMonth !== monthFilter) return false;
      if (statusFilter === "CURRENT" && !isCur) return false;
      if (statusFilter === "NHAP" && p.status !== "NHAP") return false;
      if (statusFilter === "CONG_BO" && (p.status !== "CONG_BO" || p.locked)) return false;
      if (statusFilter === "DA_CHOT" && !p.locked) return false;

      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchName = p.name.toLowerCase().includes(q);
        const matchDates = `${fmtDate(p.startDate)} ${fmtDate(p.endDate)}`.includes(q);
        const matchWeek = p.isoWeek ? `tuần ${p.isoWeek}`.includes(q) : false;
        if (!matchName && !matchDates && !matchWeek) return false;
      }
      return true;
    });
  }, [allPeriods, yearFilter, monthFilter, statusFilter, search, today]);

  const periodPageCount = Math.max(1, Math.ceil(filteredPeriods.length / PERIODS_PAGE_SIZE));
  const safePeriodPage = Math.min(periodPage, periodPageCount);
  const visiblePeriods = useMemo(
    () =>
      filteredPeriods.slice(
        (safePeriodPage - 1) * PERIODS_PAGE_SIZE,
        safePeriodPage * PERIODS_PAGE_SIZE,
      ),
    [filteredPeriods, safePeriodPage, PERIODS_PAGE_SIZE],
  );

  const currentCount = useMemo(() => allPeriods.filter((p) => p.startDate <= today && p.endDate >= today).length, [allPeriods, today]);
  const draftCount = useMemo(() => allPeriods.filter((p) => p.status === "NHAP").length, [allPeriods]);
  const publishedCount = useMemo(() => allPeriods.filter((p) => p.status === "CONG_BO" && !p.locked).length, [allPeriods]);
  const lockedCount = useMemo(() => allPeriods.filter((p) => p.locked).length, [allPeriods]);

  const selected = useMemo(() => {
    if (selectedId) {
      const found = allPeriods.find((p) => p.id === selectedId);
      if (found) return found;
    }
    return filteredPeriods[0] ?? allPeriods[0] ?? null;
  }, [allPeriods, filteredPeriods, selectedId]);

  const grid = useQuery({ queryKey: DUTY_KEYS.grid(selected?.id ?? 0), queryFn: () => dutyApi.grid(selected!.id), enabled: !!selected });
  const summary = useQuery({ queryKey: DUTY_KEYS.summary(selected?.id ?? 0), queryFn: () => dutyApi.summary(selected!.id), enabled: !!selected && canOversee && tab === "hours" });
  const logs = useQuery({ queryKey: DUTY_KEYS.logs(selected?.id ?? 0), queryFn: () => dutyApi.logs(selected!.id), enabled: !!selected && canOversee && tab === "logs" });

  const act = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onError: (e) => toast.error(errorText(e)),
  });
  const run = (fn: () => Promise<unknown>, ok: string, after?: () => void) =>
    act.mutate(fn, {
      onSuccess: () => {
        toast.success(ok);
        refresh();
        after?.();
      },
    });

  const onExport = async () => {
    if (!selected) return;
    try {
      await downloadFile(dutyApi.exportPath(selected.id), `lich-truc-${selected.startDate}_${selected.endDate}.xlsx`);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  if (!canOversee && !canManage) return <EmptyState title="Trang này dành cho người quản lý lịch trực" />;
  const g = grid.data;

  return (
    <>
      <PageHeader
        title="Kỳ lịch & công bố"
        description="Tạo kỳ lịch tuần, sinh ô trực, phân công, công bố và chốt lịch. Theo dõi giờ trực công bằng và nhật ký thay đổi."
        actions={
          canManage ? (
            <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
              <Button
                onClick={() => setQuickCreateOpen(true)}
                className="w-full bg-emerald-600 text-white font-medium shadow-sm hover:bg-emerald-700 sm:w-auto"
              >
                <Sparkles className="h-4 w-4 mr-1" /> Tạo tuần tiếp theo
              </Button>
              <Button onClick={() => setCreating(true)} variant="outline" className="w-full sm:w-auto">
                <CalendarPlus className="h-4 w-4" /> Tùy chỉnh kỳ lịch
              </Button>
            </div>
          ) : undefined
        }
      />

      {periods.isLoading ? <Skeleton className="h-40 w-full" /> : null}
      {!periods.isLoading && !periods.data?.length ? (
        <EmptyState
          title="Chưa có kỳ lịch nào"
          description="Tạo kỳ lịch đầu tiên để bắt đầu."
          action={
            canManage ? (
              <Button onClick={() => setQuickCreateOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                <Sparkles className="h-4 w-4" /> Tạo kỳ lịch tuần đầu tiên
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {allPeriods.length ? (
        <Card className="mb-4">
          <CardHeader
            title={
              <div className="flex items-center gap-2 text-base">
                <span>Danh mục kỳ lịch trực</span>
                <Badge tone="muted">{filteredPeriods.length}/{allPeriods.length} kỳ</Badge>
                <span className="text-xs font-normal text-[var(--muted-foreground)]">Danh sách kỳ lịch</span>
              </div>
            }
            description="Lọc danh sách kỳ lịch riêng; chọn một kỳ để xem ô trực, giờ trực và nhật ký ở phần chi tiết bên dưới."
            actions={
              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
                <div className="relative col-span-2 sm:col-auto">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                  <Input
                    className="h-9 w-full pl-8 text-xs sm:h-8 sm:w-44"
                    placeholder="Tìm tên, tuần..."
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPeriodPage(1); }}
                  />
                </div>
                <Select
                  className="h-9 w-full text-xs sm:h-8 sm:w-32"
                  value={yearFilter}
                  onChange={(e) => { setYearFilter(e.target.value); setPeriodPage(1); }}
                  aria-label="Lọc theo năm"
                >
                  <option value="ALL">Tất cả năm</option>
                  {availableYears.map((y) => (
                    <option key={y} value={y}>Năm {y}</option>
                  ))}
                </Select>
                <Select
                  className="h-9 w-full text-xs sm:h-8 sm:w-32"
                  value={monthFilter}
                  onChange={(e) => { setMonthFilter(e.target.value); setPeriodPage(1); }}
                  aria-label="Lọc theo tháng"
                >
                  <option value="ALL">Tất cả tháng</option>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                    <option key={m} value={String(m)}>Tháng {m}</option>
                  ))}
                </Select>
              </div>
            }
          />

          {/* Thanh phân loại trạng thái */}
          <div className="border-t px-4 py-2 bg-[var(--muted)]/20 flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold mr-1 text-[var(--muted-foreground)]">Trạng thái:</span>
            <button
              type="button"
              onClick={() => { setStatusFilter("ALL"); setPeriodPage(1); }}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                statusFilter === "ALL"
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm"
                  : "hover:bg-[var(--accent)] text-[var(--muted-foreground)]"
              }`}
            >
              Tất cả ({allPeriods.length})
            </button>
            <button
              type="button"
              onClick={() => { setStatusFilter("CURRENT"); setPeriodPage(1); }}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                statusFilter === "CURRENT"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "hover:bg-[var(--accent)] text-[var(--muted-foreground)]"
              }`}
            >
              Đang diễn ra ({currentCount})
            </button>
            <button
              type="button"
              onClick={() => { setStatusFilter("CONG_BO"); setPeriodPage(1); }}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                statusFilter === "CONG_BO"
                  ? "bg-teal-600 text-white shadow-sm"
                  : "hover:bg-[var(--accent)] text-[var(--muted-foreground)]"
              }`}
            >
              Đã công bố ({publishedCount})
            </button>
            <button
              type="button"
              onClick={() => { setStatusFilter("DA_CHOT"); setPeriodPage(1); }}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                statusFilter === "DA_CHOT"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "hover:bg-[var(--accent)] text-[var(--muted-foreground)]"
              }`}
            >
              Đã chốt ({lockedCount})
            </button>
            <button
              type="button"
              onClick={() => { setStatusFilter("NHAP"); setPeriodPage(1); }}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                statusFilter === "NHAP"
                  ? "bg-amber-600 text-white shadow-sm"
                  : "hover:bg-[var(--accent)] text-[var(--muted-foreground)]"
              }`}
            >
              Bản nháp ({draftCount})
            </button>
          </div>

          <CardBody className="p-0">
            <div className="space-y-2 p-3 md:hidden">
              {visiblePeriods.map((p) => {
                const isCur = p.startDate <= today && p.endDate >= today;
                const percent = p.requiredCount ? Math.min(100, Math.round(((p.filledCount ?? 0) / p.requiredCount) * 100)) : 0;
                const isFull = !!p.requiredCount && p.filledCount! >= p.requiredCount;
                const weekNum = p.isoWeek || isoWeekNumber(p.startDate).week;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full rounded-xl border p-3 text-left transition active:scale-[0.99] ${selected?.id === p.id ? "border-[var(--primary)] bg-[var(--accent)] ring-1 ring-[var(--primary)]/30" : "bg-[var(--card)]"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold">{p.name}</span>
                          {isCur ? <CurrentWeekBadge /> : null}
                          <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--muted-foreground)]">T{weekNum}</span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--muted-foreground)]">{fmtDate(p.startDate)} – {fmtDate(p.endDate)} · Chốt {fmtDateTime(p.lockedAt ?? p.lockAt)}</p>
                      </div>
                      <PhaseBadge period={p} />
                    </div>
                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between text-xs"><span>Tiến độ xếp trực</span><span className={isFull ? "font-semibold text-emerald-600" : "font-semibold text-amber-600"}>{p.filledCount ?? 0}/{p.requiredCount ?? 0} · {percent}%</span></div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className={isFull ? "h-full bg-emerald-500" : "h-full bg-amber-500"} style={{ width: `${percent}%` }} /></div>
                    </div>
                  </button>
                );
              })}
              {filteredPeriods.length === 0 ? <p className="px-3 py-8 text-center text-sm text-[var(--muted-foreground)]">Không tìm thấy kỳ lịch nào phù hợp với bộ lọc hiện tại.</p> : null}
            </div>
            <div className="hidden md:block">
            <TableWrap>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Kỳ lịch</Th>
                    <Th>Thời gian</Th>
                    <Th>Trạng thái</Th>
                    <Th>Tiến độ xếp trực</Th>
                    <Th>Mốc chốt</Th>
                    <Th className="text-right">Thao tác</Th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePeriods.map((p) => {
                    const isCur = p.startDate <= today && p.endDate >= today;
                    const percent = p.requiredCount ? Math.min(100, Math.round(((p.filledCount ?? 0) / p.requiredCount) * 100)) : 0;
                    const isFull = p.requiredCount && p.filledCount! >= p.requiredCount;
                    const weekNum = p.isoWeek || isoWeekNumber(p.startDate).week;

                    return (
                      <Tr
                        key={p.id}
                        onClick={() => setSelectedId(p.id)}
                        className={`transition-colors cursor-pointer ${
                          selected?.id === p.id
                            ? "bg-[var(--accent)]/90 ring-1 ring-[var(--primary)]/30"
                            : isCur
                              ? "bg-emerald-50/40 dark:bg-emerald-950/20 border-l-4 border-l-emerald-600"
                              : "hover:bg-[var(--accent)]/50"
                        }`}
                      >
                        <Td className="font-medium">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[13px]">{p.name}</span>
                            {isCur ? <CurrentWeekBadge /> : null}
                            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[var(--muted)] text-[var(--muted-foreground)]">
                              T{weekNum}
                            </span>
                          </div>
                        </Td>
                        <Td className="whitespace-nowrap">
                          <div className="text-xs">
                            <span className="font-medium">{fmtDate(p.startDate)}</span> – <span className="font-medium">{fmtDate(p.endDate)}</span>
                          </div>
                          <div className="text-[10.5px] text-[var(--muted-foreground)]">
                            7 ngày (Thứ 2 → Chủ nhật)
                          </div>
                        </Td>
                        <Td><PhaseBadge period={p} /></Td>
                        <Td className="whitespace-nowrap">
                          <div className="w-32 space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="tabular-nums font-medium">{p.filledCount ?? 0}/{p.requiredCount ?? 0}</span>
                              <span className={`text-[11px] font-bold ${isFull ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                                {percent}%
                              </span>
                            </div>
                            <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                              <div
                                className={`h-full transition-all duration-300 ${isFull ? "bg-emerald-500" : "bg-amber-500"}`}
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        </Td>
                        <Td className="whitespace-nowrap text-xs">{fmtDateTime(p.lockedAt ?? p.lockAt)}</Td>
                        <Td className="text-right">
                          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                            <Button size="sm" variant="ghost" onClick={() => setSelectedId(p.id)} title="Xem chi tiết">
                              <Eye className="h-4 w-4" />
                            </Button>
                            {canManage ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setClonePeriod(p)}
                                title="Nhân bản sang tuần mới"
                                className="text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950/40"
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                            ) : null}
                            {canManage && p.status === "NHAP" ? (
                              <Button size="sm" variant="ghost" onClick={() => setEditing(p)} title="Sửa cấu hình">
                                <Pencil className="h-4 w-4" />
                              </Button>
                            ) : null}
                          </div>
                        </Td>
                      </Tr>
                    );
                  })}
                  {filteredPeriods.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
                        Không tìm thấy kỳ lịch nào phù hợp với bộ lọc hiện tại.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </TableWrap>
            </div>
          </CardBody>
          <PaginationBar
            total={filteredPeriods.length}
            page={safePeriodPage}
            pageSize={PERIODS_PAGE_SIZE}
            onPage={setPeriodPage}
            noun="kỳ lịch"
          />
        </Card>
      ) : null}

      {selected ? (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {selected.name} <PhaseBadge period={selected} />
                </span>
              }
              description={`${fmtDate(selected.startDate)} – ${fmtDate(selected.endDate)} · Mốc chốt: ${fmtDateTime(selected.lockAt)}${selected.publishedAt ? ` · Công bố: ${fmtDateTime(selected.publishedAt)}` : ""}`}
              actions={
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {canManage && selected.status === "NHAP" ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setEditing(selected)}>
                        <Pencil className="h-4 w-4" /> Cấu hình
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setGenerating(true)}>
                        <Wand2 className="h-4 w-4" /> Sinh ô
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setAddingSlot(true)}>
                        <Plus className="h-4 w-4" /> Thêm ô
                      </Button>
                      <Button size="sm" onClick={() => { setForcePublish(false); setConfirmPublish(true); }}>
                        <Send className="h-4 w-4" /> Công bố
                      </Button>
                    </>
                  ) : null}
                  {canManage && selected.status === "CONG_BO" && !selected.locked ? (
                    <Button size="sm" variant="outline" onClick={() => setConfirmLock(true)}>
                      <Lock className="h-4 w-4" /> Chốt sớm
                    </Button>
                  ) : null}
                  {canManage && selected.locked ? (
                    <Button size="sm" variant="outline" onClick={() => setUnlockOpen(true)}>
                      <Unlock className="h-4 w-4" /> Mở chốt
                    </Button>
                  ) : null}
                  {g?.viewer.canExport ? (
                    <Button size="sm" variant="outline" onClick={onExport}>
                      <Download className="h-4 w-4" /> Excel
                    </Button>
                  ) : null}
                  {canManage ? (
                    <Button size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40" onClick={() => setDeleteOpen(true)}>
                      <Trash2 className="h-4 w-4" /> Xoá kỳ lịch
                    </Button>
                  ) : null}
                </div>
              }
            />
            <CardBody>
              {g ? (
                <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <KpiTile label="Ô trực" value={g.summary.slots} />
                  <KpiTile label="Vị trí cần người" value={g.summary.required} />
                  <KpiTile label="Đã xếp" value={g.summary.filled} tone="success" />
                  <KpiTile label="Còn thiếu" value={g.summary.missing} tone={g.summary.missing ? "warning" : "default"} />
                </div>
              ) : null}
              <Tabs
                value={tab}
                onChange={setTab}
                items={[
                  {
                    key: "slots",
                    label: "Ô trực",
                    content: (
                      <SlotsTable
                        key={selected.id}
                        slots={g?.slots ?? []}
                        loading={grid.isLoading}
                        canEdit={canManage && selected.status === "NHAP"}
                        onDelete={(s) => setDeleteSlot(s)}
                      />
                    ),
                  },
                  ...(canOversee ? [{ key: "hours", label: "Giờ trực", content: <HoursTab data={summary.data} loading={summary.isLoading} /> },
                  { key: "logs", label: "Nhật ký", content: <LogsTab logs={logs.data} loading={logs.isLoading} canView={canOversee} /> }] : []),
                ]}
              />
            </CardBody>
          </Card>
        </div>
      ) : null}

      {creating || editing ? (
        <PeriodDialog key={editing?.id ?? "new"} onClose={() => { setCreating(false); setEditing(null); }} period={editing} />
      ) : null}
      {quickCreateOpen ? (
        <QuickCreateNextPeriodDialog
          onClose={() => setQuickCreateOpen(false)}
          onCreated={(newId) => {
            setSelectedId(newId);
            setQuickCreateOpen(false);
          }}
        />
      ) : null}
      {clonePeriod ? (
        <ClonePeriodDialog
          period={clonePeriod}
          onClose={() => setClonePeriod(null)}
          onCloned={(newId) => {
            setSelectedId(newId);
            setClonePeriod(null);
          }}
        />
      ) : null}
      {selected && generating ? <GenerateDialog open={generating} onClose={() => setGenerating(false)} periodId={selected.id} /> : null}
      {selected && addingSlot ? <SlotDialog open={addingSlot} onClose={() => setAddingSlot(false)} period={selected} /> : null}
      {selected && deleteOpen ? (
        <DeletePeriodDialog
          period={selected}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => {
            setDeleteOpen(false);
            setSelectedId(null);
            refresh();
          }}
        />
      ) : null}

      {selected ? (
        <ConfirmDialog
          open={confirmPublish}
          title="Công bố lịch trực"
          confirmText="Công bố"
          onClose={() => setConfirmPublish(false)}
          onConfirm={() => {
            run(() => dutyApi.publish(selected.id, forcePublish), "Đã công bố lịch. Người trực đã được thông báo.", () => setConfirmPublish(false));
          }}
          message={
            <div className="space-y-3">
              <p>Sau khi công bố, nhân viên thấy lịch và có thể đăng ký ca trống. Thông báo sẽ gửi tới từng người được xếp trực.</p>
              {g && g.summary.missing > 0 ? (
                <label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/60 p-2.5 text-xs dark:border-amber-800 dark:bg-amber-950/30">
                  <input type="checkbox" className="mt-0.5" checked={forcePublish} onChange={(e) => setForcePublish(e.target.checked)} />
                  <span>Còn {g.summary.missing} ô chưa đủ người. Vẫn công bố (việc này được ghi vào nhật ký).</span>
                </label>
              ) : null}
            </div>
          }
        />
      ) : null}

      {selected ? (
        <ConfirmDialog
          open={confirmLock}
          title="Chốt lịch trực"
          confirmText="Chốt lịch"
          onClose={() => setConfirmLock(false)}
          onConfirm={() => run(() => dutyApi.lock(selected.id), "Đã chốt lịch", () => setConfirmLock(false))}
          message="Sau khi chốt, nhân viên không tự đăng ký hay đổi ca được nữa. Muốn đổi người trực phải gửi yêu cầu ngoại lệ tới KHTH."
        />
      ) : null}

      {selected ? (
        <Dialog
          open={unlockOpen}
          onClose={() => setUnlockOpen(false)}
          title="Mở chốt lịch"
          description="Mở chốt cho phép điều chỉnh lại lịch. Bắt buộc ghi lý do và đặt mốc chốt mới."
          footer={
            <>
              <Button variant="ghost" onClick={() => setUnlockOpen(false)}>Huỷ</Button>
              <Button
                onClick={() => {
                  if (unlockReason.trim().length < 5) return toast.error("Ghi lý do mở chốt (tối thiểu 5 ký tự)");
                  run(() => dutyApi.unlock(selected.id, unlockReason.trim(), bkkLocalToIso(unlockAt)), "Đã mở chốt lịch", () => {
                    setUnlockOpen(false);
                    setUnlockReason("");
                  });
                }}
              >
                Mở chốt
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="u-lock">Mốc chốt mới (giờ Việt Nam)</Label>
              <Input id="u-lock" type="datetime-local" value={unlockAt} onChange={(e) => setUnlockAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-reason">Lý do *</Label>
              <Textarea id="u-reason" rows={3} value={unlockReason} onChange={(e) => setUnlockReason(e.target.value)} placeholder="Ví dụ: Bổ sung bác sĩ trực thay sau sự cố" />
            </div>
          </div>
        </Dialog>
      ) : null}

      {deleteSlot ? (
        <ConfirmDialog
          open={!!deleteSlot}
          title="Xoá ô trực"
          confirmText="Xoá ô"
          onClose={() => setDeleteSlot(null)}
          onConfirm={() => {
            const hasPeople = deleteSlot.assignments.length > 0;
            run(
              () => dutyApi.deleteSlot(deleteSlot.id, hasPeople ? { force: true, reason: "Xoá ô theo điều chỉnh kế hoạch trực" } : {}),
              "Đã xoá ô trực",
              () => setDeleteSlot(null),
            );
          }}
          message={
            deleteSlot.assignments.length
              ? `Ô này đang có ${deleteSlot.assignments.length} người trực. Xoá sẽ gỡ họ khỏi ca và thông báo cho từng người.`
              : "Xoá ô trực này khỏi kỳ lịch?"
          }
        />
      ) : null}
    </>
  );
}

/* ================================================================== Các tab */

function SlotsTable({ slots, loading, canEdit, onDelete }: { slots: GridSlot[]; loading: boolean; canEdit: boolean; onDelete: (s: GridSlot) => void }) {
  const [page, setPage] = useState(1);
  const SLOT_PAGE_SIZE = 25;
  const pageCount = Math.max(1, Math.ceil(slots.length / SLOT_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibleSlots = slots.slice((safePage - 1) * SLOT_PAGE_SIZE, safePage * SLOT_PAGE_SIZE);

  if (loading) return <Skeleton className="h-40 w-full" />;
  if (!slots.length) return <EmptyState title="Chưa có ô trực" description="Dùng nút Sinh ô hoặc Thêm ô để tạo lịch." />;
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-[var(--muted)]/15 px-3 py-2.5">
        <div>
          <h3 className="text-sm font-semibold">Danh sách ô trực</h3>
          <p className="text-xs text-[var(--muted-foreground)]">Phân trang độc lập với danh sách kỳ lịch để giữ bảng nhẹ khi một kỳ có nhiều phòng và ca.</p>
        </div>
        <Badge tone="muted">{slots.length} ô</Badge>
      </div>
      <div className="space-y-2 p-3 md:hidden">
        {visibleSlots.map((s) => (
          <div key={s.id} className="rounded-xl border p-3">
            <div className="flex items-start justify-between gap-2">
              <div><div className="font-semibold">{weekdayLabel(new Date(`${s.dutyDate}T00:00:00Z`).getUTCDay() || 7)} · {fmtDm(s.dutyDate)}</div><div className="mt-1 text-xs text-[var(--muted-foreground)]">{s.roomCode} · {s.roleName}</div></div>
              <Badge tone={s.filled >= s.requiredCount ? "success" : "warning"}>{s.filled}/{s.requiredCount}</Badge>
            </div>
            <div className="mt-2 flex items-center gap-1.5"><ShiftChip code={s.shiftCode} color={s.shiftColor} /><span className="text-xs">{s.startTime}–{s.endTime}</span></div>
            <div className="mt-2 text-xs text-[var(--muted-foreground)]">{s.assignments.map((a) => a.fullName).join(", ") || "Chưa có người trực"}</div>
            {canEdit ? <div className="mt-2 flex justify-end"><Button size="sm" variant="ghost" onClick={() => onDelete(s)}><Trash2 className="h-4 w-4" /> Xoá ô</Button></div> : null}
          </div>
        ))}
      </div>
      <div className="hidden md:block"><TableWrap>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <Th>Ngày</Th>
            <Th>Phòng</Th>
            <Th>Ca</Th>
            <Th>Vai trò</Th>
            <Th>Người trực</Th>
            <Th>Đủ</Th>
            {canEdit ? <Th className="text-right">&nbsp;</Th> : null}
          </tr>
        </thead>
        <tbody>
          {visibleSlots.map((s) => (
            <Tr key={s.id}>
              <Td className="whitespace-nowrap">{weekdayLabel(new Date(`${s.dutyDate}T00:00:00Z`).getUTCDay() || 7)} {fmtDm(s.dutyDate)}</Td>
              <Td className="font-medium">{s.roomCode}</Td>
              <Td>
                <span className="inline-flex items-center gap-1.5">
                  <ShiftChip code={s.shiftCode} color={s.shiftColor} /> <span className="text-xs text-[var(--muted-foreground)]">{s.startTime}–{s.endTime}</span>
                </span>
              </Td>
              <Td className="text-xs">{s.roleName}</Td>
              <Td className="max-w-[18rem] truncate text-xs">{s.assignments.map((a) => a.fullName).join(", ") || <span className="text-amber-600">Chưa có</span>}</Td>
              <Td className="whitespace-nowrap">
                <Badge tone={s.filled >= s.requiredCount ? "success" : "warning"}>
                  {s.filled}/{s.requiredCount}
                </Badge>
              </Td>
              {canEdit ? (
                <Td className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => onDelete(s)} title="Xoá ô">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </Td>
              ) : null}
            </Tr>
          ))}
        </tbody>
      </table>
    </TableWrap></div>
      <PaginationBar
        total={slots.length}
        page={safePage}
        pageSize={SLOT_PAGE_SIZE}
        onPage={setPage}
        noun="ô trực"
      />
    </div>
  );
}

function HoursTab({ data, loading }: { data?: { items: { userId: number; fullName: string; title: string; departmentName: string; shifts: number; nights: number; hours: number; days: number }[]; fairness: { people: number; maxHours: number; minHours: number; gapHours: number } }; loading: boolean }) {
  if (loading || !data) return <Skeleton className="h-40 w-full" />;
  if (!data.items.length) return <EmptyState title="Chưa có ai được xếp trực" />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Người trực" value={data.fairness.people} />
        <KpiTile label="Nhiều giờ nhất" value={hoursText(data.fairness.maxHours)} />
        <KpiTile label="Ít giờ nhất" value={hoursText(data.fairness.minHours)} />
        <KpiTile label="Chênh lệch" value={hoursText(data.fairness.gapHours)} tone={data.fairness.gapHours > 24 ? "warning" : "success"} hint="Càng nhỏ càng công bằng" />
      </div>
      <div className="space-y-2 md:hidden">
        {data.items.map((i) => <div key={i.userId} className="rounded-xl border p-3"><div className="font-semibold">{i.fullName}</div><div className="mt-0.5 text-xs text-[var(--muted-foreground)]">{i.title} · {i.departmentName || "—"}</div><div className="mt-2 grid grid-cols-4 gap-1 text-center text-xs"><span><b className="block text-sm">{i.days}</b>Ngày</span><span><b className="block text-sm">{i.shifts}</b>Ca</span><span><b className="block text-sm">{i.nights}</b>Đêm</span><span><b className="block text-sm">{hoursText(i.hours)}</b>Giờ</span></div></div>)}
      </div>
      <div className="hidden md:block"><TableWrap>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <Th>Nhân viên</Th>
              <Th>Chức danh</Th>
              <Th>Khoa</Th>
              <Th className="text-right">Ngày trực</Th>
              <Th className="text-right">Số ca</Th>
              <Th className="text-right">Ca đêm</Th>
              <Th className="text-right">Tổng giờ</Th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i) => (
              <Tr key={i.userId}>
                <Td className="font-medium">{i.fullName}</Td>
                <Td className="text-xs">{i.title}</Td>
                <Td className="text-xs">{i.departmentName || "—"}</Td>
                <Td className="text-right tabular-nums">{i.days}</Td>
                <Td className="text-right tabular-nums">{i.shifts}</Td>
                <Td className="text-right tabular-nums">{i.nights}</Td>
                <Td className="text-right font-semibold tabular-nums">{hoursText(i.hours)}</Td>
              </Tr>
            ))}
          </tbody>
        </table>
      </TableWrap></div>
    </div>
  );
}

function LogsTab({ logs, loading, canView }: { logs?: { id: number; action: string; reason: string; createdAt: string; actorName: string | null; userName: string | null }[]; loading: boolean; canView: boolean }) {
  if (!canView) return <EmptyState title="Chỉ người quản lý lịch xem được nhật ký" />;
  if (loading || !logs) return <Skeleton className="h-40 w-full" />;
  if (!logs.length) return <EmptyState title="Chưa có nhật ký" />;
  return (
    <ol className="relative space-y-3 border-l pl-5">
      {logs.map((l) => (
        <li key={l.id} className="relative">
          <span className="absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full bg-[var(--primary)]" />
          <div className="text-sm">
            <span className="font-semibold">{ACTION_LABEL[l.action] ?? l.action}</span>
            {l.userName ? <span className="text-[var(--muted-foreground)]"> · {l.userName}</span> : null}
          </div>
          <div className="text-xs text-[var(--muted-foreground)]">
            {fmtDateTime(l.createdAt)} · {l.actorName ?? "Hệ thống"}
          </div>
          {l.reason ? <div className="mt-0.5 text-xs italic text-[var(--muted-foreground)]">“{l.reason}”</div> : null}
        </li>
      ))}
    </ol>
  );
}
