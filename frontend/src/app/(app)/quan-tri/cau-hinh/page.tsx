"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, RotateCcw, Save, Settings2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Badge, Card, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input, Label, Switch, Textarea } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";
import { brandImageSource, PUBLIC_BRANDING_QUERY } from "@/lib/branding";
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
  attendance: "Chấm công",
  kiosk: "Kiosk & Điểm danh",
  backup: "Sao lưu & lưu trữ",
  system: "Hệ thống",
};

const GROUP_ICON: Record<string, string> = {
  hospital: "🏥",
  hsba: "📋",
  report: "📊",
  print: "🖨️",
  export: "📤",
  notification: "🔔",
  attendance: "🗓️",
  kiosk: "🖥️",
  backup: "💾",
  system: "⚙️",
};

const BRAND_LOGO_MAX_BYTES = 512 * 1024;
const BRAND_LOGO_SIZES = [512, 448, 384, 320, 256, 192, 128, 96, 64];
const readAsDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Không đọc được tệp logo"));
  reader.onerror = () => reject(new Error("Không đọc được tệp logo"));
  reader.readAsDataURL(blob);
});
const loadLogoImage = (file: File) => new Promise<HTMLImageElement>((resolve, reject) => {
  const source = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => { URL.revokeObjectURL(source); resolve(image); };
  image.onerror = () => { URL.revokeObjectURL(source); reject(new Error("Tệp logo không phải ảnh hợp lệ")); };
  image.src = source;
});
const canvasBlob = (canvas: HTMLCanvasElement, type: "image/png" | "image/jpeg", quality?: number) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Không thể xử lý logo")), type, quality);
});

/** Chuẩn hoá logo chọn từ máy thành PNG/JPEG giới hạn kích thước để favicon/PWA luôn dùng được, kể cả tệp WebP. */
async function prepareBrandLogo(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error("Chỉ nhận ảnh PNG, JPEG hoặc WebP");
  const image = await loadLogoImage(file);
  const render = async (size: number, type: "image/png" | "image/jpeg", quality?: number) => {
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Trình duyệt không hỗ trợ xử lý logo");
    if (type === "image/jpeg") { context.fillStyle = "#ffffff"; context.fillRect(0, 0, size, size); }
    const ratio = Math.min(size / image.naturalWidth, size / image.naturalHeight);
    const width = Math.max(1, Math.round(image.naturalWidth * ratio));
    const height = Math.max(1, Math.round(image.naturalHeight * ratio));
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, Math.round((size - width) / 2), Math.round((size - height) / 2), width, height);
    return canvasBlob(canvas, type, quality);
  };
  for (const size of BRAND_LOGO_SIZES) {
    const png = await render(size, "image/png");
    if (png.size <= BRAND_LOGO_MAX_BYTES) return readAsDataUrl(png);
  }
  for (const size of BRAND_LOGO_SIZES) {
    for (const quality of [0.9, 0.8, 0.7, 0.6]) {
      const jpeg = await render(size, "image/jpeg", quality);
      if (jpeg.size <= BRAND_LOGO_MAX_BYTES) return readAsDataUrl(jpeg);
    }
  }
  throw new Error("Không thể nén logo xuống tối đa 512 KB");
}

/** Cấu hình hệ thống — mọi tham số đều sửa được từ giao diện, không hard-code. */
export default function SettingsPage() {
  const can = useAuth((s) => s.can);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["settings"] }),
        queryClient.invalidateQueries({ queryKey: PUBLIC_BRANDING_QUERY }),
      ]);
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const reset = useMutation({
    mutationFn: () => apiFetch("/settings/reset", { method: "POST" }),
    onSuccess: async () => {
      toast.success("Đã khôi phục cấu hình mặc định");
      setConfirmReset(false);
      setDraft({});
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["settings"] }),
        queryClient.invalidateQueries({ queryKey: PUBLIC_BRANDING_QUERY }),
      ]);
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

  const persistLogo = async (item: SettingItem, value: string) => {
    setUploadingLogo(true);
    try {
      await apiFetch(`/settings/${encodeURIComponent(item.key)}`, {
        method: "PUT",
        body: {
          value,
          group: item.group,
          label: item.label ?? undefined,
          description: item.description ?? undefined,
          valueType: item.valueType ?? undefined,
          isPublic: item.isPublic,
        },
      });
      toast.success(value ? "Đã cập nhật logo ứng dụng" : "Đã xóa logo ứng dụng");
      setDraft((current) => {
        const next = { ...current };
        delete next[item.key];
        return next;
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["settings"] }),
        queryClient.invalidateQueries({ queryKey: PUBLIC_BRANDING_QUERY }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể cập nhật logo");
    } finally {
      setUploadingLogo(false);
    }
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
    if (item.key === "hospital.logo") {
      const source = brandImageSource(value);
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-[var(--muted)] text-xs text-[var(--muted-foreground)]">
              {source ? <img src={source} alt="Xem trước logo ứng dụng" className="size-full object-contain" /> : "Chưa có"}
            </div>
            <div className="flex flex-wrap gap-2">
              <label className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium shadow-sm transition-colors hover:bg-[var(--muted)] ${(!can("setting.update") || uploadingLogo) ? "pointer-events-none opacity-60" : ""}`}>
                <ImagePlus className="size-4" /> {uploadingLogo ? "Đang lưu…" : "Chọn tệp logo"}
                <input
                  className="sr-only"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={!can("setting.update") || uploadingLogo}
                  onChange={async (event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (!file) return;
                    if (file.size > BRAND_LOGO_MAX_BYTES) return toast.error("Tệp logo gốc tối đa 512 KB");
                    try {
                      const dataUrl = await prepareBrandLogo(file);
                      if (!brandImageSource(dataUrl)) return toast.error("Chỉ nhận ảnh PNG, JPEG hoặc WebP");
                      await persistLogo(item, dataUrl);
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Không đọc được tệp logo");
                    }
                  }}
                />
              </label>
              {source ? <Button type="button" size="sm" variant="outline" disabled={!can("setting.update") || uploadingLogo} onClick={() => void persistLogo(item, "")}><Trash2 className="size-4" /> Xóa logo</Button> : null}
            </div>
          </div>
          <Input
            disabled={!can("setting.update") || uploadingLogo}
            value={String(value ?? "")}
            placeholder="Hoặc dán đường dẫn ảnh /logo.png"
            onChange={(event) => setDraft((current) => ({ ...current, [item.key]: event.target.value }))}
          />
          <p className="text-[11px] text-[var(--muted-foreground)]">Chọn PNG/JPEG/WebP tối đa 512 KB để lưu ngay (tự chuẩn hoá cho favicon/PWA), hoặc dán đường dẫn rồi bấm “Lưu thay đổi”.</p>
        </div>
      );
    }
    if (type === "attendance-lock-policy") {
      return (
        <select
          aria-label={item.label ?? item.key}
          disabled={!can("setting.update")}
          value={String(value ?? "DAILY")}
          onChange={(event) => setDraft((s) => ({ ...s, [item.key]: event.target.value }))}
          className="h-9 w-full rounded-md border bg-background px-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="DAILY">Qua ngày — khóa ngày trước đó</option>
          <option value="WEEKLY">Khóa theo tuần</option>
          <option value="MONTHLY">Khóa theo tháng</option>
          <option value="YEARLY">Khóa theo năm</option>
        </select>
      );
    }
    if (type === "attendance-staff-order") {
      return (
        <select
          aria-label={item.label ?? item.key}
          disabled={!can("setting.update")}
          value={String(value ?? "PROFESSIONAL")}
          onChange={(event) => setDraft((state) => ({ ...state, [item.key]: event.target.value }))}
          className="h-9 w-full rounded-md border bg-background px-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="PROFESSIONAL">Chức danh chuyên môn trước</option>
          <option value="MANAGEMENT_THEN_PROFESSIONAL">Chức vụ kiêm nhiệm trước, rồi chức danh chuyên môn</option>
        </select>
      );
    }
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
                      {item.key === "hospital.logo" ? "Logo ứng dụng" : item.label ?? item.key}
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
