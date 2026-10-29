"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { ABSENCE_REASON_LABEL, bkkTodayYmd, dutyApi } from "@/lib/duty";
import { errorText } from "./duty-shared";
import { useRefreshDuty } from "./duty-dialogs";

/** Báo nghỉ/bận chỉ là yêu cầu; lịch chính thức giữ nguyên đến khi duyệt và thay người. */
export function AbsenceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const refresh = useRefreshDuty();
  const today = bkkTodayYmd();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState("PHEP_NAM");
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => dutyApi.createAbsence({ startDate, endDate, reason, note: note.trim() }),
    onSuccess: () => {
      toast.success("Đã gửi yêu cầu chờ duyệt. Ca khám hiện tại vẫn giữ nguyên.");
      refresh();
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Báo nghỉ / bận"
      description="Đây là yêu cầu chờ quản lý duyệt. Bạn vẫn chịu trách nhiệm ca đã phân công cho đến khi quản lý duyệt và bố trí đủ bác sĩ thay thế."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button
            disabled={save.isPending}
            onClick={() => {
              if (startDate > endDate) return toast.error("Ngày bắt đầu phải trước hoặc trùng ngày kết thúc");
              save.mutate();
            }}
          >
            Gửi yêu cầu
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ab-start">Từ ngày</Label>
          <Input id="ab-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ab-end">Đến ngày</Label>
          <Input id="ab-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ab-reason">Lý do</Label>
          <Select id="ab-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
            {Object.entries(ABSENCE_REASON_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ab-note">Ghi chú</Label>
          <Textarea id="ab-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
    </Dialog>
  );
}
