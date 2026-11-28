/**
 * TRÌNH DỰNG TRUY VẤN KHÔNG CẦN VIẾT SQL CHO MẪU IN
 *
 * Người thiết kế chọn trên giao diện: bảng/view → các cột cần in → điều kiện lọc
 * (giá trị cố định, tham số người in nhập hoặc tham số tự động) → sắp xếp → giới hạn.
 * Máy chủ tự sinh câu SELECT từ cấu hình (`builder`) — không nhận SQL thô từ phần này:
 *   - mọi tên bảng/cột phải khớp ^[a-z_][a-z0-9_]*$ và luôn được đặt trong "nháy kép";
 *   - giá trị cố định được escape thành chuỗi SQL ('' nhân đôi), tham số luôn ràng buộc $n;
 *   - câu sinh ra tiếp tục đi qua đúng rào chắn của nguồn SQL (chỉ đọc, chặn bảng nhạy cảm…).
 *
 * Nhờ đọc danh mục bảng ngay từ CSDL, bảng/phân hệ thêm sau này tự xuất hiện để thiết kế
 * bản in mà không phải sửa mã nguồn.
 */
import { BadRequestException } from '@nestjs/common';
import { COLUMN_COMMENTS, COLUMN_COMMENTS_COMMON, TABLE_COMMENTS } from '../../db/schema-comments';

export const BUILDER_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'starts', 'is_null', 'not_null', 'is_true', 'is_false'] as const;
export type BuilderOp = (typeof BUILDER_OPS)[number];
export const BUILDER_AGGS = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'] as const;
export type BuilderAgg = (typeof BUILDER_AGGS)[number];

export interface BuilderColumn {
  name: string;
  /** Nhãn hiển thị (tiêu đề cột khi chèn bảng, tên trường trong danh sách) */
  label?: string;
  agg?: BuilderAgg;
  /** Tên cột kết quả (mặc định = tên cột hoặc <hàm>_<cột>) */
  alias?: string;
}

export interface BuilderFilter {
  column: string;
  op: BuilderOp;
  /** Kiểu cột lấy từ danh mục (để so sánh ngày theo giờ Việt Nam) */
  columnType?: string;
  /** Giá trị cố định */
  value?: string;
  /** Hoặc tên tham số (:ten) — tham số người in nhập hoặc tham số tự động */
  param?: string;
}

export interface BuilderSort {
  column: string;
  dir?: 'asc' | 'desc';
}

export interface QueryBuilderSpec {
  table: string;
  columns: BuilderColumn[];
  filters?: BuilderFilter[];
  sort?: BuilderSort[];
  limit?: number;
  /** Cột khoa/phòng để tự giới hạn theo phạm vi dữ liệu của người in (khuyên dùng) */
  scopeColumn?: string;
  distinct?: boolean;
}

const IDENT_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const MAX_COLUMNS = 80;
const MAX_FILTERS = 20;
const MAX_SORT = 5;

function ident(name: unknown, what: string): string {
  const v = String(name ?? '').trim();
  if (!IDENT_RE.test(v)) throw new BadRequestException(`${what} “${v}” không hợp lệ (chỉ chữ thường không dấu, số, gạch dưới)`);
  return v;
}

const q = (name: string): string => `"${name}"`;
const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`;
const isTimestamptz = (t?: string): boolean => /timestamp with time zone|timestamptz/i.test(t ?? '');
const isTimestamp = (t?: string): boolean => /timestamp/i.test(t ?? '');

/** Kiểm tra + chuẩn hoá cấu hình (loại bỏ khoá lạ, giới hạn kích thước). */
export function normalizeBuilderSpec(input: unknown): QueryBuilderSpec {
  if (!input || typeof input !== 'object') throw new BadRequestException('Cấu hình chọn bảng không hợp lệ');
  const raw = input as Record<string, unknown>;
  const table = ident(raw['table'], 'Tên bảng');
  const cols = Array.isArray(raw['columns']) ? raw['columns'] : [];
  if (!cols.length) throw new BadRequestException(`Chọn ít nhất một cột của bảng “${table}”`);
  if (cols.length > MAX_COLUMNS) throw new BadRequestException(`Tối đa ${MAX_COLUMNS} cột cho một truy vấn`);
  const aliases = new Set<string>();
  const columns: BuilderColumn[] = cols.map((c) => {
    const item = (c ?? {}) as Record<string, unknown>;
    const agg = item['agg'] ? String(item['agg']) : '';
    if (agg && !(BUILDER_AGGS as readonly string[]).includes(agg)) throw new BadRequestException(`Hàm tổng hợp “${agg}” không hợp lệ`);
    const name = agg === 'count' && (item['name'] === '*' || !item['name']) ? '*' : ident(item['name'], 'Tên cột');
    const fallbackAlias = agg ? (name === '*' ? 'so_luong' : `${agg}_${name}`) : name;
    const alias = item['alias'] ? ident(item['alias'], 'Tên cột kết quả') : fallbackAlias;
    if (aliases.has(alias)) throw new BadRequestException(`Cột kết quả “${alias}” bị trùng — đặt tên khác`);
    aliases.add(alias);
    return {
      name,
      ...(agg ? { agg: agg as BuilderAgg } : {}),
      ...(alias !== name ? { alias } : {}),
      ...(item['label'] ? { label: String(item['label']).slice(0, 120) } : {}),
    };
  });
  if (columns.some((c) => c.name === '*' && c.agg !== 'count')) throw new BadRequestException('Chỉ dùng * với hàm đếm');
  const filtersIn = Array.isArray(raw['filters']) ? raw['filters'] : [];
  if (filtersIn.length > MAX_FILTERS) throw new BadRequestException(`Tối đa ${MAX_FILTERS} điều kiện lọc`);
  const filters: BuilderFilter[] = filtersIn.map((f) => {
    const item = (f ?? {}) as Record<string, unknown>;
    const op = String(item['op'] ?? 'eq');
    if (!(BUILDER_OPS as readonly string[]).includes(op)) throw new BadRequestException(`Phép so sánh “${op}” không hợp lệ`);
    const out: BuilderFilter = { column: ident(item['column'], 'Cột lọc'), op: op as BuilderOp };
    const type = String(item['columnType'] ?? '').slice(0, 60);
    if (type && /^[a-z0-9 _()[\]]+$/i.test(type)) out.columnType = type;
    if (!['is_null', 'not_null', 'is_true', 'is_false'].includes(op)) {
      if (item['param']) out.param = ident(item['param'], 'Tên tham số');
      else out.value = String(item['value'] ?? '').slice(0, 500);
    }
    return out;
  });
  const sortIn = Array.isArray(raw['sort']) ? raw['sort'] : [];
  if (sortIn.length > MAX_SORT) throw new BadRequestException(`Tối đa ${MAX_SORT} cột sắp xếp`);
  const sort: BuilderSort[] = sortIn.map((s) => {
    const item = (s ?? {}) as Record<string, unknown>;
    return { column: ident(item['column'], 'Cột sắp xếp'), dir: item['dir'] === 'desc' ? 'desc' : 'asc' };
  });
  const limitRaw = Number(raw['limit']);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(5000, Math.floor(limitRaw)) : undefined;
  const scopeColumn = raw['scopeColumn'] ? ident(raw['scopeColumn'], 'Cột phạm vi khoa') : undefined;
  return {
    table,
    columns,
    ...(filters.length ? { filters } : {}),
    ...(sort.length ? { sort } : {}),
    ...(limit ? { limit } : {}),
    ...(scopeColumn ? { scopeColumn } : {}),
    ...(raw['distinct'] === true ? { distinct: true } : {}),
  };
}

function columnExpr(c: BuilderColumn): string {
  const col = c.name === '*' ? '*' : `t.${q(c.name)}`;
  switch (c.agg) {
    case 'count':
      return `count(${col})`;
    case 'count_distinct':
      return `count(DISTINCT ${col})`;
    case 'sum':
    case 'avg':
    case 'min':
    case 'max':
      return `${c.agg}(${col})`;
    default:
      return col;
  }
}

function filterExpr(f: BuilderFilter): string {
  const col = `t.${q(f.column)}`;
  // Cột ngày giờ so với giá trị dạng ngày → so theo ngày lịch Việt Nam
  const dateLike = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const rhs = f.param ? `:${f.param}` : lit(f.value ?? '');
  const compareDate = isTimestamp(f.columnType) && (f.param ? true : dateLike(f.value ?? ''));
  const left = compareDate
    ? isTimestamptz(f.columnType)
      ? `(${col} AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`
      : `${col}::date`
    : col;
  let expr: string;
  switch (f.op) {
    case 'is_null':
      return `${col} IS NULL`;
    case 'not_null':
      return `${col} IS NOT NULL`;
    case 'is_true':
      return `${col} IS TRUE`;
    case 'is_false':
      return `${col} IS NOT TRUE`;
    case 'contains':
      expr = `${col}::text ILIKE '%' || ${rhs} || '%'`;
      break;
    case 'starts':
      expr = `${col}::text ILIKE ${rhs} || '%'`;
      break;
    case 'ne':
      expr = `${left} <> ${rhs}`;
      break;
    case 'gt':
      expr = `${left} > ${rhs}`;
      break;
    case 'gte':
      expr = `${left} >= ${rhs}`;
      break;
    case 'lt':
      expr = `${left} < ${rhs}`;
      break;
    case 'lte':
      expr = `${left} <= ${rhs}`;
      break;
    default:
      expr = `${left} = ${rhs}`;
  }
  // Tham số để trống khi in → bỏ qua điều kiện này (lọc tuỳ chọn)
  return f.param ? `(:${f.param} IS NULL OR ${expr})` : expr;
}

/** Sinh câu SELECT từ cấu hình đã chuẩn hoá. */
export function buildSqlFromSpec(spec: QueryBuilderSpec): string {
  const select = spec.columns.map((c) => {
    const alias = c.alias ?? (c.agg ? (c.name === '*' ? 'so_luong' : `${c.agg}_${c.name}`) : c.name);
    const expr = columnExpr(c);
    return expr === `t.${q(alias)}` ? expr : `${expr} AS ${q(alias)}`;
  });
  const where: string[] = [];
  if (spec.scopeColumn) where.push(`(:pham_vi_khoa IS NULL OR t.${q(spec.scopeColumn)} = ANY(:pham_vi_khoa))`);
  for (const f of spec.filters ?? []) where.push(filterExpr(f));
  const hasAgg = spec.columns.some((c) => c.agg);
  const groupBy = hasAgg ? spec.columns.filter((c) => !c.agg).map((c) => `t.${q(c.name)}`) : [];
  const outputNames = new Map(spec.columns.map((c) => [c.name, c.alias ?? c.name]));
  const order = (spec.sort ?? []).map((s) => {
    // Khi có tổng hợp, chỉ sắp theo cột đã nhóm hoặc theo cột kết quả
    const target = hasAgg && !groupBy.includes(`t.${q(s.column)}`) ? q(outputNames.get(s.column) ?? s.column) : `t.${q(s.column)}`;
    return `${target} ${s.dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST`;
  });
  const lines = [
    `SELECT ${spec.distinct && !hasAgg ? 'DISTINCT ' : ''}${select.join(', ')}`,
    `FROM ${q(spec.table)} AS t`,
    ...(where.length ? [`WHERE ${where.join('\n  AND ')}`] : []),
    ...(groupBy.length ? [`GROUP BY ${groupBy.join(', ')}`] : []),
    ...(order.length ? [`ORDER BY ${order.join(', ')}`] : []),
    ...(spec.limit ? [`LIMIT ${spec.limit}`] : []),
  ];
  return lines.join('\n');
}

/* ------------------------------------------------------------ Nhãn tiếng Việt */

/** Cụm từ thường gặp trong tên cột view tiếng Việt không dấu → có dấu. */
const PHRASES: Record<string, string> = {
  ma_nv: 'Mã NV',
  ho_ten: 'Họ tên',
  ten_dang_nhap: 'Tên đăng nhập',
  dien_thoai: 'Điện thoại',
  chuc_danh: 'Chức danh',
  dang_hoat_dong: 'Đang hoạt động',
  tieu_de: 'Tiêu đề',
  mo_ta: 'Mô tả',
  noi_dung: 'Nội dung',
  ket_qua: 'Kết quả',
  ly_do: 'Lý do',
  ghi_chu: 'Ghi chú',
  trang_thai: 'Trạng thái',
  uu_tien: 'Ưu tiên',
  tien_do: 'Tiến độ',
  han_chot: 'Hạn chót',
  qua_han: 'Quá hạn',
  dung_han: 'Đúng hạn',
  tre_han: 'Trễ hạn',
  du_an: 'Dự án',
  thanh_vien: 'Thành viên',
  quan_ly: 'Quản lý',
  hoan_thanh: 'Hoàn thành',
  bat_dau: 'Bắt đầu',
  ket_thuc: 'Kết thúc',
  gui_duyet: 'Gửi duyệt',
  tra_lai: 'Trả lại',
  thoi_gian: 'Thời gian',
  thao_tac: 'Thao tác',
  cong_viec: 'Công việc',
  nguoi_dung: 'Người dùng',
  nguoi_viet: 'Người viết',
  nguoi_giao: 'Người giao',
  nguoi_duyet: 'Người duyệt',
  nguoi_thuc_hien: 'Người thực hiện',
  thuc_hien: 'Thực hiện',
  uoc_luong: 'Ước lượng',
  so_luong: 'Số lượng',
  so_lan: 'Số lần',
  so_gio: 'Số giờ',
  so_ngay: 'Số ngày',
  gio_cong: 'Giờ công',
  so_voi: 'So với',
  viec_cha: 'Việc cha',
  tong_viec: 'Tổng việc',
  khoa_id: 'ID khoa/phòng',
  ten_khoa: 'Tên khoa/phòng',
  khoa: 'Khoa/phòng',
};
const WORDS: Record<string, string> = {
  ma: 'mã', ten: 'tên', ngay: 'ngày', gio: 'giờ', so: 'số', tong: 'tổng', nhan: 'nhận', tao: 'tạo', huy: 'huỷ', giao: 'giao',
  sang: 'sang', tu: 'từ', den: 'đến', lam: 'làm', viec: 'việc', nguoi: 'người', id: 'ID', tien: 'tiền', ty: 'tỷ', le: 'lệ',
  cho: 'chờ', duyet: 'duyệt', mo: 'mở', da: 'đã', dang: 'đang', ky: 'kỳ', in: 'in', tre: 'trễ', han: 'hạn', lan: 'lần',
};

/** Rút gọn ghi chú cột trong từ điển dữ liệu thành nhãn ngắn. */
function shortComment(comment: string | undefined): string | null {
  if (!comment) return null;
  if (/[|]/.test(comment)) return null;
  const head = comment.split(/[:(;—–]| - /)[0]?.trim() ?? '';
  if (!head || head.length > 48 || /^[A-Z0-9_ /]+$/.test(head)) return null;
  return head;
}

/** Nhãn dễ hiểu cho tên cột: từ điển dữ liệu → cụm từ tiếng Việt → tách chữ. */
export function columnLabel(column: string, tables: string[] = []): string {
  for (const table of tables) {
    const hit = shortComment(COLUMN_COMMENTS[table]?.[column]);
    if (hit) return hit;
  }
  if (PHRASES[column]) return PHRASES[column]!;
  const common = column === 'id' ? 'ID' : shortComment(COLUMN_COMMENTS_COMMON[column]);
  if (common) return common;
  const parts = column.split('_').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length; ) {
    let matched = false;
    for (let len = Math.min(3, parts.length - i); len >= 2; len--) {
      const phrase = PHRASES[parts.slice(i, i + len).join('_')];
      if (phrase) {
        out.push(out.length ? phrase.toLowerCase() : phrase);
        i += len;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    out.push(WORDS[parts[i]!] ?? parts[i]!);
    i += 1;
  }
  const text = out.join(' ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : column;
}

/** Nhãn ngắn của bảng (từ điển dữ liệu) */
export function tableLabel(table: string): string {
  const c = TABLE_COMMENTS[table];
  if (c) return c.split(/[—–(]| - /)[0]!.trim().slice(0, 80);
  if (table.startsWith('v_')) return `View ${table.slice(2).replace(/_/g, ' ')}`;
  return table.replace(/_/g, ' ');
}

/** Tên bảng/view xuất hiện trong câu SQL (để tra nhãn cột). */
export function referencedTables(sql: string, known: Iterable<string>): string[] {
  const lower = sql.toLowerCase();
  const out: string[] = [];
  for (const t of known) {
    if (new RegExp(`(^|[^a-z0-9_])"?${t}"?([^a-z0-9_]|$)`).test(lower)) out.push(t);
  }
  // View tiếng Việt trước (tên cột trùng), bảng gốc sau
  return out.sort((a, b) => Number(b.startsWith('v_')) - Number(a.startsWith('v_')));
}

/** Kiểu dữ liệu PostgreSQL (OID) → kiểu định dạng in. */
export function pgTypeToFieldType(oid: number | undefined): string {
  switch (oid) {
    case 16:
      return 'bool';
    case 20:
    case 21:
    case 23:
      return 'integer';
    case 700:
    case 701:
    case 1700:
      return 'number';
    case 1082:
      return 'date';
    case 1114:
    case 1184:
      return 'datetime';
    default:
      return 'text';
  }
}

/** Kiểu cột information_schema → kiểu định dạng in. */
export function sqlTypeToFieldType(type: string): string {
  const t = type.toLowerCase();
  if (t === 'boolean') return 'bool';
  if (/smallint|integer|bigint/.test(t)) return 'integer';
  if (/numeric|real|double|decimal/.test(t)) return 'number';
  if (t === 'date') return 'date';
  if (t.startsWith('timestamp')) return 'datetime';
  return 'text';
}
