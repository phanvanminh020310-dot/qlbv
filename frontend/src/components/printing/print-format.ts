/**
 * Truy xuất & định dạng dữ liệu cho khung vẽ — cùng quy tắc với backend
 * (backend/src/infra/rendering/pdf-renderer.ts) để khung vẽ khớp bản in.
 */
import type { FieldFormat, PrintDocument, PrintElement } from './print-types';

export function getByPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  let cur: unknown = obj;
  for (const seg of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segs = path.split('.');
  let cur = obj;
  segs.forEach((s, i) => {
    if (i === segs.length - 1) {
      if (cur[s] === undefined) cur[s] = value;
      return;
    }
    if (typeof cur[s] !== 'object' || cur[s] === null) cur[s] = {};
    cur = cur[s] as Record<string, unknown>;
  });
}

const pad = (n: number): string => String(n).padStart(2, '0');

export function formatDatePattern(d: Date, pattern: string): string {
  const map: Record<string, string> = {
    yyyy: String(d.getFullYear()),
    yy: String(d.getFullYear()).slice(-2),
    MM: pad(d.getMonth() + 1),
    dd: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
  };
  return pattern.replace(/yyyy|yy|MM|dd|HH|mm|ss/g, (m) => map[m] ?? m);
}

export const DATE_PATTERN_RE = /(dd|MM|yyyy|HH|mm)/;

export function formatValue(raw: unknown, format?: FieldFormat): string {
  if (raw === undefined || raw === null || raw === '') return format?.fallback ?? '';
  const type = format?.type ?? 'text';
  let out: string;
  switch (type) {
    case 'number':
    case 'integer': {
      const n = Number(raw);
      const dec = type === 'integer' ? 0 : (format?.decimals ?? 0);
      out = Number.isFinite(n) ? n.toLocaleString('vi-VN', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : String(raw);
      break;
    }
    case 'currency': {
      const n = Number(raw);
      out = Number.isFinite(n) ? `${n.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ` : String(raw);
      break;
    }
    case 'percent': {
      const n = Number(raw);
      out = Number.isFinite(n) ? `${(n * 100).toFixed(format?.decimals ?? 1)}%` : String(raw);
      break;
    }
    case 'date':
    case 'datetime': {
      const s = String(raw);
      const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
      out = Number.isNaN(d.getTime())
        ? s
        : formatDatePattern(d, format?.pattern && DATE_PATTERN_RE.test(format.pattern) ? format.pattern : type === 'date' ? 'dd/MM/yyyy' : 'dd/MM/yyyy HH:mm');
      break;
    }
    case 'bool':
      out = raw ? 'Có' : 'Không';
      break;
    default:
      out = String(raw);
  }
  return `${format?.prefix ?? ''}${out}${format?.suffix ?? ''}`;
}

export function interpolate(text: string, data: Record<string, unknown> | null): string {
  return String(text ?? '').replace(/\{([a-zA-Z0-9_.[\]]+)\}/g, (m, expr: string) => {
    if (!data) return m;
    const v = getByPath(data, expr);
    if (v === undefined || v === null || typeof v === 'object') return '';
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
      return formatValue(v, { type: v.includes('T') ? 'datetime' : 'date' });
    }
    return String(v);
  });
}

/* --------------------------------------------------------------- Dữ liệu mẫu */

const SAMPLE_TEXT: [RegExp, string][] = [
  [/department|khoa/i, 'Nội tổng hợp'],
  [/hospital|benhVien|donVi/i, 'Bệnh viện Quân y 4'],
  [/title|chucDanh|position/i, 'Bác sĩ điều trị'],
  [/gender|gioiTinh/i, 'Nam'],
  [/birthYear|namSinh/i, '1968'],
  [/birth/i, '12/05/1968'],
  [/signedAt|signedTime/i, '27/09/2026 09:30'],
  [/ngay|date/i, '27/09/2026'],
  [/maKcb/i, '26001234'],
  [/bhyt/i, 'DN4797923456789'],
  [/reason|lyDo/i, 'Ghi nhầm chẩn đoán phụ khi hoàn tất hồ sơ'],
  [/content|noiDung/i, 'Sửa chẩn đoán phụ từ "Tăng huyết áp" thành "Tăng huyết áp độ II".'],
  [/status/i, 'Đang xử lý'],
  [/note|ghiChu/i, 'Không'],
  [/patientName|hoTen|fullName|requesterName|name$/i, 'Nguyễn Văn An'],
  [/code|^so$|^ma/i, 'HSBA-2026-000123'],
];

function sampleFor(key: string, label: string, type: string): unknown {
  const now = new Date();
  if (type === 'date') return now.toISOString().slice(0, 10);
  if (type === 'datetime') return now.toISOString();
  if (type === 'number' || type === 'integer') return 12;
  if (type === 'currency') return 1250000;
  if (type === 'percent') return 0.125;
  if (type === 'bool') return true;
  const leaf = key.split('.').pop() ?? key;
  for (const [re, v] of SAMPLE_TEXT) if (re.test(leaf)) return v;
  return label || key;
}

/** Sinh dữ liệu mẫu từ danh sách biến + mọi đường dẫn đang dùng trong thiết kế */
export function buildSampleData(
  doc: PrintDocument,
  /** Trường gợi ý khi mẫu không khai báo `variables` (vd trường riêng của phân hệ HSBA) — mặc định không thêm gì */
  fallback: Array<{ key: string; label: string; type: string }> = [],
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const vars = doc.variables?.length ? doc.variables : fallback;
  for (const v of vars) {
    if (['index', 'rowLabel', 'value'].includes(v.key) || v.key.startsWith('system.')) continue;
    setByPath(data, v.key, sampleFor(v.key, v.label, v.type));
  }
  const elements: PrintElement[] = [
    ...(doc.pages ?? []).flatMap((p) => p.elements ?? []),
    ...(doc.header?.elements ?? []),
    ...(doc.footer?.elements ?? []),
  ];
  const tableSources = new Set<string>();
  for (const el of elements) {
    if (el.binding?.path && el.type !== 'table') setByPath(data, el.binding.path, sampleFor(el.binding.path, '', el.binding.format?.type ?? 'text'));
    for (const m of String(el.text ?? '').matchAll(/\{([a-zA-Z0-9_.]+)\}/g)) {
      if (!m[1].startsWith('system.') && !['page', 'pages', 'total'].includes(m[1])) setByPath(data, m[1], sampleFor(m[1], '', 'text'));
    }
    if (el.type === 'table' && el.table) {
      const src = el.table.dataSource && el.table.dataSource !== 'rows' ? el.table.dataSource : 'rows';
      if (tableSources.has(src)) continue;
      tableSources.add(src);
      const rows = Array.from({ length: 5 }, (_, i) => {
        const row: Record<string, unknown> = {};
        for (const c of el.table?.columns ?? []) {
          const p = c.binding?.path;
          if (!p || p === 'index') continue;
          const t = c.binding?.format?.type ?? 'text';
          row[p] = t === 'text' ? `${c.title || p} ${i + 1}` : sampleFor(p, c.title, t) as number * (t === 'percent' ? 1 : i + 1);
        }
        return row;
      });
      setByPath(data, src, rows);
    }
  }
  // Chữ ký mẫu
  const sig = (data['signature'] as Record<string, Record<string, unknown>> | undefined) ?? {};
  Object.values(sig).forEach((s) => {
    if (s && typeof s === 'object') {
      s.signed = true;
      s.signedTime = s.signedTime ?? '27/09/2026 09:30';
    }
  });
  return data;
}
