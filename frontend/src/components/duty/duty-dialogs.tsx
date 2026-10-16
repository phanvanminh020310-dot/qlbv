"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Switch, Textarea } from "@/components/ui/input";
import { Badge, Skeleton } from "@/components/ui/card";
import {
  ABSENCE_REASON_LABEL,
  DUTY_KEYS,
  dutyApi,
  fmtDate,
  fmtDateTime,
  fmtDm,
  addDaysYmd,
  isoWeekday,
  smartPeriodTitle,
  REQUEST_TYPE_LABEL,
  SOURCE_LABEL,
  weekdayLabel,
  type DutyPeriod,
  type GridResponse,
  type GridSlot,
  type RequestType,
} from "@/lib/duty";
import { errorText, ShiftChip, StaffSelect, ViolationList } from "./duty-shared";

/** Thứ trong tuần của một ngày YYYY-MM-DD */
export function dayName(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return weekdayLabel(d === 0 ? 7 : d);
}

/** Làm mới mọi dữ liệu lịch trực sau khi thay đổi */
export function useRefreshDuty() {
  const qc = useQueryClient();
  return () => {
    for (const key of [["duty-grid"], ["duty-options"], ["duty-me"], ["duty-requests"], ["duty-candidates"], ["duty-periods"], ["duty-period"], ["duty-summary"], ["duty-logs"], ["duty-absences"], ["duty-absence-requests"]]) {
      void qc.invalidateQueries({ queryKey: key });
    }
  };
}

/** Bộ thao tác dùng chung: mọi thao tác báo kết quả bằng thông báo và làm mới dữ liệu */
export function useDutyActions() {
  const refresh = useRefreshDuty();
  const run = <T,>(fn: (v: T) => Promise<unknown>, ok: string | ((v: T) => string)) =>
    useMutation({
      mutationFn: fn,
      onSuccess: (_res, v) => {
        toast.success(typeof ok === "function" ? ok(v) : ok);
        refresh();
      },
      onError: (e) => toast.error(errorText(e)),
    });
  return {
    refresh,
    assign: run<{ slotId: number; userId: number; force?: boolean; reason?: string }>(
      (v) => dutyApi.assign(v.slotId, { userId: v.userId, force: v.force, reason: v.reason }),
      (v) => (v.force ? "Đã xếp người trực (bỏ qua ràng buộc, đã ghi nhật ký)" : "Đã xếp người trực"),
    ),
    unassign: run<{ assignmentId: number }>((v) => dutyApi.unassign(v.assignmentId), "Đã gỡ người trực khỏi ca"),
    register: run<{ slotId: number }>((v) => dutyApi.register(v.slotId), "Đã đăng ký ca trực"),
    unregister: run<{ slotId: number }>((v) => dutyApi.unregister(v.slotId), "Đã huỷ đăng ký ca"),
    accept: run<{ id: number }>(
      (v) => dutyApi.acceptRequest(v.id),
      "Đã đồng ý. Yêu cầu đang chờ Trưởng khoa/Điều phối duyệt",
    ),
    decline: run<{ id: number; note?: string }>((v) => dutyApi.declineRequest(v.id, v.note), "Đã từ chối yêu cầu"),
    cancel: run<{ id: number }>((v) => dutyApi.cancelRequest(v.id), "Đã huỷ yêu cầu"),
    removeAbsence: run<{ id: number }>((v) => dutyApi.deleteAbsence(v.id), "Đã xoá ghi nhận nghỉ phép"),
  };
}

/* ================================================================== Xếp người trực */

export function AssignDialog({
  open,
  onClose,
  slot,
  canManageAll,
  locked,
}: {
  open: boolean;
  onClose: () => void;
  slot: GridSlot | null;
  canManageAll: boolean;
  locked: boolean;
}) {
  const actions = useDutyActions();
  const [q, setQ] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [forceFor, setForceFor] = useState<number | null>(null);
  const [forceReason, setForceReason] = useState("");

  // Candidate evaluation includes roster constraints, so defer the expensive API work
  // until typing pauses rather than invalidating/re-rendering on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setSubmittedQuery(q.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  const cand = useQuery({
    queryKey: [...DUTY_KEYS.candidates(slot?.id ?? 0), submittedQuery],
    queryFn: () => dutyApi.candidates(slot!.id, submittedQuery || undefined),
    enabled: open && !!slot && !locked,
    staleTime: 5_000,
    placeholderData: (previousData) => previousData,
  });
  if (!slot) return null;
  const full = slot.filled >= slot.requiredCount;
  const list = (cand.data ?? []).slice(0, 80);
  const onAssign = (userId: number, force: boolean) => {
    if (force && forceReason.trim().length < 5) {
      toast.error("Vui lòng ghi lý do bỏ qua ràng buộc (tối thiểu 5 ký tự)");
      return;
    }
    actions.assign.mutate(
      { slotId: slot.id, userId, force, reason: force ? forceReason.trim() : undefined },
      { onSuccess: () => { setForceFor(null); setForceReason(""); } },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={`Xếp người trực · ${slot.roomCode} · ${slot.shiftCode}`}
      description={`${dayName(slot.dutyDate)} ${fmtDate(slot.dutyDate)} · ${slot.startTime}–${slot.endTime} · ${slot.roleName} · cần ${slot.requiredCount} người`}
    >
      <div className="space-y-5">
        {locked ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            Kỳ lịch đã chốt. Muốn đổi người trực, hãy dùng mục <b>Yêu cầu đổi trực</b> (ngoại lệ) để gửi KHTH.
          </div>
        ) : null}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold">Đang trực</h4>
            <Badge tone={full ? "success" : "warning"}>
              {slot.filled}/{slot.requiredCount} người
            </Badge>
          </div>
          {slot.assignments.length === 0 ? (
            <div className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-[var(--muted-foreground)]">Chưa có người trực</div>
          ) : (
            <ul className="divide-y rounded-lg border">
              {slot.assignments.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {a.fullName}
                      <span className="ml-1.5 text-xs font-normal text-[var(--muted-foreground)]">{a.title}</span>
                    </div>
                    <div className="text-xs text-[var(--muted-foreground)]">
                      {a.departmentName || "Chưa thuộc khoa"}
                      <span className="ml-2 rounded bg-[var(--muted)] px-1.5 py-px text-[10px]">{SOURCE_LABEL[a.source] ?? a.source}</span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={locked || actions.unassign.isPending}
                    onClick={() => actions.unassign.mutate({ assignmentId: a.id })}
                  >
                    Gỡ
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {!locked ? (
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">Chọn người trực</h4>
              <div className="space-y-1">
                <Input
                  className="h-8 w-56 text-sm"
                  placeholder="Tìm theo tên…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                <p className="text-[10px] text-[var(--muted-foreground)]">
                  Tìm sau khi dừng gõ 0,3 giây
                </p>
              </div>
            </div>
            {full ? (
              <div className="mb-2 text-xs text-amber-600 dark:text-amber-400">Ô đã đủ người. Gỡ bớt người trực trước khi thêm, hoặc tăng số người cần của ô.</div>
            ) : null}
            {cand.isLoading ? (
              <div className="py-6 text-center text-sm text-[var(--muted-foreground)]">Đang kiểm tra ràng buộc…</div>
            ) : (
              <ul className="max-h-[52vh] divide-y overflow-y-auto rounded-lg border">
                {list.map((c) => {
                  const clean = c.ok && c.warnings.length === 0;
                  return (
                    <li key={c.userId} className="px-3 py-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-medium">{c.fullName}</span>
                            <span className="text-xs text-[var(--muted-foreground)]">{c.title}</span>
                            {c.sameDepartment ? <Badge tone="brand">Cùng khoa</Badge> : null}
                          </div>
                          <div className="text-xs text-[var(--muted-foreground)]">{c.departmentName || "Chưa thuộc khoa"}</div>
                          <ViolationList errors={c.errors} warnings={c.warnings} />
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          {clean ? <Badge tone="success">Phù hợp</Badge> : c.ok ? <Badge tone="warning">Có cảnh báo</Badge> : <Badge tone="danger">Không đủ điều kiện</Badge>}
                          {c.ok ? (
                            <Button size="sm" disabled={full || actions.assign.isPending} onClick={() => onAssign(c.userId, false)}>
                              Xếp
                            </Button>
                          ) : canManageAll ? (
                            <Button size="sm" variant="outline" onClick={() => setForceFor(forceFor === c.userId ? null : c.userId)}>
                              Bỏ qua ràng buộc
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      {forceFor === c.userId ? (
                        <div className="mt-2.5 space-y-2 rounded-lg border border-amber-300 bg-amber-50/60 p-2.5 dark:border-amber-800 dark:bg-amber-950/30">
                          <Label className="text-xs">Lý do bỏ qua ràng buộc (sẽ ghi vào nhật ký)</Label>
                          <Textarea rows={2} value={forceReason} onChange={(e) => setForceReason(e.target.value)} placeholder="Ví dụ: Bác sĩ đổi sang trực thay do sự cố, đã báo Trưởng khoa" />
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setForceFor(null)}>Huỷ</Button>
                            <Button size="sm" onClick={() => onAssign(c.userId, true)} disabled={actions.assign.isPending}>Xác nhận xếp</Button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
                {list.length === 0 ? <li className="px-3 py-6 text-center text-sm text-[var(--muted-foreground)]">Không có nhân viên phù hợp với từ khoá</li> : null}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
              Hệ thống kiểm tra: trùng giờ, khoảng nghỉ tối thiểu, chức danh, nghỉ phép, giới hạn giờ/ngày/tuần và khác khoa.
            </p>
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ================================================================== Chi tiết một ô (phòng × ngày) */

export function CellDialog({
  open,
  onClose,
  title,
  subtitle,
  slots,
  grid,
  onAssign,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  slots: GridSlot[];
  grid: GridResponse;
  onAssign: (slot: GridSlot) => void;
}) {
  const v = grid.viewer;
  const locked = grid.period.locked;
  return (
    <Dialog open={open} onClose={onClose} size="lg" title={title} description={subtitle}>
      <div className="space-y-3">
        {slots.length === 0 ? <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">Không có ca trực</div> : null}
        {slots.map((s) => {
          const mine = s.assignments.some((a) => a.userId === v.userId);
          return (
            <div key={s.id} className="rounded-xl border bg-[var(--card)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <ShiftChip code={s.shiftCode} color={s.shiftColor} />
                  <span className="text-sm font-medium">{s.shiftName}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {s.startTime}–{s.endTime} · {s.roleName}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge tone={s.filled >= s.requiredCount ? "success" : "warning"}>
                    {s.filled}/{s.requiredCount}
                  </Badge>
                  {s.past ? <Badge tone="muted">Đã qua</Badge> : null}
                </div>
              </div>

              <ul className="mt-2.5 flex flex-wrap gap-1.5">
                {s.assignments.map((a) => (
                  <li
                    key={a.id}
                    className={`rounded-full border px-2.5 py-1 text-xs ${a.userId === v.userId ? "border-[var(--primary)] bg-[var(--accent)] font-semibold" : "bg-[var(--muted)]/40"}`}
                  >
                    {a.fullName}
                    <span className="ml-1 text-[var(--muted-foreground)]">{a.title}</span>
                  </li>
                ))}
                {s.assignments.length === 0 ? <li className="text-xs text-[var(--muted-foreground)]">Chưa có người trực</li> : null}
              </ul>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {v.canManage && !locked ? (
                  <Button size="sm" variant="outline" onClick={() => onAssign(s)}>
                    Quản lý người trực
                  </Button>
                ) : null}
                {v.canManage && locked ? <span className="text-xs text-[var(--muted-foreground)]">Đã chốt — không đổi người trực tại đây</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

/* ================================================================== Yêu cầu nhường / đổi / ngoại lệ */

export function RequestDialog({
  open,
  onClose,
  mode: initialMode,
  slotChoices,
  grid,
  initialSlotId,
  meId,
}: {
  open: boolean;
  onClose: () => void;
  mode: RequestType;
  slotChoices: Array<{ id: number; label: string }>;
  grid: GridResponse | null;
  initialSlotId?: number;
  meId?: number;
}) {
  const actions = useDutyActions();
  const [mode, setMode] = useState<RequestType>(initialMode);
  const [slotId, setSlotId] = useState<number>(initialSlotId ?? slotChoices[0]?.id ?? 0);
  const [targetUserId, setTargetUserId] = useState<number | null>(null);
  const [targetSlotId, setTargetSlotId] = useState<string>("");
  const [replacementUserId, setReplacementUserId] = useState<number | null>(null);
  const [urgent, setUrgent] = useState(false);
  const [reason, setReason] = useState("");
  const me = grid?.viewer.userId ?? meId ?? 0;
  const mySlot = grid?.slots.find((s) => s.id === slotId);

  // Ca của người khác để đổi (chỉ ca còn có thể thay đổi)
  const swapOptions = (grid?.slots ?? [])
    .filter((s) => s.id !== slotId && !s.past && !s.locked)
    .flatMap((s) => s.assignments.filter((a) => a.userId !== me).map((a) => ({ key: `${s.id}|${a.userId}`, label: `${fmtDm(s.dutyDate)} · ${s.roomCode} · ${s.shiftCode} · ${s.roleName} — ${a.fullName}` })));

  const submit = () => {
    if (reason.trim().length < 5) return toast.error("Vui lòng nêu lý do (tối thiểu 5 ký tự)");
    const body: Record<string, unknown> = { type: mode, slotId, reason: reason.trim(), urgent };
    if (mode === "NHUONG") {
      if (!targetUserId) return toast.error("Vui lòng chọn người nhận ca");
      body.targetUserId = targetUserId;
    }
    if (mode === "DOI") {
      const [sid, uid] = targetSlotId.split("|").map(Number);
      if (!sid || !uid) return toast.error("Vui lòng chọn ca cần đổi");
      body.targetSlotId = sid;
      body.targetUserId = uid;
    }
    if (mode === "NGOAI_LE" && replacementUserId) body.replacementUserId = replacementUserId;
    return createRequest.mutate(body);
  };
  const createRequest = useMutation({
    mutationFn: (body: Record<string, unknown>) => dutyApi.createRequest(body),
    onSuccess: () => {
      toast.success(mode === "NGOAI_LE" ? "Đã gửi yêu cầu ngoại lệ tới KHTH" : "Đã gửi đề nghị tới người nhận");
      setReason("");
      onClose();
      actions.refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={REQUEST_TYPE_LABEL[mode]}
      description={
        mode === "NGOAI_LE"
          ? "Dùng khi có sự cố làm bạn không trực được hoặc cần đổi người sau khi lịch đã chốt. KHTH sẽ xử lý."
          : "Đề nghị gửi tới người nhận. Nếu người nhận đồng ý, yêu cầu còn chờ Trưởng khoa/Điều phối duyệt."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Đóng</Button>
          <Button onClick={submit} disabled={createRequest.isPending}>Gửi yêu cầu</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rq-mode">Loại yêu cầu</Label>
            <Select id="rq-mode" value={mode} onChange={(e) => setMode(e.target.value as RequestType)}>
              <option value="NHUONG">Nhường ca (cho người khác trực)</option>
              <option value="DOI">Đổi ca (hai chiều)</option>
              <option value="NGOAI_LE">Ngoại lệ / sự cố (gửi KHTH)</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rq-slot">Ca của bạn</Label>
            <Select id="rq-slot" value={String(slotId)} onChange={(e) => setSlotId(Number(e.target.value))} disabled={slotChoices.length <= 1}>
              {slotChoices.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </Select>
            {mySlot ? <div className="text-[11px] text-[var(--muted-foreground)]">{dayName(mySlot.dutyDate)} · {mySlot.startTime}–{mySlot.endTime}</div> : null}
          </div>
        </div>

        {mode === "NHUONG" ? (
          <div className="space-y-1.5">
            <Label htmlFor="rq-target">Người nhận ca</Label>
            <StaffSelect id="rq-target" value={targetUserId} onChange={setTargetUserId} exclude={[me]} />
          </div>
        ) : null}

        {mode === "DOI" ? (
          <div className="space-y-1.5">
            <Label htmlFor="rq-swap">Ca muốn đổi sang (ca của người khác)</Label>
            <Select id="rq-swap" value={targetSlotId} onChange={(e) => setTargetSlotId(e.target.value)}>
              <option value="">— Chọn ca —</option>
              {swapOptions.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </Select>
            {swapOptions.length === 0 ? <div className="text-[11px] text-[var(--muted-foreground)]">Chưa có ca nào của người khác trong kỳ này để đổi.</div> : null}
          </div>
        ) : null}

        {mode === "NGOAI_LE" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rq-repl">Người thay (nếu đã thoả thuận)</Label>
              <StaffSelect id="rq-repl" value={replacementUserId} onChange={setReplacementUserId} exclude={[me]} placeholder="— Để KHTH chỉ định —" />
            </div>
            <div className="flex items-end gap-2 pb-2">
              <Switch checked={urgent} onCheckedChange={setUrgent} />
              <span className="text-sm">Khẩn cấp (trước giờ trực)</span>
            </div>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="rq-reason">Lý do</Label>
          <Textarea id="rq-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Nêu rõ lý do để người duyệt xem xét nhanh" />
        </div>
      </div>
    </Dialog>
  );
}

/* ================================================================== Duyệt / từ chối (có ghi chú) */

export function ReviewDialog({
  open,
  onClose,
  title,
  description,
  noteLabel,
  requireNote,
  confirmText,
  tone = "default",
  withReplacement = false,
  onConfirm,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  noteLabel: string;
  requireNote: boolean;
  confirmText: string;
  tone?: "default" | "danger";
  withReplacement?: boolean;
  onConfirm: (note: string, replacementUserId: number | null, force: boolean) => void;
  loading?: boolean;
}) {
  const [note, setNote] = useState("");
  const [replacement, setReplacement] = useState<number | null>(null);
  const [force, setForce] = useState(false);
  const canForce = withReplacement;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button
            variant={tone === "danger" ? "danger" : "default"}
            disabled={loading || (requireNote && note.trim().length < 3)}
            onClick={() => onConfirm(note.trim(), replacement, force)}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {withReplacement ? (
          <div className="space-y-1.5">
            <Label>Người thay trực</Label>
            <StaffSelect value={replacement} onChange={setReplacement} placeholder="— Giữ người thay đã đề xuất —" />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label>{noteLabel}{requireNote ? " *" : ""}</Label>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {canForce ? (
          <label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/60 p-2.5 text-xs dark:border-amber-800 dark:bg-amber-950/30">
            <input type="checkbox" className="mt-0.5" checked={force} onChange={(e) => setForce(e.target.checked)} />
            <span>Bỏ qua ràng buộc khi xếp người thay (chỉ dùng khi thật cần, sẽ ghi nhật ký kèm lý do)</span>
          </label>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ================================================================== Điều chỉnh trực tiếp (KHTH) */

export function OverrideDialog({ open, onClose, initialPeriodId }: { open: boolean; onClose: () => void; initialPeriodId?: number }) {
  const actions = useDutyActions();
  const [periodId, setPeriodId] = useState<number>(initialPeriodId ?? 0);
  const [slotId, setSlotId] = useState<number>(0);
  const [removeUserId, setRemoveUserId] = useState<number | null>(null);
  const [addUserId, setAddUserId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [force, setForce] = useState(false);
  const periods = useQuery({ queryKey: DUTY_KEYS.periods, queryFn: () => dutyApi.periods(), enabled: open });
  const grid = useQuery({ queryKey: DUTY_KEYS.grid(periodId), queryFn: () => dutyApi.grid(periodId), enabled: open && periodId > 0 });
  const slots = grid.data?.slots ?? [];
  const slot = slots.find((s) => s.id === slotId);
  const override = useMutation({
    mutationFn: () => dutyApi.override({ slotId, removeUserId, addUserId, reason: reason.trim(), force }),
    onSuccess: (res) => {
      toast.success(res.forced ? "Đã điều chỉnh (bỏ qua ràng buộc, đã ghi nhật ký)" : "Đã điều chỉnh người trực");
      setReason("");
      setForce(false);
      actions.refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const submit = () => {
    if (!slotId) return toast.error("Chọn ca cần điều chỉnh");
    if (!removeUserId && !addUserId) return toast.error("Chọn người cần gỡ hoặc người cần thêm");
    if (reason.trim().length < 10) return toast.error("Ghi lý do điều chỉnh (tối thiểu 10 ký tự)");
    override.mutate();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Điều chỉnh người trực trực tiếp"
      description="Dành cho tài khoản Điều phối lịch trực (KHTH): đổi người trực ngay, kể cả sau khi chốt. Mọi thay đổi được ghi nhật ký kèm lý do."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Đóng</Button>
          <Button onClick={submit} disabled={override.isPending}>Thực hiện điều chỉnh</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ov-period">Kỳ lịch</Label>
            <Select id="ov-period" value={String(periodId || "")} onChange={(e) => { setPeriodId(Number(e.target.value)); setSlotId(0); }}>
              <option value="">— Chọn kỳ —</option>
              {(periods.data ?? []).filter((p) => p.status !== "NHAP").map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.phase === "CHOT" ? " (đã chốt)" : ""}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ov-slot">Ca trực</Label>
            <Select id="ov-slot" value={String(slotId || "")} onChange={(e) => { setSlotId(Number(e.target.value)); setRemoveUserId(null); }} disabled={!periodId}>
              <option value="">— Chọn ca —</option>
              {slots.map((s) => (
                <option key={s.id} value={s.id}>
                  {fmtDate(s.dutyDate)} · {s.roomCode} · {s.shiftCode} · {s.roleName} ({s.filled}/{s.requiredCount})
                </option>
              ))}
            </Select>
          </div>
        </div>
        {slot ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ov-remove">Gỡ khỏi ca</Label>
              <Select id="ov-remove" value={removeUserId ? String(removeUserId) : ""} onChange={(e) => setRemoveUserId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">— Không gỡ ai —</option>
                {slot.assignments.map((a) => (
                  <option key={a.userId} value={a.userId}>{a.fullName} — {a.title}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ov-add">Xếp thêm / thay vào ca</Label>
              <StaffSelect id="ov-add" value={addUserId} onChange={setAddUserId} exclude={removeUserId ? [removeUserId] : []} placeholder="— Không thêm ai —" />
            </div>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="ov-reason">Lý do *</Label>
          <Textarea id="ov-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ví dụ: BS A nghỉ ốm đột xuất, KHTH chỉ định BS B trực thay" />
        </div>
        <label className="flex items-start gap-2 rounded-lg border p-2.5 text-xs">
          <input type="checkbox" className="mt-0.5" checked={force} onChange={(e) => setForce(e.target.checked)} />
          <span>Bỏ qua ràng buộc nếu người được thêm vi phạm (ví dụ quá giờ, sai chức danh). Chỉ dùng khi đã có sự thống nhất của lãnh đạo.</span>
        </label>
        {slot && slot.assignments.length === 0 ? <ViolationList warnings={["Ca chưa có người trực"]} /> : null}
      </div>
    </Dialog>
  );
}

/* ================================================================== 1-Click Tạo tuần kế tiếp */

export function QuickCreateNextPeriodDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (periodId: number) => void;
}) {
  const refresh = useRefreshDuty();
  const suggest = useQuery({
    queryKey: ["duty-suggest-next"],
    queryFn: () => dutyApi.suggestNext(),
  });

  const [mode, setMode] = useState<"copy" | "auto" | "empty">("copy");
  const [copyAssignments, setCopyAssignments] = useState(true);
  const [customName, setCustomName] = useState("");

  const data = suggest.data;

  const create = useMutation({
    mutationFn: async () => {
      if (!data) return;
      const body = {
        name: customName.trim() || data.name,
        startDate: data.startDate,
        endDate: data.endDate,
        lockAt: data.lockAt,
        registrationOpensAt: null,
        autoGenerateSlots: mode === "auto",
        copyFromPeriodId: mode === "copy" && data.lastPeriod ? data.lastPeriod.id : undefined,
        copyAssignments: mode === "copy" && copyAssignments,
      };
      return dutyApi.createPeriod(body);
    },
    onSuccess: (res) => {
      toast.success(`Đã tạo "${res?.name || "tuần trực mới"}" thành công!`);
      refresh();
      if (res?.id) onCreated(res.id);
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });

  if (suggest.isLoading) {
    return (
      <Dialog open onClose={onClose} title="Đang tính toán thông số tuần tiếp theo...">
        <div className="py-8 space-y-3">
          <Skeleton className="h-6 w-3/4 mx-auto" />
          <Skeleton className="h-20 w-full" />
        </div>
      </Dialog>
    );
  }

  if (!data) return null;

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="⚡ Tự động tạo lịch trực tuần mới (1-Click)"
      description="Hệ thống tự động tính số tuần ISO, ngày Thứ Hai → Chủ Nhật và mốc chốt chuẩn y tế."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Sparkles className="h-4 w-4" /> Khởi tạo {data.name.split(" - ")[0]} ngay
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Banner tóm tắt tuần mới */}
        <div className="rounded-xl border border-teal-200 bg-teal-50/80 p-4 dark:border-teal-900 dark:bg-teal-950/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-600 text-white font-bold text-sm shadow">
                {data.week}
              </span>
              <div>
                <h4 className="font-bold text-teal-950 dark:text-teal-100">{data.name}</h4>
                <p className="text-xs text-teal-800 dark:text-teal-300">
                  {fmtDate(data.startDate)} (Thứ 2) → {fmtDate(data.endDate)} (Chủ nhật) · 7 ngày trọn vẹn
                </p>
              </div>
            </div>
            <Badge tone="info">Tuần {data.week}/{data.year}</Badge>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-teal-900 dark:text-teal-200 pt-2 border-t border-teal-200/60 dark:border-teal-800/60">
            <div>
              <span className="opacity-75">Mốc chốt tự động:</span>{" "}
              <strong className="font-semibold">{fmtDateTime(data.lockAt)}</strong>
            </div>
            <div>
              <span className="opacity-75">Trạng thái:</span>{" "}
              <span className="font-medium">Bản nháp (quản lý xem lại trước khi công bố)</span>
            </div>
          </div>
        </div>

        {/* Tùy chọn kế thừa */}
        <div className="space-y-2.5">
          <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Tùy chọn tự động hóa ô trực & phân công
          </Label>

          {data.lastPeriod ? (
            <div
              onClick={() => setMode("copy")}
              className={`cursor-pointer rounded-xl border p-3.5 transition-all ${
                mode === "copy"
                  ? "border-teal-600 bg-teal-50/40 ring-1 ring-teal-500 dark:bg-teal-950/30"
                  : "hover:bg-[var(--accent)]"
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name="gen-mode"
                  checked={mode === "copy"}
                  onChange={() => setMode("copy")}
                  className="mt-1"
                />
                <div className="flex-1 text-sm">
                  <div className="font-semibold flex items-center gap-2">
                    Sao chép cấu trúc từ tuần gần nhất ({data.lastPeriod.name})
                    <Badge tone="success">Khuyên dùng</Badge>
                  </div>
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                    Tự động tạo {data.lastPeriod.slotCount} ô trực theo đúng các phòng và ca trực của tuần trước.
                  </p>
                  {mode === "copy" && (
                    <div className="mt-3 pt-2.5 border-t border-dashed flex items-center gap-2">
                      <Switch checked={copyAssignments} onCheckedChange={setCopyAssignments} />
                      <span onClick={() => setCopyAssignments(!copyAssignments)} className="text-xs cursor-pointer font-medium">
                        Sao chép cả danh sách bác sĩ/nhân viên đã xếp tuần trước ({data.lastPeriod.filledCount} lượt trực)
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          <div
            onClick={() => setMode("auto")}
            className={`cursor-pointer rounded-xl border p-3.5 transition-all ${
              mode === "auto"
                ? "border-teal-600 bg-teal-50/40 ring-1 ring-teal-500 dark:bg-teal-950/30"
                : "hover:bg-[var(--accent)]"
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="radio"
                name="gen-mode"
                checked={mode === "auto"}
                onChange={() => setMode("auto")}
                className="mt-1"
              />
              <div className="flex-1 text-sm">
                <div className="font-semibold">Tự động sinh toàn bộ ô trực từ danh mục</div>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  Tạo ô trực cho mọi phòng khám và ca trực đang hoạt động trong toàn bộ 7 ngày của tuần (bỏ qua ngày nghỉ lễ).
                </p>
              </div>
            </div>
          </div>

          <div
            onClick={() => setMode("empty")}
            className={`cursor-pointer rounded-xl border p-3.5 transition-all ${
              mode === "empty"
                ? "border-teal-600 bg-teal-50/40 ring-1 ring-teal-500 dark:bg-teal-950/30"
                : "hover:bg-[var(--accent)]"
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="radio"
                name="gen-mode"
                checked={mode === "empty"}
                onChange={() => setMode("empty")}
                className="mt-1"
              />
              <div className="flex-1 text-sm">
                <div className="font-semibold">Chỉ tạo kỳ trống</div>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  Tạo khung kỳ lịch nháp, cấu hình ô trực thủ công sau.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Chỉnh sửa tên nếu muốn */}
        <div className="pt-2">
          <Label htmlFor="quick-name" className="text-xs">Tên kỳ lịch (tùy chỉnh nếu cần):</Label>
          <Input
            id="quick-name"
            placeholder={data.name}
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            className="mt-1 text-sm"
          />
        </div>
      </div>
    </Dialog>
  );
}

/* ================================================================== Nhân bản kỳ lịch */

export function ClonePeriodDialog({
  period,
  onClose,
  onCloned,
}: {
  period: DutyPeriod;
  onClose: () => void;
  onCloned: (newId: number) => void;
}) {
  const refresh = useRefreshDuty();
  const nextStart = addDaysYmd(period.endDate, 1);
  const dow = isoWeekday(nextStart);
  const start0 = dow === 1 ? nextStart : addDaysYmd(nextStart, 8 - dow);
  const end0 = addDaysYmd(start0, 6);

  const [startDate, setStartDate] = useState(start0);
  const [endDate, setEndDate] = useState(end0);
  const [name, setName] = useState(smartPeriodTitle(start0, end0));
  const [copyAssignments, setCopyAssignments] = useState(true);

  const clone = useMutation({
    mutationFn: () =>
      dutyApi.clonePeriod(period.id, {
        startDate,
        endDate,
        name: name.trim(),
        copyAssignments,
      }),
    onSuccess: (res) => {
      toast.success(`Đã nhân bản "${period.name}" sang "${res.name}" thành công!`);
      refresh();
      if (res.id) onCloned(res.id);
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title="Nhân bản kỳ lịch sang tuần mới"
      description={`Sao chép toàn bộ cấu trúc ô trực từ "${period.name}" sang khoảng ngày mới.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button onClick={() => clone.mutate()} disabled={clone.isPending}>
            <Copy className="h-4 w-4" /> Nhân bản ngay
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="cl-name">Tên kỳ lịch mới</Label>
          <Input id="cl-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="cl-start">Từ ngày</Label>
            <Input
              id="cl-start"
              type="date"
              value={startDate}
              onChange={(e) => {
                const s = e.target.value;
                setStartDate(s);
                const eDate = addDaysYmd(s, 6);
                setEndDate(eDate);
                setName(smartPeriodTitle(s, eDate));
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cl-end">Đến ngày</Label>
            <Input id="cl-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
        <div className="flex items-center gap-2 pt-2">
          <Switch checked={copyAssignments} onCheckedChange={setCopyAssignments} />
          <span onClick={() => setCopyAssignments(!copyAssignments)} className="cursor-pointer text-sm font-normal">
            Sao chép cả phân công người trực từ kỳ này
          </span>
        </div>
      </div>
    </Dialog>
  );
}
