'use client';

/**
 * Trình chọn bảng cho nguồn dữ liệu mẫu in — không cần viết SQL.
 * Bảng/view → cột cần lấy → điều kiện lọc → sắp xếp. Máy chủ sinh câu SELECT (khớp backend
 * print-query-builder.ts). Danh mục bảng đọc trực tiếp từ CSDL nên bảng mới tự xuất hiện.
 */
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type BuilderOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'starts' | 'is_null' | 'not_null' | 'is_true' | 'is_false';
export type BuilderAgg = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max';
export interface BuilderColumn { name: string; label?: string; agg?: BuilderAgg; alias?: string }
export interface BuilderFilter { column: string; op: BuilderOp; columnType?: string; value?: string; param?: string }
export interface BuilderSort { column: string; dir?: 'asc' | 'desc' }
export interface BuilderSpec {
  table: string;
  columns: BuilderColumn[];
  filters?: BuilderFilter[];
  sort?: BuilderSort[];
  limit?: number;
  scopeColumn?: string;
  distinct?: boolean;
}

export interface CatalogColumn { name: string; type: string; fieldType?: string; label?: string }
export interface CatalogTable { name: string; kind: 'view' | 'table'; label?: string; scopeColumn?: string | null; columns: CatalogColumn[] }

export interface BuilderParam { name: string; label?: string; type: 'text' | 'number' | 'date' | 'boolean'; required?: boolean; default?: string }

const OPS: Array<{ op: BuilderOp; label: string; needsValue: boolean }> = [
  { op: 'eq', label: '= bằng', needsValue: true },
  { op: 'ne', label: '≠ khác', needsValue: true },
  { op: 'gt', label: '> lớn hơn', needsValue: true },
  { op: 'gte', label: '≥ từ', needsValue: true },
  { op: 'lt', label: '< nhỏ hơn', needsValue: true },
  { op: 'lte', label: '≤ đến', needsValue: true },
  { op: 'contains', label: 'chứa', needsValue: true },
  { op: 'starts', label: 'bắt đầu bằng', needsValue: true },
  { op: 'is_null', label: 'trống', needsValue: false },
  { op: 'not_null', label: 'có giá trị', needsValue: false },
  { op: 'is_true', label: 'là Có', needsValue: false },
  { op: 'is_false', label: 'là Không', needsValue: false },
];
const AGGS: Array<{ agg: BuilderAgg | ''; label: string }> = [
  { agg: '', label: 'Giá trị' },
  { agg: 'count', label: 'Đếm' },
  { agg: 'count_distinct', label: 'Đếm (không trùng)' },
  { agg: 'sum', label: 'Tổng' },
  { agg: 'avg', label: 'Trung bình' },
  { agg: 'min', label: 'Nhỏ nhất' },
  { agg: 'max', label: 'Lớn nhất' },
];
const AUTO_FILTER_PARAMS: Array<{ name: string; label: string }> = [
  { name: 'nguoi_dung_id', label: 'Người đang in (ID)' },
  { name: 'khoa_id', label: 'Khoa của người in (ID)' },
];

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
const paramTypeOf = (fieldType?: string): BuilderParam['type'] =>
  fieldType === 'integer' || fieldType === 'number' ? 'number' : fieldType === 'date' || fieldType === 'datetime' ? 'date' : fieldType === 'bool' ? 'boolean' : 'text';
const isSensitiveDefault = (c: CatalogColumn) => c.name === 'id' || /_id$|_at$|_by$|^password|token|secret/.test(c.name);

/** Cột mặc định khi chọn bảng: tối đa 10 cột nội dung (bỏ khoá, dấu thời gian kỹ thuật) */
export function defaultSpecFor(t: CatalogTable): BuilderSpec {
  const content = t.columns.filter((c) => !isSensitiveDefault(c));
  const picked = (content.length ? content : t.columns).slice(0, 10);
  return {
    table: t.name,
    columns: picked.map((c) => ({ name: c.name, ...(c.label && c.label !== c.name ? { label: c.label } : {}) })),
    ...(t.scopeColumn ? { scopeColumn: t.scopeColumn } : {}),
    limit: 1000,
  };
}

export function builderProblems(spec: BuilderSpec | undefined, key: string, declared: string[]): string[] {
  if (!spec) return [];
  const out: string[] = [];
  if (!spec.table) out.push(`Truy vấn “${key}”: chọn bảng/view`);
  else if (!spec.columns.length) out.push(`Truy vấn “${key}”: chọn ít nhất một cột`);
  for (const f of spec.filters ?? []) {
    const needs = OPS.find((o) => o.op === f.op)?.needsValue;
    if (needs && f.param && !declared.includes(f.param) && !AUTO_FILTER_PARAMS.some((a) => a.name === f.param)) out.push(`Truy vấn “${key}”: tham số :${f.param} chưa khai báo`);
  }
  const aliases = new Set<string>();
  for (const c of spec.columns) {
    const alias = c.alias || (c.agg ? (c.name === '*' ? 'so_luong' : `${c.agg}_${c.name}`) : c.name);
    if (aliases.has(alias)) out.push(`Truy vấn “${key}”: cột kết quả “${alias}” bị trùng`);
    aliases.add(alias);
  }
  return out;
}

export function QueryBuilderEditor({
  spec,
  onChange,
  catalog,
  loading,
  params,
  setParams,
  editable,
  generatedSql,
}: {
  spec: BuilderSpec;
  onChange: (next: BuilderSpec) => void;
  catalog: CatalogTable[];
  loading?: boolean;
  params: BuilderParam[];
  setParams: (next: BuilderParam[]) => void;
  editable: boolean;
  generatedSql?: string;
}) {
  const [tableQ, setTableQ] = useState('');
  const [colQ, setColQ] = useState('');
  const table = catalog.find((t) => t.name === spec.table);
  const cols = table?.columns ?? [];
  const colMeta = (name: string) => cols.find((c) => c.name === name);
  const colLabel = (name: string) => colMeta(name)?.label || name;

  const tables = useMemo(() => {
    const q = fold(tableQ.trim());
    return catalog.filter((t) => !q || fold(`${t.label ?? ''} ${t.name}`).includes(q) || t.name === spec.table);
  }, [catalog, tableQ, spec.table]);

  const set = (patch: Partial<BuilderSpec>) => onChange({ ...spec, ...patch });
  const selected = new Map(spec.columns.map((c, i) => [c.name, i]));
  const filters = spec.filters ?? [];
  const sort = spec.sort ?? [];
  const hasAgg = spec.columns.some((c) => c.agg);

  const toggleCol = (c: CatalogColumn, on: boolean) =>
    set({
      columns: on
        ? [...spec.columns, { name: c.name, ...(c.label && c.label !== c.name ? { label: c.label } : {}) }]
        : spec.columns.filter((x) => x.name !== c.name || x.agg),
    });
  const patchCol = (i: number, patch: Partial<BuilderColumn>) =>
    set({ columns: spec.columns.map((c, j) => (j === i ? Object.fromEntries(Object.entries({ ...c, ...patch }).filter(([, v]) => v !== '' && v !== undefined)) as unknown as BuilderColumn : c)) });
  const moveCol = (i: number, d: -1 | 1) => {
    const next = [...spec.columns];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    set({ columns: next });
  };
  const patchFilter = (i: number, patch: Partial<BuilderFilter>) => set({ filters: filters.map((f, j) => (j === i ? { ...f, ...patch } : f)) });

  /** Tạo tham số người in nhập từ cột (vd “Từ ngày” cho điều kiện ≥ trên cột ngày) */
  const newParamFor = (f: BuilderFilter): string => {
    const meta = colMeta(f.column);
    const prefix = f.op === 'gte' || f.op === 'gt' ? 'tu_' : f.op === 'lte' || f.op === 'lt' ? 'den_' : '';
    let name = `${prefix}${f.column}`.slice(0, 40);
    let n = 2;
    while (params.some((p) => p.name === name) || AUTO_FILTER_PARAMS.some((a) => a.name === name)) name = `${prefix}${f.column}_${n++}`.slice(0, 40);
    const label = `${prefix === 'tu_' ? 'Từ ' : prefix === 'den_' ? 'Đến ' : ''}${(meta?.label ?? f.column).toLowerCase()}`;
    setParams([...params, { name, label: label.charAt(0).toUpperCase() + label.slice(1), type: paramTypeOf(meta?.fieldType) }]);
    return name;
  };

  if (!table) {
    return (
      <div className="space-y-2 rounded-lg border p-3">
        <div className="text-sm font-medium">Bước 1 — Chọn bảng / view chứa dữ liệu cần in</div>
        <Input value={tableQ} onChange={(e) => setTableQ(e.target.value)} placeholder="Tìm theo tên tiếng Việt hoặc tên bảng (vd: công việc, tài sản, người dùng…)" />
        {loading ? <p className="text-xs text-[var(--muted-foreground)]">Đang tải danh mục bảng…</p> : null}
        {spec.table && !loading ? <p className="text-xs text-red-600">Không tìm thấy bảng “{spec.table}” (đã đổi tên hoặc bị chặn vì dữ liệu nhạy cảm).</p> : null}
        <div className="thin-scroll grid max-h-[46vh] gap-1 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
          {tables.map((t) => (
            <button
              key={t.name}
              type="button"
              disabled={!editable}
              onClick={() => onChange(defaultSpecFor(t))}
              className="rounded-md border px-2 py-1.5 text-left text-xs hover:border-[var(--primary)] hover:bg-[var(--accent)] disabled:opacity-60"
            >
              <div className="flex items-center gap-1 font-medium">
                <span className={cn('rounded px-1 text-[9px] uppercase', t.kind === 'view' ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-700')}>{t.kind === 'view' ? 'view' : 'bảng'}</span>
                <span className="truncate">{t.label || t.name}</span>
              </div>
              <div className="truncate font-mono text-[10px] text-[var(--muted-foreground)]">
                {t.name} · {t.columns.length} cột{t.scopeColumn ? ' · theo khoa' : ''}
              </div>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-[var(--muted-foreground)]">
          View tiếng Việt (v_…) đã nối sẵn tên người, tên khoa, nhãn trạng thái — nên ưu tiên. Bảng/phân hệ thêm sau này tự xuất hiện ở đây.
        </p>
      </div>
    );
  }

  const shownCols = cols.filter((c) => !colQ.trim() || fold(`${c.label ?? ''} ${c.name}`).includes(fold(colQ.trim())));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-[var(--muted)]/40 px-3 py-2 text-sm">
        <span className="text-[var(--muted-foreground)]">Bảng:</span>
        <b>{table.label || table.name}</b>
        <code className="text-xs text-[var(--muted-foreground)]">{table.name}</code>
        {editable ? (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onChange({ table: '', columns: [] })}>
            Đổi bảng
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <div className="rounded-lg border p-2">
          <div className="mb-1 flex items-center gap-2 text-sm font-medium">
            Bước 2 — Cột cần lấy
            <span className="text-xs font-normal text-[var(--muted-foreground)]">({spec.columns.length} đã chọn)</span>
            {editable ? (
              <span className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => set({ columns: cols.map((c) => ({ name: c.name, ...(c.label && c.label !== c.name ? { label: c.label } : {}) })) })}>
                  Tất cả
                </Button>
                <Button size="sm" variant="ghost" onClick={() => set({ columns: [] })}>
                  Bỏ chọn
                </Button>
              </span>
            ) : null}
          </div>
          <Input className="mb-1 h-7 text-xs" value={colQ} onChange={(e) => setColQ(e.target.value)} placeholder="Tìm cột…" />
          <div className="thin-scroll max-h-56 space-y-0.5 overflow-y-auto">
            {shownCols.map((c) => (
              <label key={c.name} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-[var(--muted)]">
                <input type="checkbox" disabled={!editable} checked={selected.has(c.name)} onChange={(e) => toggleCol(c, e.target.checked)} />
                <span className="min-w-0 flex-1 truncate">{c.label || c.name}</span>
                <code className="max-w-[45%] truncate text-[10px] text-[var(--muted-foreground)]">{c.name}</code>
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-lg border p-2">
          <div className="mb-1 flex items-center text-sm font-medium">
            Thứ tự & tên cột khi in
            {editable ? (
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => set({ columns: [...spec.columns, { name: '*', agg: 'count', label: 'Số lượng' }] })} disabled={spec.columns.some((c) => c.name === '*')}>
                <Plus /> Đếm số dòng
              </Button>
            ) : null}
          </div>
          <div className="thin-scroll max-h-64 space-y-1 overflow-y-auto">
            {spec.columns.length === 0 ? <p className="text-xs text-[var(--muted-foreground)]">Tick cột ở bên trái.</p> : null}
            {spec.columns.map((c, i) => (
              <div key={`${c.name}-${i}`} className="grid grid-cols-[1fr_110px_auto] items-center gap-1">
                <Input className="h-7 text-xs" value={c.label ?? ''} disabled={!editable} placeholder={c.name === '*' ? 'Số lượng' : colLabel(c.name)} onChange={(e) => patchCol(i, { label: e.target.value })} title={c.name} />
                <Select className="h-7 text-xs" value={c.agg ?? ''} disabled={!editable || c.name === '*'} onChange={(e) => patchCol(i, { agg: (e.target.value || undefined) as BuilderAgg | undefined })}>
                  {AGGS.map((a) => (
                    <option key={a.agg} value={a.agg}>
                      {a.label}
                    </option>
                  ))}
                </Select>
                <span className="flex">
                  <button type="button" disabled={!editable} onClick={() => moveCol(i, -1)} className="p-0.5 disabled:opacity-40" aria-label="Lên">
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button type="button" disabled={!editable} onClick={() => moveCol(i, 1)} className="p-0.5 disabled:opacity-40" aria-label="Xuống">
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button type="button" disabled={!editable} onClick={() => set({ columns: spec.columns.filter((_, j) => j !== i) })} className="p-0.5 text-red-600 disabled:opacity-40" aria-label="Bỏ cột">
                    <Trash2 className="size-3.5" />
                  </button>
                </span>
              </div>
            ))}
          </div>
          {hasAgg ? <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">Có cột tổng hợp → các cột “Giá trị” còn lại tự dùng để nhóm (GROUP BY).</p> : null}
        </div>
      </div>

      <div className="rounded-lg border p-2">
        <div className="mb-1 flex items-center text-sm font-medium">
          Bước 3 — Điều kiện lọc
          {editable && filters.length < 20 ? (
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => set({ filters: [...filters, { column: cols[0]?.name ?? '', op: 'eq', value: '', columnType: cols[0]?.type }] })}>
              <Plus /> Điều kiện
            </Button>
          ) : null}
        </div>
        {table.scopeColumn ? (
          <label className="mb-1 flex items-center gap-2 text-xs">
            <input type="checkbox" disabled={!editable} checked={spec.scopeColumn === table.scopeColumn} onChange={(e) => set({ scopeColumn: e.target.checked ? table.scopeColumn ?? undefined : undefined })} />
            Chỉ lấy dữ liệu trong <b>phạm vi khoa</b> của người in (theo cột <code>{table.scopeColumn}</code>) — khuyên dùng
          </label>
        ) : (
          <p className="mb-1 text-[11px] text-amber-700">Bảng này không có cột khoa/phòng — mọi người có quyền in đều thấy toàn bộ dữ liệu.</p>
        )}
        {filters.map((f, i) => {
          const needs = OPS.find((o) => o.op === f.op)?.needsValue ?? true;
          const mode = f.param ? (AUTO_FILTER_PARAMS.some((a) => a.name === f.param) ? 'auto' : 'param') : 'value';
          const meta = colMeta(f.column);
          return (
            <div key={i} className="mb-1 grid items-center gap-1 sm:grid-cols-[1fr_120px_140px_1fr_auto]">
              <Select className="h-8 text-xs" value={f.column} disabled={!editable} onChange={(e) => patchFilter(i, { column: e.target.value, columnType: colMeta(e.target.value)?.type })}>
                {cols.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.label || c.name}
                  </option>
                ))}
              </Select>
              <Select className="h-8 text-xs" value={f.op} disabled={!editable} onChange={(e) => patchFilter(i, { op: e.target.value as BuilderOp })}>
                {OPS.map((o) => (
                  <option key={o.op} value={o.op}>
                    {o.label}
                  </option>
                ))}
              </Select>
              {needs ? (
                <Select
                  className="h-8 text-xs"
                  value={mode}
                  disabled={!editable}
                  onChange={(e) => {
                    const m = e.target.value;
                    if (m === 'value') patchFilter(i, { param: undefined, value: '' });
                    else if (m === 'auto') patchFilter(i, { param: 'khoa_id', value: undefined });
                    else patchFilter(i, { param: params[0]?.name ?? newParamFor(f), value: undefined });
                  }}
                >
                  <option value="value">Giá trị cố định</option>
                  <option value="param">Người in nhập khi in</option>
                  <option value="auto">Tự động</option>
                </Select>
              ) : (
                <span />
              )}
              {!needs ? (
                <span />
              ) : mode === 'value' ? (
                <Input
                  className="h-8 text-xs"
                  type={meta?.fieldType === 'date' || meta?.fieldType === 'datetime' ? 'date' : meta?.fieldType === 'integer' || meta?.fieldType === 'number' ? 'number' : 'text'}
                  value={f.value ?? ''}
                  disabled={!editable}
                  onChange={(e) => patchFilter(i, { value: e.target.value })}
                />
              ) : mode === 'auto' ? (
                <Select className="h-8 text-xs" value={f.param} disabled={!editable} onChange={(e) => patchFilter(i, { param: e.target.value })}>
                  {AUTO_FILTER_PARAMS.map((a) => (
                    <option key={a.name} value={a.name}>
                      {a.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Select
                  className="h-8 text-xs"
                  value={f.param}
                  disabled={!editable}
                  onChange={(e) => patchFilter(i, { param: e.target.value === '__new__' ? newParamFor(f) : e.target.value })}
                >
                  {f.param && !params.some((p) => p.name === f.param) ? <option value={f.param}>:{f.param} (chưa khai báo)</option> : null}
                  {params.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.label || p.name} (:{p.name})
                    </option>
                  ))}
                  <option value="__new__">＋ Tạo tham số mới từ cột này…</option>
                </Select>
              )}
              <button type="button" disabled={!editable} onClick={() => set({ filters: filters.filter((_, j) => j !== i) })} className="p-1 text-red-600 disabled:opacity-40" aria-label="Bỏ điều kiện">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          );
        })}
        {filters.some((f) => f.param && !AUTO_FILTER_PARAMS.some((a) => a.name === f.param)) ? (
          <p className="text-[10px] text-[var(--muted-foreground)]">Tham số người in để trống khi in → bỏ qua điều kiện đó. Đánh dấu “Bắt buộc” ở bảng tham số nếu cần.</p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="rounded-lg border p-2">
          <div className="mb-1 flex items-center text-sm font-medium">
            Bước 4 — Sắp xếp
            {editable && sort.length < 5 ? (
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => set({ sort: [...sort, { column: spec.columns.find((c) => c.name !== '*')?.name ?? cols[0]?.name ?? '', dir: 'asc' }] })}>
                <Plus /> Sắp xếp
              </Button>
            ) : null}
          </div>
          {sort.map((s, i) => (
            <div key={i} className="mb-1 grid grid-cols-[1fr_120px_auto] items-center gap-1">
              <Select className="h-8 text-xs" value={s.column} disabled={!editable} onChange={(e) => set({ sort: sort.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)) })}>
                {cols.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.label || c.name}
                  </option>
                ))}
              </Select>
              <Select className="h-8 text-xs" value={s.dir ?? 'asc'} disabled={!editable} onChange={(e) => set({ sort: sort.map((x, j) => (j === i ? { ...x, dir: e.target.value as 'asc' | 'desc' } : x)) })}>
                <option value="asc">Tăng dần (A→Z)</option>
                <option value="desc">Giảm dần (Z→A)</option>
              </Select>
              <button type="button" disabled={!editable} onClick={() => set({ sort: sort.filter((_, j) => j !== i) })} className="p-1 text-red-600 disabled:opacity-40" aria-label="Bỏ sắp xếp">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="space-y-2 rounded-lg border p-2 text-xs">
          <label className="block">
            Tối đa số dòng
            <Input className="mt-0.5 h-8 w-32 text-xs" type="number" min={1} max={5000} value={spec.limit ?? ''} disabled={!editable} placeholder="5000" onChange={(e) => set({ limit: e.target.value ? Math.min(5000, Math.max(1, Number(e.target.value))) : undefined })} />
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" disabled={!editable || hasAgg} checked={!!spec.distinct} onChange={(e) => set({ distinct: e.target.checked || undefined })} />
            Bỏ dòng trùng
          </label>
        </div>
      </div>

      {generatedSql ? (
        <details className="rounded-lg border px-2 py-1 text-xs">
          <summary className="cursor-pointer text-[var(--muted-foreground)]">Câu SQL máy chủ tự sinh (chỉ xem)</summary>
          <pre className="mt-1 whitespace-pre-wrap rounded bg-[#0f172a] p-2 font-mono text-[11.5px] text-slate-100">{generatedSql}</pre>
        </details>
      ) : null}
    </div>
  );
}
