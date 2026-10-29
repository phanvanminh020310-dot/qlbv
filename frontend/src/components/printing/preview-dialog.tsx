'use client';

import { Download, ExternalLink, FileSearch, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { buildSampleData } from './print-format';
import type { PrintDocument } from './print-types';

interface HsbaRow {
  id: number;
  code: string;
  patientName?: string;
  statusLabel?: string;
}

/**
 * Xem trước PDF toàn màn hình — render bằng đúng bộ máy in của máy chủ (font Times New Roman),
 * với dữ liệu mẫu tự sinh, dữ liệu một phiếu thật, hoặc JSON tự nhập.
 */
export function PreviewDialog({
  open,
  onClose,
  doc,
  data,
  setData,
  title,
}: {
  open: boolean;
  onClose: () => void;
  doc: PrintDocument;
  data: string;
  setData: (json: string) => void;
  title?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pages, setPages] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [hsba, setHsba] = useState<HsbaRow[] | null>(null);
  const urlRef = useRef<string | null>(null);

  const render = useCallback(
    async (json: string) => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = json.trim() ? (JSON.parse(json) as Record<string, unknown>) : {};
      } catch (err) {
        setError(`JSON dữ liệu không hợp lệ: ${(err as Error).message}`);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<Response>('/print/preview', {
          method: 'POST',
          body: { document: doc, data: parsed, rows: Array.isArray(parsed.rows) ? parsed.rows : [] },
          raw: true,
        });
        const blob = await res.blob();
        if (blob.type && !blob.type.includes('pdf')) throw new Error(await blob.text());
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        const next = URL.createObjectURL(blob);
        urlRef.current = next;
        setUrl(next);
        setPages(Number(res.headers.get('X-Print-Pages')) || null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [doc],
  );

  useEffect(() => {
    if (open) void render(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [open, onClose]);

  const searchHsba = async () => {
    try {
      const r = await apiFetch<{ items: HsbaRow[] }>(`/hsba/requests?pageSize=15${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`);
      setHsba(r.items ?? []);
    } catch (err) {
      toast.error(`Không tải được danh sách phiếu: ${(err as Error).message}`);
    }
  };

  const useHsba = async (row: HsbaRow) => {
    try {
      const d = await apiFetch<Record<string, unknown>>(`/hsba/requests/${row.id}/print-data`);
      const json = JSON.stringify(d, null, 2);
      setData(json);
      await render(json);
      toast.success(`Đang xem với dữ liệu phiếu ${row.code}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (!open) return null;

  return (
    <div className="app-viewport-fixed fixed inset-x-0 top-0 z-[60] flex flex-col overflow-hidden bg-slate-900/95" role="dialog" aria-label="Xem trước bản in">
      <div className="flex items-center gap-2 border-b border-slate-700 bg-slate-800 px-3 py-2 text-white">
        <FileSearch className="size-4" />
        <div className="text-sm font-medium">Xem trước PDF{title ? ` — ${title}` : ''}</div>
        {pages ? <span className="rounded bg-slate-700 px-2 py-0.5 text-[11px]">{pages} trang</span> : null}
        <span className="rounded bg-emerald-700/70 px-2 py-0.5 text-[11px]">Font mặc định: Times New Roman</span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" className="border-slate-600 bg-slate-700 text-white hover:bg-slate-600" onClick={() => void render(data)} loading={loading}>
            <RefreshCw /> Cập nhật
          </Button>
          {url ? (
            <>
              <Button size="sm" variant="outline" className="border-slate-600 bg-slate-700 text-white hover:bg-slate-600" onClick={() => window.open(url, '_blank')}>
                <ExternalLink /> Tab mới
              </Button>
              <a href={url} download={`${title || 'ban-in'}.pdf`} className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-600 bg-slate-700 px-3 text-xs text-white hover:bg-slate-600">
                <Download className="size-3.5" /> Tải PDF
              </a>
            </>
          ) : null}
          <Button size="sm" variant="ghost" className="text-white hover:bg-slate-700" onClick={onClose} title="Đóng (Esc)">
            <X />
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-80 shrink-0 flex-col gap-2 overflow-y-auto border-r border-slate-700 bg-slate-800 p-3 text-xs text-slate-200">
          <div className="font-semibold uppercase tracking-wide text-slate-400">Dữ liệu xem trước</div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="border-slate-600 bg-slate-700 text-white hover:bg-slate-600"
              onClick={() => {
                const json = JSON.stringify(buildSampleData(doc), null, 2);
                setData(json);
                void render(json);
              }}
            >
              Dữ liệu mẫu
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-slate-600 bg-slate-700 text-white hover:bg-slate-600"
              onClick={() => {
                setData('{}');
                void render('{}');
              }}
            >
              Để trống
            </Button>
          </div>
          <div className="space-y-1.5 rounded-md border border-slate-700 p-2">
            <div className="text-slate-400">Lấy dữ liệu từ phiếu HSBA thật</div>
            <div className="flex gap-1.5">
              <Input
                className="h-7 border-slate-600 bg-slate-900 text-xs text-white"
                placeholder="Mã phiếu / tên người bệnh"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') void searchHsba();
                }}
              />
              <Button size="sm" variant="outline" className="h-7 border-slate-600 bg-slate-700 text-white" onClick={() => void searchHsba()}>
                Tìm
              </Button>
            </div>
            {hsba ? (
              hsba.length ? (
                <ul className="max-h-48 space-y-0.5 overflow-y-auto">
                  {hsba.map((r) => (
                    <li key={r.id}>
                      <button type="button" className="w-full rounded px-1.5 py-1 text-left hover:bg-slate-700" onClick={() => void useHsba(r)}>
                        <span className="font-mono text-[11px]">{r.code}</span> · {r.patientName ?? ''}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-slate-500">Không có phiếu phù hợp</div>
              )
            ) : null}
          </div>
          <div className="text-slate-400">JSON dữ liệu (sửa trực tiếp rồi bấm Cập nhật)</div>
          <textarea
            className="min-h-[240px] flex-1 rounded-md border border-slate-600 bg-slate-950 p-2 font-mono text-[11px] text-emerald-200"
            spellCheck={false}
            value={data}
            onChange={(e) => setData(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void render(data);
            }}
          />
        </div>
        <div className="relative min-w-0 flex-1 bg-slate-600">
          {error ? <div className="absolute inset-x-4 top-4 z-10 rounded-md bg-red-600 px-3 py-2 text-sm text-white">{error}</div> : null}
          {url ? <iframe title="Bản in PDF" src={url} className="size-full border-0 bg-white" /> : <div className="flex h-full items-center justify-center text-slate-300">Đang dựng bản in…</div>}
        </div>
      </div>
    </div>
  );
}
