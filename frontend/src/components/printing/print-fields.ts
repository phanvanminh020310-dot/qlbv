'use client';

/**
 * TRƯỜNG DỮ LIỆU CỦA MẪU IN — dựng theo đúng nguồn dữ liệu của từng mẫu, không gắn cứng phân hệ.
 *
 * Nguồn trường (theo thứ tự hiển thị):
 *   1. `variables` khai báo trong mẫu (nếu có);
 *   2. cột của từng truy vấn nguồn SQL / chọn bảng (máy chủ trả tên, kiểu, nhãn tiếng Việt):
 *      `one.<mã>.<cột>` (dòng đầu) và danh sách cho bảng `ds.<mã>`;
 *   3. tham số người in nhập `params.<tên>`;
 *   4. trường riêng của phân hệ có dữ liệu do màn hình nghiệp vụ gửi sang (chỉ HSBA);
 *   5. trường đang dùng trong thiết kế nhưng chưa thuộc nhóm nào (mẫu cũ vẫn thấy trường của mình);
 *   6. trường hệ thống.
 * Bảng/phân hệ mới chỉ cần tạo nguồn dữ liệu (chọn bảng) là có trường — không sửa mã nguồn.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { FALLBACK_VARIABLES, nextId, type PrintDocument, type PrintElement, type TableColumnSpec } from './print-types';

export interface FieldItem {
  key: string;
  label: string;
  type: string;
  group: string;
}

export interface ServerFieldGroup {
  id: string;
  kind: 'record' | 'list' | 'params';
  label: string;
  query?: string;
  dataSource?: string;
  sql?: string;
  fields: Array<{ key: string; label: string; type: string; column?: string }>;
}

export interface ServerFields {
  groups: ServerFieldGroup[];
  errors: string[];
  hasSql: boolean;
  scope: 'ALL' | 'LIMITED';
}

/** Phân hệ có dữ liệu do màn hình nghiệp vụ gửi sang (không qua nguồn SQL) — giữ danh sách trường cũ */
const MODULE_PROVIDED_FIELDS: Record<string, typeof FALLBACK_VARIABLES> = {
  HSBA: FALLBACK_VARIABLES.filter((v) => !['index', 'rowLabel', 'value'].includes(v.key)),
};

export const SYSTEM_FIELDS: FieldItem[] = [
  { key: 'system.date', label: 'Ngày in (dd/MM/yyyy)', type: 'text', group: 'Hệ thống' },
  { key: 'system.datetime', label: 'Ngày giờ in', type: 'text', group: 'Hệ thống' },
  { key: 'system.day', label: 'Ngày', type: 'text', group: 'Hệ thống' },
  { key: 'system.month', label: 'Tháng', type: 'text', group: 'Hệ thống' },
  { key: 'system.year', label: 'Năm', type: 'text', group: 'Hệ thống' },
  { key: 'system.page', label: 'Trang hiện tại', type: 'text', group: 'Hệ thống' },
  { key: 'system.pages', label: 'Tổng số trang', type: 'text', group: 'Hệ thống' },
];

/** Trường riêng của phân hệ (vd HSBA) — dùng cho mẫu cũ không khai báo `variables`. */
export function moduleFields(module?: string | null): FieldItem[] {
  return (MODULE_PROVIDED_FIELDS[(module ?? '').toUpperCase()] ?? []).map((v) => ({ ...v, group: v.group ?? 'Khác' }));
}

/** Mọi phần tử của mẫu (trang + đầu/chân trang) */
export function allElements(doc: PrintDocument): PrintElement[] {
  return [...(doc.pages ?? []).flatMap((p) => p.elements ?? []), ...(doc.header?.elements ?? []), ...(doc.footer?.elements ?? [])];
}

/** Đường dẫn dữ liệu đang dùng trong thiết kế (ô trường + {placeholder} trong chữ) */
export function usedPaths(doc: PrintDocument): string[] {
  const out = new Set<string>();
  for (const el of allElements(doc)) {
    if (el.type !== 'table' && el.binding?.path && el.binding.source !== 'system') out.add(el.binding.path);
    for (const m of String(el.text ?? '').matchAll(/\{([a-zA-Z0-9_.]+)\}/g)) {
      const p = m[1]!;
      if (!p.startsWith('system.') && !['page', 'pages', 'total'].includes(p)) out.add(p);
    }
  }
  return [...out];
}

/** Gọi máy chủ lấy trường theo nguồn SQL (bản nháp hoặc đã lưu). Có debounce để gõ không gọi liên tục. */
export function usePrintFields(templateId: number | null | undefined, sqlSource: unknown, enabled = true) {
  const raw = JSON.stringify(sqlSource ?? null);
  const [key, setKey] = useState(raw);
  useEffect(() => {
    const t = setTimeout(() => setKey(raw), 400);
    return () => clearTimeout(t);
  }, [raw]);
  return useQuery({
    queryKey: ['print', 'fields', templateId ?? null, key],
    enabled: enabled && key !== 'null',
    staleTime: 60_000,
    queryFn: () =>
      apiFetch<ServerFields>('/print/fields', { method: 'POST', body: { templateId: templateId ?? null, sqlSource: JSON.parse(key) } }),
  });
}

/** Danh sách trường phẳng (cho tìm kiếm, chọn đường dẫn trong ô thuộc tính, dữ liệu mẫu) */
export function buildFieldCatalog(doc: PrintDocument, module: string | null | undefined, server: ServerFields | undefined): FieldItem[] {
  const out: FieldItem[] = [];
  const seen = new Set<string>();
  const push = (f: FieldItem) => {
    if (seen.has(f.key)) return;
    seen.add(f.key);
    out.push(f);
  };
  for (const v of doc.variables ?? []) push({ ...v, group: v.group ?? 'Biến của mẫu' });
  for (const g of server?.groups ?? []) {
    if (g.kind === 'list') continue;
    for (const f of g.fields) push({ key: f.key, label: f.label, type: f.type, group: g.label });
  }
  if (!doc.variables?.length) moduleFields(module).forEach(push);
  for (const p of usedPaths(doc)) push({ key: p, label: p.split('.').pop() ?? p, type: 'text', group: 'Đang dùng trong mẫu' });
  SYSTEM_FIELDS.forEach(push);
  return out;
}

/** Kiểu trường → định dạng hiển thị khi chèn */
export function formatFor(type: string): { type: string; decimals?: number } | undefined {
  if (type === 'integer') return { type: 'integer' };
  if (type === 'number') return { type: 'number', decimals: 2 };
  if (['date', 'datetime', 'currency', 'percent', 'bool'].includes(type)) return { type };
  return undefined;
}

const alignFor = (type: string): 'left' | 'center' | 'right' =>
  ['integer', 'number', 'currency', 'percent'].includes(type) ? 'right' : ['date', 'datetime', 'bool'].includes(type) ? 'center' : 'left';

/** Cột bảng từ một cột dữ liệu */
export function tableColumnFor(field: { key: string; label: string; type: string }, width: number): TableColumnSpec {
  const format = formatFor(field.type);
  return {
    id: nextId('col'),
    title: field.label,
    width,
    align: alignFor(field.type),
    binding: { source: 'row', path: field.key, ...(format ? { format } : {}) },
  };
}

/** Bảng danh sách lấy dữ liệu từ `ds.<mã>`, tiêu đề cột dùng nhãn tiếng Việt, độ rộng chia đều */
export function makeTableElement(
  dataSource: string,
  fields: Array<{ key: string; label: string; type: string }>,
  opts: { x?: number; y?: number; width?: number; name?: string } = {},
): PrintElement {
  const total = opts.width ?? 190;
  const cols = fields.slice(0, 30);
  const width = Math.max(10, Math.floor((total - 10) / Math.max(1, cols.length)));
  return {
    id: nextId('table'),
    type: 'table',
    name: opts.name ?? `Bảng ${dataSource}`,
    x: opts.x ?? 10,
    y: opts.y ?? 40,
    w: total,
    h: 20,
    table: {
      dataSource,
      repeatHeader: true,
      minRowHeight: 6,
      columns: [
        { id: nextId('col'), title: 'STT', width: 10, align: 'center', binding: { source: 'system', path: 'index' } },
        ...cols.map((f) => tableColumnFor(f, width)),
      ],
    },
    style: { fontSize: 10, wrap: true, verticalAlign: 'middle' },
  } as PrintElement;
}
