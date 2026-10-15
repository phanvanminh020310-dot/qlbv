"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Save, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Badge, Card, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input, Label, Switch, Textarea } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

interface SettingItem {
  id: number;
  key: string;
  value: unknown;
  group: string;
  label: string | null;
  description: string | null;
  valueType: string | null;
  isPublic: boolean;
}

interface SettingsResponse {
  items: SettingItem[];
  groups: { group: string; items: SettingItem[] }[];
}

const GROUP_LABEL: Record<string, string> = {
  hospital: "Thông tin bệnh viện",
  hsba: "Hồ sơ bệnh án",
  report: "Báo cáo",
  print: "Bản in",
  export: "Kết xuất tệp",
  notification: "Thông báo",
  kiosk: "Kiosk & Điểm danh",
  system: "Hệ thống",
};

const GROUP_ICON: Record<string, string> = {
  hospital: "🏥",
  hsba: "📋",
  report: "📊",
  print: "🖨️",
  export: "📤",
  notification: "🔔",
  kiosk: "🖥️",
  system: "⚙️",
};

/** Cấu hình hệ thống — mọi tham số đều sửa được từ giao diện, không hard-code. */
export default function SettingsPage() {
  const can = useAuth((s) => s.can);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<SettingsResponse>("/settings"),
  });

  const groups = data?.groups ?? [];

  useEffect(() => {
    if (!activeGroup && groups.length) setActiveGroup(groups[0].group);
  }, [groups, activeGroup]);

  const dirtyCount = useMemo(() => Object.keys(draft).length, [draft]);

  const save = useMutation({
    mutationFn: () =>
      apiFetch("/settings", {
        method: "PUT",
        body: {
          items: Object.entries(draft).map(([key, value]) => {
            const original = data?.items.find((i) => i.key === key);
            return {
              key,
              value,
              group: original?.group,
              label: original?.label ?? undefined,
              valueType: original?.valueType ?? undefined,
            };
          }),
        },
      }),
    onSuccess: async () => {
      toast.success(`Đã lưu ${dirtyCount} thay đổi`);
      setDraft({});
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const reset = useMutation({
    mutationFn: () => apiFetch("/settings/reset", { method: "POST" }),
    onSuccess: async () => {
      toast.success("Đã khôi phục cấu hình mặc định");
      setConfirmReset(false);
      setDraft({});
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const valueOf = (item: SettingItem): unknown =>
    item.key in draft ? draft[item.key] : item.value;

  const isTruthy = (v: unknown): boolean => {
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      return s === "true" || s === "1" || s === "yes" || s === "on";
    }
    if (typeof v === "number") return v === 1;
    return false;
  };

  const renderField = (item: SettingItem): React.ReactNode => {
    const value = valueOf(item);
    const type =
      item.valueType ??
      (typeof item.value === "boolean"
        ? "boolean"
        : typeof item.value === "number"
          ? "number"
          : "text");
    if (type === "boolean") {
      const checked = isTruthy(value);
      return (
        <div className="flex items-center gap-3 pt-1">
          <Switch
            checked={checked}
            disabled={!can("setting.update")}
            onCheckedChange={async (v) => {
              setDraft((s) => ({ ...s, [item.key]: v }));
              try {
                await apiFetch(`/settings/${encodeURIComponent(item.key)}`, {
                  method: "PUT",
                  body: {
                    value: v,
                    group: item.group,
                    label: item.label ?? undefined,
                    isPublic: item.isPublic,
                  },
                });
                toast.success(
                  `Đã lưu: ${item.label || item.key} → ${v ? "Bật" : "Tắt"}`,
                );
                setDraft((s) => {
                  const next = { ...s };
                  delete next[item.key];
                  return next;
                });
                await queryClient.invalidateQueries({ queryKey: ["settings"] });
              } catch (err: any) {
                toast.error(err.message || "Không thể lưu cài đặt");
              }
            }}
          />
          <span
            className={cn(
              "text-xs font-semibold",
              checked ? "text-teal-600 dark:text-teal-400" : "text-slate-400",
            )}
          >
            {checked ? "Bật (Đang kích hoạt)" : "Tắt"}
          </span>
        </div>
      );
    }
    if (type === "number") {
      return (
        <Input
          type="number"
          disabled={!can("setting.update")}
          value={String(value ?? "")}
          onChange={(e) =>
            setDraft((s) => ({
              ...s,
              [item.key]: e.target.value === "" ? null : Number(e.target.value),
            }))
          }
        />
      );
    }
    if (type === "json") {
      return (
        <Textarea
          rows={3}
          disabled={!can("setting.update")}
          value={
            typeof value === "string" ? value : JSON.stringify(value, null, 2)
          }
          onChange={(e) =>
            setDraft((s) => ({ ...s, [item.key]: e.target.value }))
          }
        />
      );
    }
    return (
      <Input
        type={
          type === "password" || item.key === "kiosk.itMasterPin"
            ? "password"
            : "text"
        }
        autoComplete={
          type === "password" || item.key === "kiosk.itMasterPin"
            ? "new-password"
            : undefined
        }
        disabled={!can("setting.update")}
        value={String(value ?? "")}
        onChange={(e) =>
          setDraft((s) => ({ ...s, [item.key]: e.target.value }))
        }
      />
    );
  };

  const current = groups.find((g) => g.group === activeGroup);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cấu hình hệ thống"
        description="Tham số vận hành dùng chung: thông tin bệnh viện, mã phiếu, kỳ báo cáo, khổ in, thông báo"
        actions={
          <>
            {dirtyCount > 0 ? (
              <Badge tone="warning">{dirtyCount} thay đổi chưa lưu</Badge>
            ) : null}
            {can("setting.update") ? (
              <>
                <Button variant="outline" onClick={() => setConfirmReset(true)}>
                  <RotateCcw /> Mặc định
                </Button>
                <Button
                  disabled={dirtyCount === 0}
                  loading={save.isPending}
                  onClick={() => save.mutate()}
                >
                  <Save /> Lưu thay đổi
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {isLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <Card className="h-fit p-2">
            {groups.map((g) => (
              <button
                key={g.group}
                type="button"
                onClick={() => setActiveGroup(g.group)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  activeGroup === g.group
                    ? "bg-[var(--accent)] font-medium"
                    : "hover:bg-[var(--muted)]",
                )}
              >
                <span className="flex items-center gap-2">
                  <span>{GROUP_ICON[g.group] ?? "🔧"}</span>
                  {GROUP_LABEL[g.group] ?? g.group}
                </span>
                <span className="text-[10px] text-[var(--muted-foreground)]">
                  {g.items.length}
                </span>
              </button>
            ))}
          </Card>

          <Card>
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <Settings2 className="size-4 text-[var(--primary)]" />
              <div className="text-sm font-semibold">
                {GROUP_LABEL[activeGroup ?? ""] ?? activeGroup}
              </div>
            </div>
            <div className="grid gap-5 p-4 sm:grid-cols-2">
              {(current?.items ?? []).map((item) => (
                <div key={item.key} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`s-${item.key}`}>
                      {item.label ?? item.key}
                    </Label>
                    {item.isPublic ? (
                      <Badge tone="info">Công khai</Badge>
                    ) : null}
                    {item.key in draft ? (
                      <Badge tone="warning">Đã sửa</Badge>
                    ) : null}
                  </div>
                  {renderField(item)}
                  <div className="font-mono text-[10px] text-[var(--muted-foreground)]">
                    {item.key}
                  </div>
                  {item.description ? (
                    <div className="text-[11px] text-[var(--muted-foreground)]">
                      {item.description}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={confirmReset}
        title="Khôi phục cấu hình mặc định"
        message="Toàn bộ cấu hình sẽ trở về giá trị mặc định của hệ thống. Các giá trị tuỳ chỉnh sẽ bị mất."
        confirmText="Khôi phục"
        loading={reset.isPending}
        onConfirm={() => reset.mutate()}
        onClose={() => setConfirmReset(false)}
      />
    </div>
  );
}
