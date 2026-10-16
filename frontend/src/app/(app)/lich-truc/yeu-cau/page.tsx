"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { AbsenceInbox } from "@/components/duty/absence-inbox";
import { OverrideDialog, ReviewDialog, useDutyActions } from "@/components/duty/duty-dialogs";
import { errorText, RequestStatusBadge } from "@/components/duty/duty-shared";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardBody, CardHeader, EmptyState, Skeleton } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { useRealtimeInvalidate } from "@/lib/realtime";
import { useAuth } from "@/lib/auth";
import { dutyApi, DUTY_KEYS, fmtDateTime, fmtDm, REQUEST_TYPE_LABEL, weekdayLabel, type RequestRow } from "@/lib/duty";
import { toast } from "sonner";
import { useMutation } from "@tanstack/react-query";

const dayOf = (ymd: string) => weekdayLabel(new Date(`${ymd}T00:00:00Z`).getUTCDay() || 7);

export default function YeuCauPage() {
  const can = useAuth((s) => s.can);
  const actions = useDutyActions();
  const canApprove = can("duty.swap.approve") || can("duty.exception.resolve");
  const isKhth = can("duty.exception.resolve");
  const canManageAbsence = can("duty.manage") || can("duty.manage-all");
  const [selectedTab, setTab] = useState<string>();
  const tab = selectedTab ?? (canManageAbsence ? "absences" : canApprove ? "approval" : "incoming");
  const [review, setReview] = useState<{ row: RequestRow; kind: "approve" | "reject" | "decline" } | null>(null);
  const [override, setOverride] = useState(false);

  useRealtimeInvalidate({ duty: [["duty-requests"], ["duty-grid"], ["duty-me"], ["duty-options"]] });

  const approval = useQuery({ queryKey: [...DUTY_KEYS.requests, "approval"], queryFn: () => dutyApi.requests("approval"), enabled: canApprove });
  const incoming = useQuery({ queryKey: [...DUTY_KEYS.requests, "incoming"], queryFn: () => dutyApi.requests("incoming"), enabled: can("duty.register") });
  const mine = useQuery({ queryKey: [...DUTY_KEYS.requests, "mine"], queryFn: () => dutyApi.requests("mine"), enabled: can("duty.register") });
  const all = useQuery({ queryKey: [...DUTY_KEYS.requests, "all"], queryFn: () => dutyApi.requests("all"), enabled: isKhth });

  const approve = useMutation({
    mutationFn: (v: { id: number; note: string; replacementUserId: number | null; force: boolean }) =>
      dutyApi.approveRequest(v.id, { note: v.note, replacementUserId: v.replacementUserId ?? undefined, force: v.force }),
    onSuccess: () => {
      toast.success("Đã duyệt yêu cầu");
      setReview(null);
      actions.refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const reject = useMutation({
    mutationFn: (v: { id: number; note: string }) => dutyApi.rejectRequest(v.id, v.note),
    onSuccess: () => {
      toast.success("Đã từ chối yêu cầu");
      setReview(null);
      actions.refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const counts = {
    approval: approval.data?.length ?? 0,
  };

  const Item = ({ r }: { r: RequestRow }) => (
    <li className="rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={r.type === "NGOAI_LE" ? "danger" : "brand"}>{REQUEST_TYPE_LABEL[r.type]}</Badge>
            <RequestStatusBadge status={r.status} />
            {r.urgent ? <Badge tone="danger">Khẩn</Badge> : null}
            <span className="text-xs text-[var(--muted-foreground)]">{r.periodName}</span>
          </div>
          <div className="mt-2 text-sm">
            <span className="font-semibold">{r.requesterName}</span>
            {r.type === "NHUONG" ? <> nhường ca cho <span className="font-semibold">{r.targetName}</span></> : null}
            {r.type === "DOI" ? <> đổi ca với <span className="font-semibold">{r.targetName}</span></> : null}
            {r.type === "NGOAI_LE" ? <> cần thay <span className="font-semibold">{r.targetName ?? r.requesterName}</span></> : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-[var(--muted-foreground)]">
            <span className="font-medium text-[var(--foreground)]">
              {dayOf(r.slotDate)} {fmtDm(r.slotDate)} · {r.roomCode} · {r.shiftCode} · {r.roleName}
            </span>
            {r.type === "DOI" && r.targetSlotDate ? (
              <span className="inline-flex items-center gap-1">
                <ArrowRightLeft className="h-3 w-3" /> {dayOf(r.targetSlotDate)} {fmtDm(r.targetSlotDate)} · {r.targetRoomCode} · {r.targetShiftCode}
              </span>
            ) : null}
            {r.replacementName ? <span>· Người thay đề xuất: {r.replacementName}</span> : null}
          </div>
          <p className="mt-2 text-[13px] leading-relaxed">“{r.reason}”</p>
          {r.responseNote ? <p className="mt-1 text-xs text-[var(--muted-foreground)]">Ghi chú xử lý: {r.responseNote}</p> : null}
          <div className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">Gửi lúc {fmtDateTime(r.createdAt)}{r.lockedNow ? " · Kỳ đã chốt" : ""}</div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {r.actions.canApprove ? (
            <Button size="sm" onClick={() => setReview({ row: r, kind: "approve" })}>
              Duyệt
            </Button>
          ) : null}
          {r.actions.canReject ? (
            <Button size="sm" variant="outline" onClick={() => setReview({ row: r, kind: "reject" })}>
              Từ chối
            </Button>
          ) : null}
          {r.actions.canAccept ? (
            <Button size="sm" onClick={() => actions.accept.mutate({ id: r.id })}>
              Đồng ý
            </Button>
          ) : null}
          {r.actions.canDecline ? (
            <Button size="sm" variant="outline" onClick={() => setReview({ row: r, kind: "decline" })}>
              Từ chối
            </Button>
          ) : null}
          {r.actions.canCancel ? (
            <Button size="sm" variant="ghost" onClick={() => actions.cancel.mutate({ id: r.id })}>
              Huỷ
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );

  const List = ({ rows, loading, empty }: { rows?: RequestRow[]; loading: boolean; empty: string }) => {
    if (loading) return <Skeleton className="h-40 w-full" />;
    if (!rows?.length) return <EmptyState title={empty} />;
    return <ul className="space-y-3">{rows.map((r) => <Item key={r.id} r={r} />)}</ul>;
  };

  const items = [
    ...(canManageAbsence ? [{ key: "absences", label: "Nghỉ / bận chờ duyệt", content: <AbsenceInbox /> }] : []),
    ...(canApprove
      ? [
          {
            key: "approval",
            label: "Chờ tôi duyệt",
            badge: counts.approval ? <Badge tone="warning">{counts.approval}</Badge> : undefined,
            content: <List rows={approval.data} loading={approval.isLoading} empty="Không có yêu cầu nào chờ duyệt" />,
          },
        ]
      : []),
    {
      key: "incoming",
      label: "Đến tôi",
      content: <List rows={incoming.data} loading={incoming.isLoading} empty="Không có đề nghị nào gửi tới bạn" />,
    },
    { key: "mine", label: "Của tôi", content: <List rows={mine.data} loading={mine.isLoading} empty="Bạn chưa gửi yêu cầu nào" /> },
    ...(isKhth
      ? [{ key: "all", label: "Tất cả", content: <List rows={all.data} loading={all.isLoading} empty="Chưa có yêu cầu nào" /> }]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Yêu cầu lịch trực"
        description="Duyệt nghỉ/bận và bố trí người thay, nhường/đổi ca và xử lý ngoại lệ sau khi chốt."
        actions={
          isKhth ? (
            <Button variant="outline" onClick={() => setOverride(true)}>
              <ShieldAlert className="h-4 w-4" /> Điều chỉnh trực tiếp
            </Button>
          ) : undefined
        }
      />
      <Card>
        <CardHeader title="Hộp yêu cầu" description={canApprove ? "Nhường/đổi ca trước khi chốt do Trưởng khoa duyệt; ngoại lệ sau khi chốt do KHTH duyệt." : undefined} />
        <CardBody>
          <Tabs value={tab} onChange={setTab} items={items} />
        </CardBody>
      </Card>

      {review ? (
        <ReviewDialog
          open
          onClose={() => setReview(null)}
          title={review.kind === "approve" ? (review.row.type === "NGOAI_LE" ? "Duyệt ngoại lệ" : "Duyệt đổi / nhường ca") : review.kind === "decline" ? "Từ chối đề nghị" : "Từ chối yêu cầu"}
          description={review.row.type === "NGOAI_LE" ? "Hệ thống sẽ gỡ người cần thay và xếp người thay. Nếu người thay vi phạm ràng buộc, bạn có thể bỏ qua kèm lý do." : "Sau khi duyệt, lịch trực được cập nhật ngay và thông báo tới các bên."}
          noteLabel={review.kind === "approve" ? "Ghi chú (không bắt buộc)" : "Lý do từ chối"}
          requireNote={review.kind === "reject"}
          confirmText={review.kind === "approve" ? "Duyệt" : "Từ chối"}
          tone={review.kind === "reject" ? "danger" : "default"}
          withReplacement={review.kind === "approve" && review.row.type === "NGOAI_LE"}
          loading={approve.isPending || reject.isPending}
          onConfirm={(note, replacementUserId, force) => {
            if (review.kind === "approve") approve.mutate({ id: review.row.id, note, replacementUserId, force });
            else if (review.kind === "decline") actions.decline.mutate({ id: review.row.id, note }, { onSuccess: () => setReview(null) });
            else reject.mutate({ id: review.row.id, note });
          }}
        />
      ) : null}

      <OverrideDialog open={override} onClose={() => setOverride(false)} />
    </>
  );
}
