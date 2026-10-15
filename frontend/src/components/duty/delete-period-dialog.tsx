"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DUTY_KEYS, dutyApi, fmtDate, type DutyPeriod } from "@/lib/duty";
import { errorText } from "./duty-shared";

/** Xoá cả kỳ lịch: Hộp thoại xác nhận xoá nhanh, không cần gõ lại tên kỳ. */
export function DeletePeriodDialog({
  period,
  onClose,
  onDeleted,
}: {
  period: DutyPeriod;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const published = period.status !== "NHAP";

  const mut = useMutation({
    mutationFn: () =>
      dutyApi.deletePeriod(period.id, {
        reason: "Xoá kỳ lịch trực",
        confirmName: period.name,
      }),
    onSuccess: (r) => {
      toast.success(r.notified ? `Đã xoá kỳ lịch và báo ${r.notified} nhân viên liên quan` : "Đã xoá kỳ lịch thành công");
      qc.invalidateQueries({ queryKey: DUTY_KEYS.periods });
      onDeleted();
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Xác nhận xoá kỳ lịch trực"
      description={`${period.name} · ${fmtDate(period.startDate)} – ${fmtDate(period.endDate)}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mut.isPending}>
            Huỷ bỏ
          </Button>
          <Button
            variant="danger"
            disabled={mut.isPending}
            onClick={() => mut.mutate()}
            className="gap-1.5"
          >
            <Trash2 className="h-4 w-4" />
            {mut.isPending ? "Đang xoá…" : "Xác nhận xoá"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
          <div className="space-y-1.5">
            <p className="font-semibold text-rose-950 dark:text-rose-200">
              Bạn có chắc chắn muốn xoá kỳ lịch &quot;{period.name}&quot;?
            </p>
            <p className="text-xs text-rose-800 dark:text-rose-300">
              Thao tác này sẽ xoá hoàn toàn <strong>{period.slotCount ?? 0} ô trực</strong> và{" "}
              <strong>{period.filledCount ?? 0} lượt phân công</strong> trong kỳ.
            </p>
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-rose-700 dark:text-rose-300/80">
              {published ? (
                <li>Nhân viên đã được xếp ca trong kỳ sẽ được thông báo huỷ lịch.</li>
              ) : (
                <li>Kỳ nháp chưa công bố nên nhân viên không nhận thông báo.</li>
              )}
              <li>Nhật ký thao tác được lưu trữ lại để đối soát hệ thống.</li>
              <li>Không xoá được nếu đã có ca trực đã diễn ra hoặc đang diễn ra.</li>
            </ul>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
