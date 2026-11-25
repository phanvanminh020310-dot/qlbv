'use client';

import { useQuery } from '@tanstack/react-query';
import { Database, FileDown, FileSpreadsheet, Play, Plus, Table2, Trash2, Type as TypeIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { apiFetch, downloadFile } from '@/lib/api';
import { cn } from '@/lib/utils';
import { nextId, type PrintElement } from './print-types';

/* Khớp backend print-sql-source.ts */
export type SqlParamType = 'text' | 'number' | 'date' | 'boolean';
export interface SqlParam { name: string; label?: string; type: SqlParamType; required?: boolean; default?: string }
export interface SqlQuery { key: string; label?: string; sql: string }
export interface SqlSource { queries: SqlQuery[]; params?: SqlParam[] }

interface TestResult {
  queries: Array<{ key: string; label?: string; rowCount: number; ms?: number; columns?: string[]; truncated?: boolean; rows: Record<string, unknown>[] }>;
  params: Record<string, unknown>;
}
interface Catalog { items: Array<{ name: string; kind: 'view' | 'table'; columns: Array<{ name: string; type: string }> }>; autoParams: Record<string, { cast: string; label: string }> }

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const PARAM_TYPE_LABEL: Record<SqlParamType, string> = { text: 'Chữ', number: 'Số', date: 'Ngày', boolean: 'Có/Không' };

export function readSqlSource(doc: Record<string, unknown>): SqlSource | null {
  const s = doc.sqlSource as SqlSource | undefined;
  return s && Array.isArray(s.queries) && s.queries.length ? s : null;
}

/** Giá trị tham số mặc định để xem trước/chạy thử. */
export function defaultParamValues(source: SqlSource | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of source?.params ?? []) out[p.name] = p.default ?? '';
  return out;
}

/** Tóm tắt ở cột trái trình thiết kế. */
export function SqlSourceSummary({ source, onOpen, canAuthor }: { source: SqlSource | null; onOpen: () => void; canAuthor: boolean }) {
  return (
    <div className="space-y-2 text-xs">
      <p className="text-[11px] text-[var(--muted-foreground)]">
        Lấy dữ liệu in trực tiếp từ CSDL bằng câu lệnh SELECT (chỉ đọc). Kết quả dùng trong mẫu: <code>ds.&lt;mã&gt;</code> (danh sách cho bảng),{' '}
        <code>one.&lt;mã&gt;.&lt;cột&gt;</code> (dòng đầu), <code>params.&lt;tên&gt;</code>.
      </p>
      {source ? (
        <ul className="space-y-1">
          {source.queries.map((q) => (
            <li key={q.key} className="rounded border bg-[var(--background)] px-2 py-1">
              <div className="font-mono font-semibold">{q.key}</div>
              {q.label ? <div className="text-[var(--muted-foreground)]">{q.label}</div> : null}
            </li>
          ))}
          {source.params?.length ? <li className="text-[var(--muted-foreground)]">Tham số: {source.params.map((p) => p.name).join(', ')}</li> : null}
        </ul>
      ) : (
        <p className="rounded border border-dashed p-2 text-center text-[var(--muted-foreground)]">Mẫu chưa dùng nguồn SQL</p>
      )}
      <Button size="sm" variant="outline" className="w-full" onClick={onOpen}>
        <Database /> {canAuthor ? (source ? 'Mở trình soạn SQL' : 'Thêm nguồn dữ liệu SQL') : 'Xem nguồn dữ liệu'}
      </Button>
      {!canAuthor ? <p className="text-[10px] text-amber-700">Cần quyền “Soạn nguồn dữ liệu SQL cho mẫu in” để chỉnh/chạy thử.</p> : null}
    </div>
  );
}

export function SqlSourceDialog({
  open,
  onClose,
  source,
  onChange,
  canAuthor,
  readOnly,
  testParams,
  setTestParams,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  source: SqlSource | null;
  onChange: (next: SqlSource | null) => void;
  canAuthor: boolean;
  readOnly?: boolean;
  testParams: Record<string, string>;
  setTestParams: (v: Record<string, string>) => void;
  onInsert: (els: PrintElement[]) => void;
}) {
  const editable = canAuthor && !readOnly;
  const [draft, setDraft] = useState<SqlSource>({ queries: [], params: [] });
  const [active, setActive] = useState(0);
  const [result, setResult] = useState<TestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catQ, setCatQ] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraft(source ? { queries: source.queries.map((q) => ({ ...q })), params: (source.params ?? []).map((p) => ({ ...p })) } : { queries: [{ key: 'du_lieu', label: '', sql: 'select 1 as so' }], params: [] });
    setActive(0);
    setResult(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const catalog = useQuery({ queryKey: ['print', 'sql-catalog'], queryFn: () => apiFetch<Catalog>('/print/sql/catalog'), enabled: open && canAuthor, staleTime: 300_000 });
  const catItems = useMemo(() => {
    const q = catQ.trim().toLowerCase();
    return (catalog.data?.items ?? []).filter((t) => !q || t.name.includes(q) || t.columns.some((c) => c.name.includes(q))).slice(0, 80);
  }, [catalog.data, catQ]);

  const q = draft.queries[active];
  const setQuery = (patch: Partial<SqlQuery>) => setDraft({ ...draft, queries: draft.queries.map((x, i) => (i === active ? { ...x, ...patch } : x)) });
  const params = draft.params ?? [];
  const setParams = (next: SqlParam[]) => setDraft({ ...draft, params: next });

  const problems = useMemo(() => {
    const out: string[] = [];
    const keys = new Set<string>();
    for (const x of draft.queries) {
      if (!KEY_RE.test(x.key)) out.push(`Mã truy vấn “${x.key}” chỉ gồm chữ thường, số, gạch dưới và bắt đầu bằng chữ`);
      if (keys.has(x.key)) out.push(`Trùng mã truy vấn “${x.key}”`);
      keys.add(x.key);
      if (!x.sql.trim()) out.push(`Truy vấn “${x.key}” đang trống`);
    }
    const names = new Set<string>();
    for (const p of params) {
      if (!KEY_RE.test(p.name)) out.push(`Tên tham số “${p.name}” không hợp lệ`);
      if (names.has(p.name)) out.push(`Trùng tham số “${p.name}”`);
      if (catalog.data?.autoParams[p.name]) out.push(`“${p.name}” là tham số tự động — không khai báo lại`);
      names.add(p.name);
    }
    return out;
  }, [draft, params, catalog.data]);

  const test = async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await apiFetch<TestResult>('/print/sql/test', { method: 'POST', body: { sqlSource: draft, params: testParams } });
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setRunning(false);
    }
  };

  const [exporting, setExporting] = useState<'xlsx' | 'csv' | null>(null);
  const exportData = async (format: 'xlsx' | 'csv') => {
    setExporting(format);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      await downloadFile('/print/sql/export', format === 'csv' ? `nguon_sql_${q?.key ?? 'du_lieu'}_${stamp}.csv` : `nguon_sql_${stamp}.xlsx`, {
        method: 'POST',
        body: { sqlSource: draft, params: testParams, format, queryKey: q?.key },
      });
    } catch (e) {
      toast.error((e as Error).message || 'Không xuất được dữ liệu');
    } finally {
      setExporting(null);
    }
  };

  const activeResult = result?.queries.find((x) => x.key === q?.key);
  const columnsOf = (key: string): string[] => {
    const r = result?.queries.find((x) => x.key === key);
    return r?.columns ?? (r?.rows[0] ? Object.keys(r.rows[0]) : []);
  };

  const insertTable = (key: string) => {
    const cols = columnsOf(key);
    if (!cols.length) return toast.warning('Hãy chạy thử để biết các cột trước khi chèn bảng');
    const width = Math.max(10, Math.floor((190 - 10) / cols.length));
    onInsert([
      {
        id: nextId('table'),
        type: 'table',
        name: `Bảng ${key}`,
        x: 10,
        y: 40,
        w: 190,
        h: 20,
        table: {
          dataSource: `ds.${key}`,
          repeatHeader: true,
          minRowHeight: 6,
          columns: [
            { id: nextId('col'), title: 'STT', width: 10, align: 'center', binding: { source: 'system', path: 'index' } },
            ...cols.map((c) => ({ id: nextId('col'), title: c, width, align: 'left' as const, binding: { source: 'row', path: c } })),
          ],
        },
        style: { fontSize: 10, wrap: true, verticalAlign: 'middle' },
      },
    ]);
    toast.success(`Đã chèn bảng lấy dữ liệu từ ds.${key}`);
  };
  const insertField = (key: string, col: string) => {
    onInsert([{ id: nextId('field'), type: 'field', name: `${key}.${col}`, x: 10, y: 20, w: 60, h: 7, binding: { source: 'field', path: `one.${key}.${col}` }, style: { fontSize: 11 } }]);
  };

  const save = () => {
    if (problems.length) return toast.error(problems[0]!);
    const cleaned: SqlSource = {
      queries: draft.queries.map((x) => ({ key: x.key, sql: x.sql.trim(), ...(x.label?.trim() ? { label: x.label.trim() } : {}) })),
      params: params.map((p) => ({ name: p.name, type: p.type, ...(p.label ? { label: p.label } : {}), ...(p.required ? { required: true } : {}), ...(p.default ? { default: p.default } : {}) })),
    };
    onChange(cleaned.queries.length ? cleaned : null);
    onClose();
    toast.success('Đã cập nhật nguồn dữ liệu — nhớ bấm Lưu mẫu');
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="full"
      title="Nguồn dữ liệu SQL của mẫu in"
      description="Chỉ cho phép SELECT/WITH, chạy chỉ-đọc, tối đa 15 giây và 5.000 dòng. Dùng :ten_tham_so trong câu lệnh; tham số tự động: :nguoi_dung_id, :khoa_id, :pham_vi_khoa (NULL = toàn viện)."
      footer={
        <>
          {editable && source ? <Button variant="ghost" className="mr-auto text-red-600" onClick={() => { onChange(null); onClose(); }}><Trash2 /> Bỏ nguồn SQL</Button> : null}
          <Button variant="outline" onClick={onClose}>Đóng</Button>
          {editable ? <Button onClick={save}>Áp dụng vào mẫu</Button> : null}
        </>
      }
    >
      <div className="grid min-h-[60vh] gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1">
            {draft.queries.map((x, i) => (
              <button key={i} type="button" onClick={() => setActive(i)} className={cn('rounded-md border px-2.5 py-1 font-mono text-xs', i === active ? 'border-teal-700 bg-teal-700 text-white' : 'hover:bg-[var(--muted)]')}>
                {x.key || '(chưa đặt mã)'}
              </button>
            ))}
            {editable && draft.queries.length < 10 ? (
              <Button size="sm" variant="ghost" onClick={() => { setDraft({ ...draft, queries: [...draft.queries, { key: `truy_van_${draft.queries.length + 1}`, sql: '' }] }); setActive(draft.queries.length); }}><Plus /> Truy vấn</Button>
            ) : null}
          </div>
          {q ? (
            <div className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
              <Input className="font-mono" value={q.key} disabled={!editable} onChange={(e) => setQuery({ key: e.target.value.toLowerCase() })} placeholder="ma_truy_van" />
              <Input value={q.label ?? ''} disabled={!editable} onChange={(e) => setQuery({ label: e.target.value })} placeholder="Mô tả (không bắt buộc)" />
              {editable && draft.queries.length > 1 ? <Button variant="ghost" className="text-red-600" onClick={() => { setDraft({ ...draft, queries: draft.queries.filter((_, i) => i !== active) }); setActive(0); }}><Trash2 /></Button> : <span />}
            </div>
          ) : null}
          {q ? (
            <textarea
              value={q.sql}
              readOnly={!editable}
              onChange={(e) => setQuery({ sql: e.target.value })}
              onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canAuthor) { e.preventDefault(); void test(); } }}
              spellCheck={false}
              className="min-h-[220px] flex-1 rounded-md border bg-[#0f172a] p-3 font-mono text-[12.5px] leading-relaxed text-slate-100"
              placeholder={'select ma, tieu_de, ten_nguoi_thuc_hien\nfrom v_cv_cong_viec\nwhere ngay_giao between :tu_ngay and :den_ngay\n  and (:pham_vi_khoa is null or khoa_id = any(:pham_vi_khoa))'}
            />
          ) : null}

          <div className="rounded-lg border p-2">
            <div className="mb-1 flex items-center justify-between text-sm font-medium">
              Tham số người in nhập
              {editable && params.length < 20 ? <Button size="sm" variant="ghost" onClick={() => setParams([...params, { name: `tham_so_${params.length + 1}`, type: 'text' }])}><Plus /> Thêm</Button> : null}
            </div>
            {params.length ? (
              <table className="w-full text-xs">
                <thead className="text-left text-[var(--muted-foreground)]"><tr><th className="py-1">Tên (:ten)</th><th>Nhãn hiển thị</th><th>Kiểu</th><th>Bắt buộc</th><th>Mặc định</th><th>Giá trị chạy thử</th><th /></tr></thead>
                <tbody>
                  {params.map((p, i) => (
                    <tr key={i}>
                      <td className="pr-1"><Input className="h-8 font-mono text-xs" value={p.name} disabled={!editable} onChange={(e) => setParams(params.map((x, j) => (j === i ? { ...x, name: e.target.value.toLowerCase() } : x)))} /></td>
                      <td className="pr-1"><Input className="h-8 text-xs" value={p.label ?? ''} disabled={!editable} onChange={(e) => setParams(params.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></td>
                      <td className="pr-1">
                        <Select className="h-8 text-xs" value={p.type} disabled={!editable} onChange={(e) => setParams(params.map((x, j) => (j === i ? { ...x, type: e.target.value as SqlParamType } : x)))}>
                          {(Object.keys(PARAM_TYPE_LABEL) as SqlParamType[]).map((t) => <option key={t} value={t}>{PARAM_TYPE_LABEL[t]}</option>)}
                        </Select>
                      </td>
                      <td className="text-center"><input type="checkbox" checked={!!p.required} disabled={!editable} onChange={(e) => setParams(params.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} /></td>
                      <td className="pr-1"><Input className="h-8 text-xs" value={p.default ?? ''} disabled={!editable} placeholder={p.type === 'date' ? 'today / YYYY-MM-DD' : ''} onChange={(e) => setParams(params.map((x, j) => (j === i ? { ...x, default: e.target.value } : x)))} /></td>
                      <td className="pr-1"><Input className="h-8 text-xs" type={p.type === 'date' ? 'date' : p.type === 'number' ? 'number' : 'text'} value={testParams[p.name] ?? ''} onChange={(e) => setTestParams({ ...testParams, [p.name]: e.target.value })} /></td>
                      <td>{editable ? <button type="button" onClick={() => setParams(params.filter((_, j) => j !== i))}><Trash2 className="size-3.5 text-red-600" /></button> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="text-xs text-[var(--muted-foreground)]">Không có. Tham số giúp người in chọn kỳ báo cáo, khoa, mã phiếu… khi in.</p>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canAuthor ? <Button onClick={test} loading={running} disabled={problems.length > 0}><Play /> Chạy thử (Ctrl+Enter)</Button> : null}
            {canAuthor ? (
              <>
                <Button variant="outline" onClick={() => exportData('xlsx')} loading={exporting === 'xlsx'} disabled={problems.length > 0 || !!exporting} title="Mỗi truy vấn một sheet, tối đa 5.000 dòng/truy vấn">
                  <FileSpreadsheet /> Xuất Excel
                </Button>
                <Button variant="outline" onClick={() => exportData('csv')} loading={exporting === 'csv'} disabled={problems.length > 0 || !!exporting || !q} title="Xuất truy vấn đang chọn ra CSV (UTF-8)">
                  <FileDown /> CSV{q ? ` “${q.key}”` : ''}
                </Button>
              </>
            ) : null}
            {problems.length ? <span className="text-xs text-red-600">{problems[0]}</span> : null}
            {q && result ? (
              <>
                <Button size="sm" variant="outline" onClick={() => insertTable(q.key)} disabled={readOnly}><Table2 /> Chèn bảng từ “{q.key}”</Button>
              </>
            ) : null}
          </div>
          {error ? <pre className="whitespace-pre-wrap rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200">{error}</pre> : null}
          {activeResult ? (
            <div className="rounded-lg border">
              <div className="flex flex-wrap items-center gap-3 border-b px-3 py-1.5 text-xs">
                <b>{activeResult.rowCount} dòng</b>
                {activeResult.ms !== undefined ? <span>{activeResult.ms} ms</span> : null}
                {activeResult.truncated ? <span className="text-amber-700">Chạy thử chỉ lấy {activeResult.rowCount} dòng đầu (khi in tối đa 5.000)</span> : null}
                <span className="text-[var(--muted-foreground)]">Bấm tên cột để chèn trường <code>one.{activeResult.key}.&lt;cột&gt;</code></span>
              </div>
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[var(--muted)]">
                    <tr>
                      {columnsOf(activeResult.key).map((c) => (
                        <th key={c} className="whitespace-nowrap px-2 py-1 text-left">
                          <button type="button" disabled={readOnly} className="inline-flex items-center gap-1 font-mono hover:text-[var(--primary)]" onClick={() => insertField(activeResult.key, c)} title={`Chèn trường one.${activeResult.key}.${c}`}>
                            <TypeIcon className="size-3" /> {c}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {activeResult.rows.slice(0, 100).map((r, i) => (
                      <tr key={i}>{columnsOf(activeResult.key).map((c) => <td key={c} className="max-w-[260px] truncate px-2 py-1">{fmtCell(r[c])}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>

        <aside className="flex min-h-0 flex-col gap-2 rounded-lg border p-2 text-xs">
          <div className="font-medium">Tham số tự động</div>
          <ul className="space-y-0.5">
            {Object.entries(catalog.data?.autoParams ?? {}).map(([k, v]) => <li key={k}><code className="text-[var(--primary)]">:{k}</code> — {v.label}</li>)}
          </ul>
          <div className="mt-1 font-medium">View / bảng gợi ý</div>
          <Input className="h-8 text-xs" value={catQ} onChange={(e) => setCatQ(e.target.value)} placeholder="Tìm bảng, cột… (vd v_cv_)" />
          <div className="thin-scroll min-h-0 flex-1 space-y-1 overflow-y-auto" style={{ maxHeight: '55vh' }}>
            {catalog.isLoading ? <p>Đang tải…</p> : null}
            {catItems.map((t) => (
              <details key={t.name} className="rounded border px-1.5 py-1">
                <summary className="cursor-pointer font-mono">
                  <span className={cn('mr-1 rounded px-1 text-[9px] uppercase', t.kind === 'view' ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-700')}>{t.kind}</span>
                  {t.name}
                </summary>
                <ul className="mt-1 space-y-0.5 pl-2">
                  {t.columns.map((c) => (
                    <li key={c.name}>
                      <button type="button" disabled={!editable || !q} className="font-mono hover:text-[var(--primary)]" onClick={() => q && setQuery({ sql: `${q.sql}${q.sql.endsWith(' ') || !q.sql ? '' : ' '}${c.name}` })}>{c.name}</button>{' '}
                      <span className="text-[var(--muted-foreground)]">{c.type}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </aside>
      </div>
    </Dialog>
  );
}

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
