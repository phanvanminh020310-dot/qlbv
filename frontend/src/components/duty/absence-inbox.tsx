"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Skeleton } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Label, Select, Textarea } from "@/components/ui/input";
import {
  ABSENCE_REASON_LABEL,
  DUTY_KEYS,
  dutyApi,
  fmtDate,
  type AbsenceRow,
} from "@/lib/duty";
import { useRealtimeInvalidate } from "@/lib/realtime";
import { useRefreshDuty } from "./duty-dialogs";
import { errorText } from "./duty-shared";

function ReviewAbsence({
  row,
  onClose,
}: {
  row: AbsenceRow;
  onClose: () => void;
}) {
  const refresh = useRefreshDuty();
  const detail = useQuery({
    queryKey: [...DUTY_KEYS.absenceRequests, "review", row.id],
    queryFn: () => dutyApi.absenceReview(row.id),
    staleTime: 0,
  });
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const save = useMutation({
    mutationFn: async () => {
      if (rejecting) return dutyApi.rejectAbsence(row.id, note.trim());
      return dutyApi.approveAbsence(row.id, {
        note: note.trim(),
        replacements: (detail.data?.affected ?? []).map((s) => ({
          slotId: s.slotId,
          assignmentId: s.assignmentId,
          replacementUserId: selected[s.slotId],
        })),
      });
    },
    onSuccess: () => {
      toast.success(
        rejecting
          ? "Đã từ chối; lịch trực giữ nguyên"
          : "Đã duyệt và bố trí đủ người thay",
      );
      refresh();
      onClose();
    },
    onError: (e) => {
      toast.error(errorText(e));
      void detail.refetch();
    },
  });
  const ready =
    detail.data?.canApprove &&
    detail.data.affected.every((s) =>
      s.candidates.some((c) => c.userId === selected[s.slotId]),
    );
  return (
    <Dialog
      open
      onClose={onClose}
      title={
        rejecting
          ? "Từ chối nghỉ / bận"
          : "Duyệt nghỉ / bận và bố trí người thay"
      }
      description={`${row.fullName} · ${fmtDate(row.startDate)} → ${fmtDate(row.endDate)}. Chỉ khi tất cả người thay hợp lệ, toàn bộ thay đổi mới được lưu.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Đóng
          </Button>
          <Button
            variant={rejecting ? "danger" : "default"}
            disabled={
              save.isPending ||
              detail.isLoading ||
              (rejecting ? note.trim().length < 3 : !ready)
            }
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? "Đang xử lý…"
              : rejecting
                ? "Xác nhận từ chối"
                : "Duyệt và thay đủ người"}
          </Button>
        </>
      }
    >
      {detail.isLoading ? (
        <Skeleton className="h-32" />
      ) : detail.error ? (
        <p className="text-sm text-red-700">{errorText(detail.error)}</p>
      ) : (
        <>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            Trong thời gian chờ duyệt, bác sĩ vẫn có trách nhiệm với lịch đã
            phân công. Không duyệt trống người hoặc bỏ qua ràng buộc chuyên
            môn/trùng ca.
          </div>
          {detail.data?.approvalBlockReason ? (
            <p className="mt-3 text-sm text-red-700">
              {detail.data.approvalBlockReason}
            </p>
          ) : null}
          {!rejecting ? (
            <div className="mt-4 max-h-[45vh] space-y-3 overflow-y-auto">
              {!detail.data?.affected.length ? (
                <p className="text-sm">
                  Không có ca chưa kết thúc cần thay. Phê duyệt chỉ ghi nhận
                  nghỉ chính thức.
                </p>
              ) : (
                detail.data.affected.map((s) => (
                  <div key={s.slotId} className="rounded-lg border p-3">
                    <Label htmlFor={`absence-replacement-${s.slotId}`}>
                      {fmtDate(s.dutyDate)} · {s.roomCode} · {s.shiftCode} ·{" "}
                      {s.roleName}
                    </Label>
                    <Select
                      id={`absence-replacement-${s.slotId}`}
                      className="mt-2"
                      value={selected[s.slotId] ?? ""}
                      onChange={(e) =>
                        setSelected((v) => ({
                          ...v,
                          [s.slotId]: Number(e.target.value),
                        }))
                      }
                    >
                      <option value="">Chọn bác sĩ thay hợp lệ…</option>
                      {s.candidates.map((c) => (
                        <option key={c.userId} value={c.userId}>
                          {c.title} {c.fullName}
                        </option>
                      ))}
                    </Select>
                    {!s.candidates.length ? (
                      <p className="mt-1 text-xs text-red-700">
                        Chưa có ứng viên đủ điều kiện. Giữ yêu cầu chờ xử lý,
                        không để trống ca.
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          ) : null}
          <div className="mt-4 space-y-1.5">
            <Label htmlFor="absence-review-note">
              {rejecting ? "Lý do từ chối (bắt buộc)" : "Ghi chú phê duyệt"}
            </Label>
            <Textarea
              id="absence-review-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              rows={3}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            disabled={save.isPending}
            onClick={() => setRejecting((v) => !v)}
          >
            {rejecting
              ? "Quay lại duyệt và chọn người thay"
              : "Không phê duyệt — nhập lý do từ chối"}
          </Button>
        </>
      )}
    </Dialog>
  );
}

export function AbsenceInbox() {
  const query = useQuery({
    queryKey: [...DUTY_KEYS.absenceRequests, "approval"],
    queryFn: () => dutyApi.absenceRequests("approval"),
  });
  useRealtimeInvalidate({ duty: [["duty-absence-requests"]] });
  const [review, setReview] = useState<AbsenceRow | null>(null);
  return (
    <>
      <p className="mb-4 text-sm text-[var(--muted-foreground)]">
        Báo nghỉ/bận không tự hủy ca. Quản lý phải duyệt và chọn người thay cho
        mọi ca bị ảnh hưởng; ca đã chốt hoặc đang trực cần quyền xử lý ngoại lệ
        của KHTH.
      </p>
      {query.isLoading ? (
        <Skeleton className="h-32" />
      ) : query.error ? (
        <p className="text-sm text-red-700">{errorText(query.error)}</p>
      ) : !query.data?.length ? (
        <EmptyState title="Không có yêu cầu nghỉ / bận chờ duyệt" />
      ) : (
        <ul className="space-y-3">
          {query.data.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{row.fullName}</strong>
                  <Badge tone="warning">Chờ duyệt · Giữ nguyên ca</Badge>
                </div>
                <p className="mt-1 text-sm">
                  {fmtDate(row.startDate)} → {fmtDate(row.endDate)} ·{" "}
                  {ABSENCE_REASON_LABEL[row.reason] ?? row.reason}
                </p>
                {row.note ? (
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    {row.note}
                  </p>
                ) : null}
              </div>
              {row.actions?.canApprove ? (
                <Button size="sm" onClick={() => setReview(row)}>
                  Xem ca & bố trí người thay
                </Button>
              ) : (
                <span className="text-xs text-[var(--muted-foreground)]">
                  Cần người quản lý khác xử lý
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {review ? (
        <ReviewAbsence
          key={review.id}
          row={review}
          onClose={() => setReview(null)}
        />
      ) : null}
    </>
  );
}
