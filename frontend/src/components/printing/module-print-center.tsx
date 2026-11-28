'use client';

/**
 * In ấn theo phân hệ — liệt kê mọi mẫu in “tự lấy dữ liệu” (nguồn SQL / chọn bảng) đang ban hành
 * mà người dùng được dùng, hỏi tham số rồi kết xuất PDF. Mẫu mới thiết kế trong
 * “Quản trị → Thiết kế bản in” tự xuất hiện ở đây — không cần sửa mã nguồn.
 * Dùng toàn trang (/in-an) hoặc nhúng vào trang của phân hệ: <ModulePrintCenter module="ASSET" />
 * (trang nhúng cần có một <PrintParamsHost /> trong cây giao diện).
 */
import { useQuery } from '@tanstack/react-query';
import { FileText, Printer, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState, Skeleton } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { askPrintParams, type PrintParamField } from './print-params-dialog';

export interface AvailableTemplate {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  module: string;
  moduleLabel: string;
  docType: string;
  paperSize: string;
  orientation: string;
  params: PrintParamField[];
}

/** Hỏi tham số (nếu có) rồi mở PDF ở tab mới */
export async function printAvailableTemplate(t: AvailableTemplate, preset: Record<string, unknown> = {}): Promise<void> {
  let values: Record<string, unknown> = preset;
  if (t.params.length) {
    const asked = await askPrintParams(t.name, t.params, preset);
    if (!asked) return;
    values = asked;
  }
  const win = window.open('about:blank', '_blank');
  try {
    const res = await apiFetch<Response>(`/print/templates/${t.id}/render`, { method: 'POST', body: { params: values }, raw: true });
    const blob = await res.blob();
    if (blob.type && !blob.type.includes('pdf')) throw new Error(await blob.text());
    const url = URL.createObjectURL(blob);
    if (win) win.location.href = url;
    else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (err) {
    win?.close();
    throw err;
  }
}

export function ModulePrintCenter({ module, compact = false }: { module?: string; compact?: boolean }) {
  const can = useAuth((s) => s.can);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<string>(module ?? '');
  const [busy, setBusy] = useState<number | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['print', 'available', module ?? ''],
    queryFn: () => apiFetch<{ items: AvailableTemplate[] }>(`/print/available${module ? `?module=${encodeURIComponent(module)}` : ''}`).then((r) => r.items),
    staleTime: 60_000,
  });
  const items = data ?? [];
  const modules = useMemo(() => {
    const m = new Map<string, { code: string; label: string; n: number }>();
    for (const t of items) m.set(t.module, { code: t.module, label: t.moduleLabel, n: (m.get(t.module)?.n ?? 0) + 1 });
    return [...m.values()];
  }, [items]);
  const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
  const shown = items.filter((t) => (!filter || t.module === filter) && (!q.trim() || fold(`${t.name} ${t.code} ${t.description ?? ''}`).includes(fold(q.trim()))));
  const canPrint = can('print.render.export');

  const print = async (t: AvailableTemplate) => {
    setBusy(t.id);
    try {
      await printAvailableTemplate(t);
    } catch (err) {
      toast.error((err as Error).message || 'Không in được');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm mẫu in / báo cáo…" />
        </div>
        {!module && modules.length > 1 ? (
          <div className="flex flex-wrap gap-1 text-xs">
            {[{ code: '', label: 'Tất cả', n: items.length }, ...modules].map((m) => (
              <button
                key={m.code || 'all'}
                type="button"
                onClick={() => setFilter(m.code)}
                className={`rounded-full border px-2.5 py-1 ${filter === m.code ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]' : 'hover:bg-[var(--muted)]'}`}
              >
                {m.label} <span className="opacity-70">{m.n}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : shown.length === 0 ? (
        <EmptyState
          title="Chưa có mẫu in tự lấy dữ liệu"
          description="Vào Quản trị → Thiết kế bản in, tạo mẫu và thêm “Nguồn dữ liệu” (chọn bảng của phân hệ). Mẫu đang ban hành sẽ tự xuất hiện ở đây."
        />
      ) : (
        <div className={`grid gap-2 ${compact ? '' : 'sm:grid-cols-2 xl:grid-cols-3'}`}>
          {shown.map((t) => (
            <div key={t.id} className="flex items-start gap-3 rounded-xl border bg-[var(--card)] p-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-foreground)]">
                <FileText className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{t.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
                  <Badge tone="info">{t.moduleLabel}</Badge>
                  <span>
                    {t.paperSize} · {t.orientation === 'landscape' ? 'ngang' : 'dọc'}
                  </span>
                  {t.params.length ? <span>· {t.params.length} tham số</span> : null}
                </div>
                {t.description ? <p className="mt-1 line-clamp-2 text-xs text-[var(--muted-foreground)]">{t.description}</p> : null}
              </div>
              <Button size="sm" onClick={() => void print(t)} loading={busy === t.id} disabled={!canPrint} title={canPrint ? 'Kết xuất PDF' : 'Cần quyền “Kết xuất bản in”'}>
                <Printer /> In
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
