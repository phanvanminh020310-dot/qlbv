"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarOff, Check, ChevronRight, Plus, Siren, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AbsenceDialog } from "@/components/duty/absence-dialog";
import { RequestDialog, ReviewDialog, useDutyActions } from "@/components/duty/duty-dialogs";
import { errorText, KpiTile, RequestStatusBadge, ShiftChip, SourceTag, ViolationList } from "@/components/duty/duty-shared";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardBody, CardHeader, EmptyState, Skeleton } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { useRealtimeInvalidate } from "@/lib/realtime";
import { useAuth } from "@/lib/auth";
import {
  ABSENCE_REASON_LABEL,
  bkkTodayYmd,
  DUTY_KEYS,
  dutyApi,
  fmtDate,
  fmtDateTime,
  fmtDm,
  REQUEST_TYPE_LABEL,
  weekdayLabel,
  type GridSlot,
  type MySlot,
  type RequestRow,
  type RequestType,
} from "@/lib/duty";

const dayOf = (ymd: string) => weekdayLabel(new Date(`${ymd}T00:00:00Z`).getUTCDay() || 7);

/** Một yêu cầu trong danh sách: người gửi/người nhận, ca, trạng thái và các thao tác được phép */
function RequestItem({ r, onAccept, onDecline, onCancel }: { r: RequestRow; onAccept?: () => void; onDecline?: () => void; onCancel?: () => void }) {
  return (
    <li className="rounded-xl border p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={r.type === "NGOAI_LE" ? "danger" : "brand"}>{REQUEST_TYPE_LABEL[r.type]}</Badge>
          <RequestStatusBadge status={r.status} />
          {r.urgent ? <Badge tone="danger">Khẩn</Badge> : null}
        </div>
        <span className="text-[11px] text-[var(--muted-foreground)]">{fmtDateTime(r.createdAt)}</span>
      </div>
      <div className="mt-2 text-sm">
        <span className="font-medium">{r.requesterName}</span>
        {r.type === "NHUONG" && r.targetName ? <> nhường ca cho <span className="font-medium">{r.targetName}</span></> : null}
        {r.type === "DOI" && r.targetName ? <> đề nghị đổi ca với <span className="font-medium">{r.targetName}</span></> : null}
        {r.type === "NGOAI_LE" ? <> báo sự cố — cần thay <span className="font-medium">{r.targetName ?? r.requesterName}</span></> : null}
        {r.replacementName ? <> · người thay đề xuất: <span className="font-medium">{r.replacementName}</span></> : null}
      </div>
      <div className="mt-1 text-xs text-[var(--muted-foreground)]">
        Ca: {dayOf(r.slotDate)} {fmtDm(r.slotDate)} · {r.roomCode} · {r.shiftCode} · {r.roleName}
        {r.type === "DOI" && r.targetSlotDate ? ` ↔ ${dayOf(r.targetSlotDate)} ${fmtDm(r.targetSlotDate)} · ${r.targetRoomCode} · ${r.targetShiftCode}` : ""}
        {r.periodName ? ` · ${r.periodName}` : ""}
      </div>
      <p className="mt-1.5 text-[13px]">“{r.reason}”</p>
      {r.responseNote ? <p className="mt-1 text-xs text-[var(--muted-foreground)]">Phản hồi: {r.responseNote}</p> : null}
      {(onAccept || onDecline || onCancel) && (r.actions.canAccept || r.actions.canDecline || r.actions.canCancel) ? (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          {r.actions.canAccept && onAccept ? (
            <Button size="sm" onClick={onAccept}>
              <Check className="h-4 w-4" /> Đồng ý
            </Button>
          ) : null}
          {r.actions.canDecline && onDecline ? (
            <Button size="sm" variant="outline" onClick={onDecline}>
              <X className="h-4 w-4" /> Từ chối
            </Button>
          ) : null}
          {r.actions.canCancel && onCancel ? (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Huỷ yêu cầu
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export default function LichCuaToiPage() {
  const can = useAuth((s) => s.can);
  const myId = useAuth((s) => s.user?.id);
  const actions = useDutyActions();
  const today = bkkTodayYmd();
  const canView = can("duty.view");
  const canRegister = can("duty.register");

  const me = useQuery({ queryKey: DUTY_KEYS.me, queryFn: () => dutyApi.me(), enabled: canView });
  const absences = useQuery({ queryKey: [...DUTY_KEYS.absences, "mine"], queryFn: () => dutyApi.absences({ from: today }), enabled: canView });
  const mine = useQuery({ queryKey: [...DUTY_KEYS.requests, "mine"], queryFn: () => dutyApi.requests("mine"), enabled: canRegister });
  const incoming = useQuery({ queryKey: [...DUTY_KEYS.requests, "incoming"], queryFn: () => dutyApi.requests("incoming"), enabled: canRegister });

  const [periodId, setPeriodId] = useState<number | null>(null);
  const [reqCtx, setReqCtx] = useState<{ mode: RequestType; slotId: number; periodId: number } | null>(null);
  const [absenceOpen, setAbsenceOpen] = useState(false);
  const [declineId, setDeclineId] = useState<number | null>(null);
  const [tab, setTab] = useState("incoming");

  useRealtimeInvalidate({
    duty: [["duty-me"], ["duty-grid"], ["duty-options"], ["duty-requests"], ["duty-absences"], ["duty-periods"]],
  });

  // Kỳ mặc định: kỳ đang mở gần nhất
  const openPeriods = useMemo(() => (me.data?.periods ?? []).filter((p) => p.status !== "NHAP"), [me.data]);
  useEffect(() => {
    if (periodId === null && openPeriods.length) {
      const current = openPeriods.find((p) => p.startDate <= today && p.endDate >= today) ?? openPeriods[0];
      setPeriodId(current.id);
    }
  }, [openPeriods, periodId, today]);

  const grid = useQuery({ queryKey: DUTY_KEYS.grid(periodId ?? 0), queryFn: () => dutyApi.grid(periodId as number), enabled: canView && !!periodId });
  const opts = useQuery({
    queryKey: DUTY_KEYS.myOptions(periodId ?? 0),
    queryFn: () => dutyApi.myOptions(periodId as number),
    enabled: canRegister && !!periodId,
  });
  const reqGrid = useQuery({
    queryKey: DUTY_KEYS.grid(reqCtx?.periodId ?? 0),
    queryFn: () => dutyApi.grid(reqCtx!.periodId),
    enabled: !!reqCtx,
  });

  const register = useMutation({
    mutationFn: (slotId: number) => dutyApi.register(slotId),
    onSuccess: () => {
      toast.success("Đã đăng ký ca trực");
      actions.refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const cancelReg = useMutation({
    mutationFn: (slotId: number) => dutyApi.unregister(slotId),
    onSuccess: () => {
      toast.success("Đã huỷ đăng ký ca");
      actions.refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const deleteAbsence = useMutation({
    mutationFn: (id: number) => dutyApi.cancelAbsence(id),
    onSuccess: () => {
      toast.success("Đã rút yêu cầu nghỉ/bận; lịch trực không thay đổi");
      actions.refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });

  if (!canView) return <EmptyState title="Bạn chưa có quyền xem lịch trực" />;

  const upcoming: MySlot[] = (me.data?.assignments ?? []).filter((s) => !s.past);
  const pendingIncoming = (incoming.data ?? []).filter((r) => r.actions.canAccept).length;
  const curPeriod = openPeriods.find((p) => p.id === periodId);
  const g = grid.data;
  const optMap = new Map((opts.data?.items ?? []).map((i) => [i.slotId, i]));
  const slotsByDate = new Map<string, GridSlot[]>();
  for (const s of g?.slots ?? []) {
    const list = slotsByDate.get(s.dutyDate) ?? [];
    list.push(s);
    slotsByDate.set(s.dutyDate, list);
  }
  const openReqSlots = upcoming.map((s) => ({ id: s.id, label: `${fmtDm(s.dutyDate)} · ${s.roomCode} · ${s.shiftCode} · ${s.roleName}` }));

  return (
    <>
      <PageHeader
        title="Lịch của tôi"
        description="Ca trực sắp tới, đăng ký ca trống, báo nghỉ phép và các đề nghị đổi ca."
        actions={
          <Button variant="outline" onClick={() => setAbsenceOpen(true)}>
            <CalendarOff className="h-4 w-4" /> Báo nghỉ / bận
          </Button>
        }
      />

      {me.isLoading ? <Skeleton className="h-32 w-full" /> : null}

      {me.data ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile label="Ca sắp tới" value={upcoming.length} hint={upcoming[0] ? `Tiếp theo: ${dayOf(upcoming[0].dutyDate)} ${fmtDm(upcoming[0].dutyDate)}` : "Chưa có ca"} tone="info" />
            <KpiTile label="Đề nghị chờ bạn" value={pendingIncoming} tone={pendingIncoming ? "warning" : "default"} hint="Nhường / đổi ca đến bạn" />
            <KpiTile label="Nghỉ / bận sắp tới" value={absences.data?.length ?? 0} hint="Yêu cầu chờ duyệt và nghỉ đã duyệt" />
            <KpiTile label="Kỳ đang mở" value={openPeriods.length} hint={curPeriod ? curPeriod.name : "Chưa có kỳ mở"} />
          </div>

          <div className="grid items-start gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader title="Ca trực sắp tới" description="Bấm nhường/đổi để gửi đề nghị. Ca tự đăng ký có thể huỷ trước giờ trực." />
              <CardBody>
                {upcoming.length === 0 ? (
                  <EmptyState title="Bạn chưa có ca trực sắp tới" description="Đăng ký ca trống bên dưới hoặc chờ Điều phối xếp lịch." />
                ) : (
                  <ul className="space-y-2">
                    {upcoming.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="w-14 shrink-0 text-center">
                            <div className="text-lg font-bold leading-none tabular-nums">{fmtDm(s.dutyDate).slice(0, 5)}</div>
                            <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">{dayOf(s.dutyDate)}</div>
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <ShiftChip code={s.shiftCode} color={s.shiftColor} />
                              <span className="truncate text-sm font-medium">
                                {s.roomCode} · {s.roomName}
                              </span>
                            </div>
                            <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                              {s.startTime}–{s.endTime} · {s.roleName}
                              <SourceTag source={s.source} />
                              {s.locked ? <span className="ml-1.5 text-emerald-600">· Đã chốt</span> : null}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-1.5">
                          {s.canSelfCancel ? (
                            <Button size="sm" variant="ghost" disabled={cancelReg.isPending} onClick={() => cancelReg.mutate(s.id)}>
                              Huỷ đăng ký
                            </Button>
                          ) : null}
                          {s.canRequestSwap ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setReqCtx({ mode: "NHUONG", slotId: s.id, periodId: s.periodId })}
                            >
                              Nhường / đổi <ChevronRight className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {upcoming.length ? (
                  <div className="mt-3 flex justify-end">
                    <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => setReqCtx({ mode: "NGOAI_LE", slotId: upcoming[0].id, periodId: upcoming[0].periodId })}>
                      <Siren className="h-4 w-4" /> Báo sự cố / thay trực
                    </Button>
                  </div>
                ) : null}
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Đăng ký ca trống"
                description="Chỉ đăng ký được khi kỳ đã công bố, chưa chốt và ca còn trống."
                actions={
                  <Select className="h-8 w-56 text-xs" aria-label="Chọn kỳ" value={periodId ? String(periodId) : ""} onChange={(e) => setPeriodId(Number(e.target.value))}>
                    {openPeriods.length === 0 ? <option value="">Chưa có kỳ mở</option> : null}
                    {openPeriods.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                }
              />
              <CardBody>
                {opts.data?.blocked ? (
                  <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    {opts.data.blocked}
                  </div>
                ) : null}
                {!openPeriods.length ? (
                  <EmptyState title="Chưa có kỳ lịch mở" description="Khi kỳ lịch được công bố, các ca trống sẽ hiện ở đây." />
                ) : grid.isLoading ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                    {[...slotsByDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => (
                      <div key={date}>
                        <div className="sticky top-0 z-[1] mb-1.5 bg-[var(--card)] text-xs font-semibold text-[var(--muted-foreground)]">
                          {dayOf(date)} · {fmtDate(date)}
                          {g?.days.find((d) => d.date === date)?.closed ? <span className="ml-2 text-rose-600">Nghỉ lễ</span> : null}
                        </div>
                        <ul className="space-y-1.5">
                          {list
                            .sort((a, b) => a.start - b.start)
                            .map((s) => {
                              const o = optMap.get(s.id);
                              const isMine = !!o?.mine;
                              const full = s.filled >= s.requiredCount;
                              const can = !!o?.canRegister && !isMine && !full && !s.past;
                              return (
                                <li key={s.id} className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 ${isMine ? "border-[var(--primary)] bg-[var(--accent)]" : ""}`}>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 text-sm">
                                      <ShiftChip code={s.shiftCode} color={s.shiftColor} />
                                      <span className="truncate">
                                        {s.roomCode} · {s.roleName}
                                      </span>
                                      <span className="text-[11px] text-[var(--muted-foreground)]">
                                        {s.filled}/{s.requiredCount}
                                      </span>
                                    </div>
                                    {!isMine && !can && o?.errors?.length ? <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">{o.errors[0]}</div> : null}
                                    {o?.warnings?.length && can ? <ViolationList warnings={o.warnings} /> : null}
                                  </div>
                                  {isMine ? (
                                    <Badge tone="brand">Của bạn</Badge>
                                  ) : can && canRegister ? (
                                    <Button size="sm" disabled={register.isPending} onClick={() => register.mutate(s.id)}>
                                      <Plus className="h-3.5 w-3.5" /> Đăng ký
                                    </Button>
                                  ) : (
                                    <Badge tone="muted">{full ? "Đủ người" : "Chưa mở"}</Badge>
                                  )}
                                </li>
                              );
                            })}
                        </ul>
                      </div>
                    ))}
                    {!slotsByDate.size && !grid.isLoading ? <EmptyState title="Kỳ này chưa có ca trống" /> : null}
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="grid items-start gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader title="Nghỉ phép / bận sắp tới" description="Chờ duyệt không hủy ca. Chỉ sau khi quản lý duyệt và bố trí người thay mới thay đổi lịch." />
              <CardBody>
                {(absences.data ?? []).length === 0 ? (
                  <EmptyState title="Chưa báo nghỉ" description="Báo nghỉ sớm giúp Điều phối sắp xếp người thay." />
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {(absences.data ?? []).map((a) => (
                      <li key={`${a.kind ?? "APPROVED"}:${a.id}`} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                        <div>
                          <div className="font-medium">
                            {fmtDate(a.startDate)} → {fmtDate(a.endDate)}
                          </div>
                          <div className="text-xs text-[var(--muted-foreground)]">
                            {ABSENCE_REASON_LABEL[a.reason] ?? a.reason}
                            {a.note ? ` · ${a.note}` : ""}
                            {a.responseNote ? ` · Xử lý: ${a.responseNote}` : ""}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge tone={a.status === "CHO_DUYET" ? "warning" : a.status === "TU_CHOI" ? "danger" : a.status === "DA_DUYET" ? "success" : "muted"}>
                            {a.status === "CHO_DUYET" ? "Chờ duyệt · Giữ nguyên ca" : a.status === "TU_CHOI" ? "Từ chối" : a.status === "HUY" ? "Đã rút yêu cầu" : "Đã duyệt"}
                          </Badge>
                          {a.actions?.canCancel ? <Button size="sm" variant="ghost" onClick={() => deleteAbsence.mutate(a.id)} title="Rút yêu cầu đang chờ"><Trash2 className="h-4 w-4" /></Button> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Đề nghị & yêu cầu" description="Nhường/đổi ca cần người nhận đồng ý; ngoại lệ do KHTH xử lý." />
              <CardBody>
                <Tabs
                  value={tab}
                  onChange={setTab}
                  items={[
                    {
                      key: "incoming",
                      label: "Đến tôi",
                      badge: pendingIncoming ? <Badge tone="warning">{pendingIncoming}</Badge> : undefined,
                      content: (
                        <RequestList
                          rows={(incoming.data ?? []).filter((r) => r.status === "CHO_NGUOI_NHAN" || r.actions.canAccept)}
                          empty="Không có đề nghị nào chờ bạn"
                          loading={incoming.isLoading}
                          onAccept={(id) => actions.accept.mutate({ id })}
                          onDecline={(id) => setDeclineId(id)}
                        />
                      ),
                    },
                    {
                      key: "mine",
                      label: "Của tôi",
                      content: (
                        <RequestList
                          rows={mine.data ?? []}
                          empty="Bạn chưa gửi yêu cầu nào"
                          loading={mine.isLoading}
                          onCancel={(id) => actions.cancel.mutate({ id })}
                        />
                      ),
                    },
                  ]}
                />
              </CardBody>
            </Card>
          </div>
        </div>
      ) : null}

      <AbsenceDialog open={absenceOpen} onClose={() => setAbsenceOpen(false)} />

      {declineId ? (
        <ReviewDialog
          open
          onClose={() => setDeclineId(null)}
          title="Từ chối đề nghị đổi ca"
          description="Người đề nghị sẽ được thông báo. Nêu lý do giúp họ hiểu rõ hơn (không bắt buộc)."
          noteLabel="Lý do"
          requireNote={false}
          confirmText="Từ chối"
          tone="danger"
          loading={actions.decline.isPending}
          onConfirm={(note) => actions.decline.mutate({ id: declineId, note }, { onSuccess: () => setDeclineId(null) })}
        />
      ) : null}

      {reqCtx ? (
        <RequestDialog
          key={`${reqCtx.mode}-${reqCtx.slotId}`}
          open
          onClose={() => setReqCtx(null)}
          mode={reqCtx.mode}
          initialSlotId={reqCtx.slotId}
          slotChoices={openReqSlots}
          grid={reqGrid.data ?? null}
          meId={myId}
        />
      ) : null}
    </>
  );
}

function RequestList({
  rows,
  empty,
  loading,
  onAccept,
  onDecline,
  onCancel,
}: {
  rows: RequestRow[];
  empty: string;
  loading: boolean;
  onAccept?: (id: number) => void;
  onDecline?: (id: number) => void;
  onCancel?: (id: number) => void;
}) {
  if (loading) return <Skeleton className="h-32 w-full" />;
  if (!rows.length) return <EmptyState title={empty} />;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <RequestItem
          key={r.id}
          r={r}
          onAccept={onAccept ? () => onAccept(r.id) : undefined}
          onDecline={onDecline ? () => onDecline(r.id) : undefined}
          onCancel={onCancel ? () => onCancel(r.id) : undefined}
        />
      ))}
    </ul>
  );
}

