"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Lock, PencilLine, Send } from "lucide-react";
import type { ReactNode } from "react";
import { ApiRequestError } from "@/lib/api";
import {
  DUTY_KEYS,
  dutyApi,
  fmtDateTime,
  PHASE_LABEL,
  PHASE_TONE,
  REQUEST_STATUS_LABEL,
  REQUEST_STATUS_TONE,
  type DutyPeriod,
  type RequestStatus,
} from "@/lib/duty";
import { Badge } from "@/components/ui/card";
import { Select } from "@/components/ui/input";

/** Thông báo lỗi thân thiện từ API */
export function errorText(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  if (e instanceof Error) return e.message;
  return "Có lỗi xảy ra, vui lòng thử lại";
}

/** Huy hiệu mã ca với màu của ca */
export function ShiftChip({ code, color, className = "" }: { code: string; color?: string; className?: string }) {
  return (
    <span
      className={`inline-flex min-w-[2.25rem] items-center justify-center rounded-md px-1.5 py-0.5 text-[11px] font-bold leading-none text-white ${className}`}
      style={{ background: color || "#0F766E" }}
    >
      {code}
    </span>
  );
}

export function PhaseBadge({ period }: { period: Pick<DutyPeriod, "phase"> }) {
  return <Badge tone={PHASE_TONE[period.phase]}>{PHASE_LABEL[period.phase]}</Badge>;
}

/** Huy hiệu Tuần này (Current week indicator) */
export function CurrentWeekBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
      Đang diễn ra
    </span>
  );
}

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return <Badge tone={REQUEST_STATUS_TONE[status]}>{REQUEST_STATUS_LABEL[status]}</Badge>;
}

/** Thông điệp trạng thái kỳ lịch — hiển thị đầu trang lịch */
export function PhaseBanner({ period, canManage }: { period: DutyPeriod; canManage: boolean }): ReactNode {
  const cfg =
    period.phase === "NHAP"
      ? {
          cls: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200",
          icon: <PencilLine className="mt-0.5 h-4.5 w-4.5 shrink-0" />,
          title: "Bản nháp — chưa công bố",
          text: canManage
            ? "Hoàn tất phân công rồi công bố để nhân viên xem và đăng ký ca."
            : "Lịch đang được lập, sẽ được công bố sớm.",
        }
      : period.phase === "MO"
        ? {
            cls: "border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-100",
            icon: <Send className="mt-0.5 h-4.5 w-4.5 shrink-0" />,
            title: "Đã công bố — còn có thể điều chỉnh",
            text: `Chốt lịch lúc ${fmtDateTime(period.lockAt)}. Sau mốc này, đổi trực phải qua yêu cầu ngoại lệ gửi KHTH.`,
          }
        : {
            cls: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100",
            icon: <Lock className="mt-0.5 h-4.5 w-4.5 shrink-0" />,
            title: "Lịch đã chốt",
            text: `Chốt lúc ${fmtDateTime(period.lockedAt ?? period.lockAt)}. Cần đổi trực: gửi yêu cầu ngoại lệ tới KHTH (có thể đánh dấu khẩn).`,
          };
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${cfg.cls}`} role="status">
      {cfg.icon}
      <div className="min-w-0">
        <div className="text-sm font-semibold">{cfg.title}</div>
        <div className="text-[13px] opacity-90">{cfg.text}</div>
      </div>
    </div>
  );
}

/** Ô chọn nhân viên từ danh bạ (nguồn: /duty/staff) */
export function StaffSelect({
  value,
  onChange,
  exclude = [],
  placeholder = "— Chọn nhân viên —",
  id,
  disabled,
}: {
  value: number | null | undefined;
  onChange: (id: number | null) => void;
  exclude?: number[];
  placeholder?: string;
  id?: string;
  disabled?: boolean;
}) {
  const { data = [] } = useQuery({
    queryKey: DUTY_KEYS.staff,
    queryFn: () => dutyApi.staff(),
    staleTime: 60_000,
  });
  return (
    <Select
      id={id}
      disabled={disabled}
      value={value ? String(value) : ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">{placeholder}</option>
      {data
        .filter((u) => !exclude.includes(u.id))
        .map((u) => (
          <option key={u.id} value={u.id}>
            {u.fullName}
            {u.title ? ` — ${u.title}` : ""}
            {u.departmentName ? ` (${u.departmentName})` : ""}
          </option>
        ))}
    </Select>
  );
}

/** Cảnh báo nhỏ dạng khối (lỗi/cảnh báo ràng buộc) */
export function ViolationList({ errors = [], warnings = [] }: { errors?: string[]; warnings?: string[] }) {
  if (!errors.length && !warnings.length) return null;
  return (
    <div className="mt-1 space-y-0.5 text-[12px] leading-snug">
      {errors.map((m, i) => (
        <div key={`e${i}`} className="text-rose-600 dark:text-rose-400">
          • {m}
        </div>
      ))}
      {warnings.map((m, i) => (
        <div key={`w${i}`} className="flex items-start gap-1 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{m}</span>
        </div>
      ))}
    </div>
  );
}

/** Dải thống kê nhỏ (KPI) */
export function KpiTile({ label, value, hint, tone = "default" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "success" | "warning" | "danger" | "info" }) {
  const color: Record<string, string> = {
    default: "text-[var(--foreground)]",
    success: "text-emerald-600 dark:text-emerald-400",
    warning: "text-amber-600 dark:text-amber-400",
    danger: "text-rose-600 dark:text-rose-400",
    info: "text-teal-600 dark:text-teal-400",
  };
  return (
    <div className="rounded-xl border bg-[var(--card)] p-3.5 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${color[tone]}`}>{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">{hint}</div> : null}
    </div>
  );
}

/** Nhãn nguồn gốc phân công */
export function SourceTag({ source }: { source: string }) {
  const map: Record<string, string> = {
    DANG_KY: "Tự đăng ký",
    PHAN_CONG: "",
    NHUONG: "Nhận nhường",
    DOI: "Đổi ca",
    NGOAI_LE: "Thay (ngoại lệ)",
    DIEU_CHINH: "Điều chỉnh",
  };
  const text = map[source] ?? "";
  if (!text) return null;
  return <span className="ml-1 rounded bg-[var(--muted)] px-1 py-px text-[10px] text-[var(--muted-foreground)]">{text}</span>;
}
