/**
 * NGUỒN DỮ LIỆU SQL CHO MẪU IN
 *
 * Mẫu in có thể khai báo `document.sqlSource`:
 *   {
 *     queries: [{ key: 'cong_viec', label: 'Danh sách công việc', sql: 'select … where t.khoa_id = :khoa' }],
 *     params:  [{ name: 'khoa', label: 'Khoa/phòng', type: 'number', required: false }]
 *   }
 *
 * Khi kết xuất, máy chủ chạy từng truy vấn và đưa vào dữ liệu in:
 *   - `rows`               : kết quả truy vấn đầu tiên (bảng động mặc định);
 *   - `ds.<key>`           : mảng dòng của từng truy vấn (đặt `table.dataSource = 'ds.<key>'`);
 *   - `one.<key>.<cột>`    : dòng đầu tiên của từng truy vấn (trường đơn, ví dụ tiêu đề phiếu);
 *   - `params.<tên>`       : giá trị tham số người dùng nhập.
 *
 * Tham số tự động: `:nguoi_dung_id`, `:khoa_id`, `:pham_vi_khoa` (int[] — NULL = toàn viện).
 *
 * An toàn: chỉ một câu SELECT/WITH (qua rào chắn của SQL Console), chặn bảng/cột nhạy cảm,
 * tham số luôn ràng buộc ($n) — không nối chuỗi; chạy trong giao dịch READ ONLY, timeout 15s,
 * tối đa 5000 dòng mỗi truy vấn; soạn SQL cần quyền `print.datasource.sql`; mọi lần chạy đều ghi audit.
 */
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { AccessContext, ClientMeta } from '../../common/types/access-context';
import { DbService } from '../../db/db.service';
import { AuditService } from '../audit/audit.service';
import { sqlTokens, validateSql } from '../sql-console/sql-console.policy';

export const PRINT_SQL_PERMISSION = 'print.datasource.sql';
export const PRINT_SQL_MAX_ROWS = 5000;
export const PRINT_SQL_TIMEOUT_MS = 15_000;
const MAX_QUERIES = 10;
const MAX_PARAMS = 20;

export type PrintSqlParamType = 'text' | 'number' | 'date' | 'boolean';
export interface PrintSqlParam {
  name: string;
  label?: string;
  type: PrintSqlParamType;
  required?: boolean;
  default?: string;
}
export interface PrintSqlQuery {
  key: string;
  label?: string;
  sql: string;
}
export interface PrintSqlSource {
  queries: PrintSqlQuery[];
  params?: PrintSqlParam[];
}

export const AUTO_PARAMS: Record<string, { cast: string; label: string }> = {
  nguoi_dung_id: { cast: 'int', label: 'ID người dùng đang in' },
  khoa_id: { cast: 'int', label: 'ID khoa/phòng của người đang in' },
  pham_vi_khoa: { cast: 'int[]', label: 'Danh sách khoa/phòng trong phạm vi dữ liệu (NULL = toàn viện)' },
};

const CASTS: Record<PrintSqlParamType, string> = { text: 'text', number: 'numeric', date: 'date', boolean: 'boolean' };

/** Bảng/cột/hàm không được đọc từ mẫu in. So khớp theo token (đã viết hoa). */
const DENY_TOKENS = new Set(
  [
    'user_biometrics', 'integration_keys', 'settings', 'login_logs', '_qlbs_migrations', 'user_sessions', 'refresh_tokens',
    'password_hash', 'two_factor_secret', 'key_hash', 'secret_hash', 'telegram_chat_id', 'token_hash',
    'query_to_xml', 'query_to_xml_and_xmlschema', 'table_to_xml', 'database_to_xml', 'schema_to_xml', 'cursor_to_xml',
    'current_setting', 'pg_read_file', 'lo_get', 'information_schema', 'inet_server_addr', 'version',
  ].map((t) => t.toUpperCase()),
);

export function assertSafePrintSql(sql: string): string {
  const raw = String(sql ?? '').trim();
  if (raw.length > 20_000) throw new BadRequestException('Mỗi truy vấn mẫu in tối đa 20.000 ký tự');
  const validated = validateSql(raw, 'READ');
  if (validated.operation !== 'SELECT') throw new BadRequestException('Nguồn dữ liệu mẫu in chỉ nhận một câu SELECT hoặc WITH … SELECT');
  for (const token of sqlTokens(raw)) {
    if (DENY_TOKENS.has(token) || token.startsWith('PG_')) {
      throw new BadRequestException(`Mẫu in không được truy cập “${token.toLowerCase()}” (bảng/cột/hàm hệ thống hoặc dữ liệu nhạy cảm)`);
    }
  }
  return raw;
}

/** Kiểm tra cấu trúc + chính sách. Trả về null khi không khai báo nguồn SQL. */
export function normalizeSqlSource(input: unknown): PrintSqlSource | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object') throw new BadRequestException('sqlSource không hợp lệ');
  const src = input as { queries?: unknown; params?: unknown };
  const queries = Array.isArray(src.queries) ? src.queries : [];
  const paramsIn = Array.isArray(src.params) ? src.params : [];
  if (queries.length === 0) return null;
  if (queries.length > MAX_QUERIES) throw new BadRequestException(`Tối đa ${MAX_QUERIES} truy vấn cho một mẫu in`);
  if (paramsIn.length > MAX_PARAMS) throw new BadRequestException(`Tối đa ${MAX_PARAMS} tham số`);
  const keys = new Set<string>();
  const outQueries: PrintSqlQuery[] = queries.map((q, i) => {
    const item = (q ?? {}) as Record<string, unknown>;
    const key = String(item['key'] ?? '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(key)) throw new BadRequestException(`Khoá truy vấn #${i + 1} chỉ gồm chữ không dấu, số, gạch dưới`);
    if (keys.has(key)) throw new BadRequestException(`Khoá truy vấn “${key}” bị trùng`);
    keys.add(key);
    return { key, label: String(item['label'] ?? '').slice(0, 200), sql: assertSafePrintSql(String(item['sql'] ?? '')) };
  });
  const names = new Set<string>();
  const outParams: PrintSqlParam[] = paramsIn.map((p, i) => {
    const item = (p ?? {}) as Record<string, unknown>;
    const name = String(item['name'] ?? '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(name)) throw new BadRequestException(`Tên tham số #${i + 1} chỉ gồm chữ không dấu, số, gạch dưới`);
    if (AUTO_PARAMS[name]) throw new BadRequestException(`“${name}” là tham số tự động, không khai báo lại`);
    if (names.has(name)) throw new BadRequestException(`Tham số “${name}” bị trùng`);
    names.add(name);
    const type = String(item['type'] ?? 'text') as PrintSqlParamType;
    if (!CASTS[type]) throw new BadRequestException(`Kiểu tham số “${name}” không hợp lệ`);
    return {
      name,
      label: String(item['label'] ?? '').slice(0, 200),
      type,
      required: item['required'] === true,
      default: item['default'] === undefined || item['default'] === null ? '' : String(item['default']).slice(0, 200),
    };
  });
  // Mọi :tham_so trong SQL phải được khai báo (hoặc là tham số tự động)
  for (const q of outQueries) {
    for (const used of namedParams(q.sql)) {
      if (!names.has(used) && !AUTO_PARAMS[used]) throw new BadRequestException(`Truy vấn “${q.key}” dùng tham số :${used} chưa khai báo`);
    }
  }
  return { queries: outQueries, params: outParams };
}

/**
 * Duyệt SQL (bỏ qua chuỗi, định danh có nháy, comment, dollar-quote) và gọi `onParam` cho mỗi `:ten`.
 * `::kieu` (ép kiểu PostgreSQL) không phải tham số.
 */
function scanParams(sql: string, onParam: (name: string, start: number, end: number) => void): void {
  let i = 0;
  while (i < sql.length) {
    const c = sql[i] ?? '';
    const next = sql[i + 1] ?? '';
    if (c === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
      continue;
    }
    if (c === "'" || c === '"') {
      i++;
      while (i < sql.length) {
        if (sql[i] === c && sql[i + 1] === c) {
          i += 2;
          continue;
        }
        if (sql[i] === c) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '$') {
      const m = sql.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (m) {
        const end = sql.indexOf(m[0], i + m[0].length);
        i = end < 0 ? sql.length : end + m[0].length;
        continue;
      }
    }
    if (c === ':' && next === ':') {
      i += 2;
      continue;
    }
    if (c === ':' && /[A-Za-z_]/.test(next)) {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j] ?? '')) j++;
      onParam(sql.slice(i + 1, j), i, j);
      i = j;
      continue;
    }
    i++;
  }
}

export function namedParams(sql: string): string[] {
  const out = new Set<string>();
  scanParams(sql, (name) => out.add(name));
  return [...out];
}

/** Đổi `:ten` → `$n::kieu`; cùng tên dùng lại cùng vị trí. */
export function bindNamedParams(sql: string, values: Record<string, { value: unknown; cast: string }>): { text: string; values: unknown[] } {
  const order: string[] = [];
  const parts: string[] = [];
  let last = 0;
  scanParams(sql, (name, start, end) => {
    const spec = values[name];
    if (!spec) throw new BadRequestException(`Tham số :${name} chưa khai báo`);
    let idx = order.indexOf(name);
    if (idx < 0) {
      order.push(name);
      idx = order.length - 1;
    }
    parts.push(sql.slice(last, start), `$${idx + 1}::${spec.cast}`);
    last = end;
  });
  parts.push(sql.slice(last));
  return { text: parts.join(''), values: order.map((n) => values[n]!.value) };
}

/** Phạm vi khoa của người in: NULL = toàn viện. */
export function scopeDepartments(user: AccessContext): number[] | null {
  if (user.isSuperAdmin || user.dataScope === 'ALL') return null;
  if (user.dataScope === 'OWN') return [];
  const ids = new Set(user.departmentIds ?? []);
  if (user.departmentId) ids.add(user.departmentId);
  return [...ids];
}

export function coerceParam(p: PrintSqlParam, raw: unknown): unknown {
  const text = raw === undefined || raw === null ? '' : String(raw).trim();
  const value = text === '' ? (p.default ?? '').trim() : text;
  if (value === '') {
    if (p.required) throw new BadRequestException(`Vui lòng nhập “${p.label || p.name}”`);
    return null;
  }
  switch (p.type) {
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new BadRequestException(`“${p.label || p.name}” phải là số`);
      return n;
    }
    case 'date': {
      const v = value === 'today' ? new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10) : value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) {
        throw new BadRequestException(`“${p.label || p.name}” phải là ngày dạng YYYY-MM-DD`);
      }
      return v;
    }
    case 'boolean':
      return ['1', 'true', 'co', 'có', 'yes', 'on'].includes(value.toLowerCase());
    default:
      return value.slice(0, 1000);
  }
}

const plain = (v: unknown): unknown => {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return Number(v);
  return v;
};

interface QueryClient {
  query: (text: string, values?: unknown[]) => Promise<{ rows?: Record<string, unknown>[]; fields?: Array<{ name: string }> }>;
}

export interface PrintSqlResult {
  data: { ds: Record<string, Record<string, unknown>[]>; one: Record<string, Record<string, unknown>>; params: Record<string, unknown> };
  rows: Record<string, unknown>[];
  queries: Array<{ key: string; label: string; columns: string[]; rowCount: number; truncated: boolean; ms: number }>;
}

@Injectable()
export class PrintSqlService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  canAuthor(user: AccessContext): boolean {
    return user.isSuperAdmin || user.permissions.includes(PRINT_SQL_PERMISSION);
  }

  /** Chỉ người có quyền mới được thêm/sửa SQL của mẫu in. */
  assertCanSave(user: AccessContext | undefined, nextDoc: unknown, prevDoc?: unknown): PrintSqlSource | null {
    const next = normalizeSqlSource((nextDoc as { sqlSource?: unknown } | undefined)?.sqlSource);
    const prev = (prevDoc as { sqlSource?: unknown } | undefined)?.sqlSource;
    const changed = JSON.stringify(next ?? null) !== JSON.stringify(normalizeSqlSourceLoose(prev));
    if (changed && (!user || !this.canAuthor(user))) {
      throw new ForbiddenException('Cần quyền “Soạn nguồn dữ liệu SQL cho mẫu in” (print.datasource.sql) để thêm/sửa truy vấn SQL');
    }
    return next;
  }

  async run(
    user: AccessContext,
    source: PrintSqlSource,
    input: Record<string, unknown> = {},
    opts: { maxRows?: number; meta?: ClientMeta; templateId?: number | null; purpose?: string } = {},
  ): Promise<PrintSqlResult> {
    const maxRows = Math.min(PRINT_SQL_MAX_ROWS, Math.max(1, opts.maxRows ?? PRINT_SQL_MAX_ROWS));
    const params: Record<string, unknown> = {};
    const bindings: Record<string, { value: unknown; cast: string }> = {
      nguoi_dung_id: { value: user.id, cast: AUTO_PARAMS['nguoi_dung_id']!.cast },
      khoa_id: { value: user.departmentId ?? null, cast: AUTO_PARAMS['khoa_id']!.cast },
      pham_vi_khoa: { value: scopeDepartments(user), cast: AUTO_PARAMS['pham_vi_khoa']!.cast },
    };
    for (const p of source.params ?? []) {
      const value = coerceParam(p, input[p.name]);
      params[p.name] = value;
      bindings[p.name] = { value, cast: CASTS[p.type] };
    }
    const started = Date.now();
    const out: PrintSqlResult = { data: { ds: {}, one: {}, params }, rows: [], queries: [] };
    try {
      await this.db.withClient(async (client: QueryClient) => {
        await client.query('begin read only');
        try {
          await client.query(`set local statement_timeout = '${PRINT_SQL_TIMEOUT_MS}ms'`);
          await client.query(`set local lock_timeout = '3000ms'`);
          for (const q of source.queries) {
            const t0 = Date.now();
            const safe = assertSafePrintSql(q.sql);
            const bound = bindNamedParams(safe, bindings);
            const res = await client.query(`select * from (${bound.text}) as "__qlbs_print_sql" limit ${maxRows + 1}`, bound.values);
            const raw = res.rows ?? [];
            const rows = raw.slice(0, maxRows).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)])));
            out.data.ds[q.key] = rows;
            out.data.one[q.key] = rows[0] ?? {};
            out.queries.push({
              key: q.key,
              label: q.label ?? '',
              columns: res.fields?.map((f) => f.name) ?? Object.keys(rows[0] ?? {}),
              rowCount: rows.length,
              truncated: raw.length > maxRows,
              ms: Date.now() - t0,
            });
          }
          await client.query('commit');
        } catch (err) {
          await client.query('rollback').catch(() => undefined);
          throw err;
        }
      });
    } catch (err) {
      this.log(user, opts, source, params, { ok: false, error: (err as Error).message, ms: Date.now() - started });
      if (err instanceof BadRequestException || err instanceof ForbiddenException) throw err;
      throw new BadRequestException(`Truy vấn nguồn dữ liệu lỗi: ${(err as Error).message}`);
    }
    out.rows = out.data.ds[source.queries[0]!.key] ?? [];
    this.log(user, opts, source, params, { ok: true, ms: Date.now() - started, rows: out.queries.map((q) => `${q.key}:${q.rowCount}`).join(', ') });
    return out;
  }

  private log(
    user: AccessContext,
    opts: { meta?: ClientMeta; templateId?: number | null; purpose?: string },
    source: PrintSqlSource,
    params: Record<string, unknown>,
    detail: Record<string, unknown>,
  ) {
    void this.audit.log({
      userId: user.id,
      username: user.username,
      fullName: user.fullName,
      action: opts.purpose === 'test' ? 'SQL_TEST' : opts.purpose === 'export' ? 'SQL_EXPORT' : 'SQL_RENDER',
      module: 'PRINT',
      entity: 'print_template',
      entityId: opts.templateId ? String(opts.templateId) : '',
      description: opts.purpose === 'test' ? 'Chạy thử nguồn dữ liệu SQL của mẫu in'
        : opts.purpose === 'export' ? 'Xuất Excel/CSV dữ liệu nguồn SQL của mẫu in' : 'Kết xuất mẫu in có nguồn dữ liệu SQL',
      afterData: { queries: source.queries.map((q) => ({ key: q.key, sql: q.sql.slice(0, 20_000) })), params, ...detail },
      departmentId: user.departmentId,
      ip: opts.meta?.ip ?? '',
      userAgent: opts.meta?.userAgent ?? '',
    });
  }
}

/** So sánh thay đổi: không ném lỗi với dữ liệu cũ (đã lưu trước đây). */
function normalizeSqlSourceLoose(input: unknown): PrintSqlSource | null {
  try {
    return normalizeSqlSource(input);
  } catch {
    return { queries: [{ key: '__invalid__', sql: JSON.stringify(input) }] };
  }
}

/* ------------------------------------------------------------ Xuất dữ liệu */

function cellValue(v: unknown): string | number | boolean | Date | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'boolean' || v instanceof Date) return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function csvCell(v: unknown): string {
  const c = cellValue(v);
  if (c === null) return '';
  const s = c instanceof Date ? c.toISOString() : String(c);
  // Chống CSV/Excel formula injection
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Xuất kết quả nguồn SQL: Excel (mỗi truy vấn một sheet) hoặc CSV (một truy vấn). */
export async function buildSqlExport(
  result: PrintSqlResult,
  format: 'xlsx' | 'csv',
  queryKey?: string,
): Promise<{ buffer: Buffer; fileName: string; mime: string }> {
  const stamp = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const columnsOf = (q: PrintSqlResult['queries'][number]) => {
    const rows = result.data.ds[q.key] ?? [];
    return q.columns.length ? q.columns : rows[0] ? Object.keys(rows[0]) : [];
  };
  if (format === 'csv') {
    const q = result.queries.find((x) => x.key === queryKey) ?? result.queries[0];
    if (!q) throw new BadRequestException('Không có truy vấn để xuất');
    const cols = columnsOf(q);
    const lines = [cols.map(csvCell).join(','), ...(result.data.ds[q.key] ?? []).map((r) => cols.map((c) => csvCell(r[c])).join(','))];
    return { buffer: Buffer.from('\uFEFF' + lines.join('\r\n'), 'utf8'), fileName: `nguon_sql_${q.key}_${stamp}.csv`, mime: 'text/csv; charset=utf-8' };
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QLBS';
  const used = new Set<string>();
  for (const q of result.queries) {
    let name = (q.label || q.key).replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || q.key.slice(0, 31);
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${name.slice(0, 27)} (${i})`;
    used.add(name.toLowerCase());
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    const cols = columnsOf(q);
    const rows = result.data.ds[q.key] ?? [];
    ws.columns = cols.map((c) => ({
      header: c,
      key: c,
      width: Math.min(60, Math.max(10, c.length + 2, ...rows.slice(0, 200).map((r) => String(cellValue(r[c]) ?? '').length + 2))),
    }));
    for (const r of rows) ws.addRow(cols.map((c) => cellValue(r[c])));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    if (cols.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    if (q.truncated) ws.addRow([`… đã cắt ở ${q.rowCount} dòng (giới hạn ${PRINT_SQL_MAX_ROWS})`]).font = { italic: true, color: { argb: 'FFB45309' } };
  }
  if (!result.queries.length) wb.addWorksheet('Trống');
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, fileName: `nguon_sql_${stamp}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
}
