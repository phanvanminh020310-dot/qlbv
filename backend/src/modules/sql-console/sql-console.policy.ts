import { BadRequestException } from '@nestjs/common';

/**
 * Rào chắn cú pháp cho SQL Console.
 *
 * Đây không phải trình phân tích SQL hoàn chỉnh: PostgreSQL vẫn là nơi phân tích
 * cuối cùng. Lớp này giới hạn console ở một câu lệnh SELECT/EXPLAIN hoặc DML cơ
 * bản, chống chuỗi nhiều lệnh và các thao tác phá cấu trúc CSDL trước khi câu
 * lệnh được chuyển tới PostgreSQL.
 */
export type SqlMode = 'READ' | 'WRITE';
export type SqlOperation = 'SELECT' | 'EXPLAIN' | 'INSERT' | 'UPDATE' | 'DELETE';

export interface ValidatedSql {
  statement: string;
  mode: SqlMode;
  operation: SqlOperation;
  tokens: string[];
}

const WRITE_FIRST = new Set(['INSERT', 'UPDATE', 'DELETE']);
const READ_FIRST = new Set(['SELECT', 'WITH', 'EXPLAIN']);
const READ_FORBIDDEN = new Set([
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'INTO',
  'COPY', 'CALL', 'DO', 'GRANT', 'REVOKE', 'VACUUM', 'ANALYZE', 'REFRESH', 'SET',
  'LOCK', 'LISTEN', 'NOTIFY',
]);
const READ_FORBIDDEN_FUNCTIONS = new Set([
  'PG_TERMINATE_BACKEND', 'PG_CANCEL_BACKEND', 'PG_RELOAD_CONF', 'PG_ROTATE_LOGFILE',
  'PG_READ_FILE', 'PG_READ_BINARY_FILE', 'PG_WRITE_FILE', 'PG_STAT_FILE', 'PG_LS_DIR', 'PG_LOGDIR_LS',
  'SET_CONFIG', 'PG_ADVISORY_LOCK', 'PG_ADVISORY_XACT_LOCK', 'PG_TRY_ADVISORY_LOCK',
  'PG_TRY_ADVISORY_XACT_LOCK', 'PG_ADVISORY_UNLOCK', 'PG_ADVISORY_UNLOCK_ALL',
  'PG_SLEEP', 'PG_SLEEP_FOR', 'PG_SLEEP_UNTIL', 'PG_NOTIFY', 'DLOPEN', 'LO_IMPORT', 'LO_EXPORT',
  'LO_CREATE', 'LO_UNLINK', 'LO_OPEN', 'LOWRITE', 'DBLINK', 'DBLINK_CONNECT', 'DBLINK_EXEC',
  'PG_LOGICAL_EMIT_MESSAGE',
]);
const PROTECTED_WRITE_TABLES = new Set(['_qlbs_migrations', 'audit_logs', 'login_logs']);

/**
 * Trích token bên ngoài chuỗi, định danh có dấu nháy và comment. Đồng thời phát
 * hiện dấu chấm phẩy ngoài chuỗi (nghĩa là nhiều statement). SQL hợp lệ có thể
 * không cần ; nên console cố ý không nhận ; để loại bỏ entire class injection.
 */
export function sqlTokens(statement: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < statement.length) {
    const c = statement[i] ?? '';
    const next = statement[i + 1] ?? '';

    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === ';') throw new BadRequestException('SQL Console chỉ nhận một câu lệnh và không dùng dấu chấm phẩy (;)');
    if (c === '-' && next === '-') {
      i += 2;
      while (i < statement.length && statement[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = statement.indexOf('*/', i + 2);
      if (end < 0) throw new BadRequestException('Comment SQL chưa đóng');
      i = end + 2;
      continue;
    }
    if (c === "'") {
      i++;
      let closed = false;
      while (i < statement.length) {
        if (statement[i] === "'" && statement[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (statement[i] === "'") {
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) throw new BadRequestException('Chuỗi SQL chưa đóng');
      continue;
    }
    if (c === '"') {
      i++;
      let value = '';
      let closed = false;
      while (i < statement.length) {
        if (statement[i] === '"' && statement[i + 1] === '"') {
          value += '"';
          i += 2;
          continue;
        }
        if (statement[i] === '"') {
          i++;
          closed = true;
          break;
        }
        value += statement[i] ?? '';
        i++;
      }
      if (!closed) throw new BadRequestException('Định danh SQL chưa đóng');
      if (value) tokens.push(value.toUpperCase());
      continue;
    }
    if (c === '$') {
      const m = statement.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (m) {
        const marker = m[0];
        const end = statement.indexOf(marker, i + marker.length);
        if (end < 0) throw new BadRequestException('Chuỗi dollar-quoted SQL chưa đóng');
        i = end + marker.length;
        continue;
      }
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < statement.length && /[A-Za-z0-9_$]/.test(statement[j] ?? '')) j++;
      tokens.push(statement.slice(i, j).toUpperCase());
      i = j;
      continue;
    }
    i++;
  }
  return tokens;
}

function operationOf(tokens: string[]): SqlOperation {
  const first = tokens[0];
  if (first === 'SELECT' || first === 'WITH') return 'SELECT';
  if (first === 'EXPLAIN') return 'EXPLAIN';
  if (first === 'INSERT' || first === 'UPDATE' || first === 'DELETE') return first;
  throw new BadRequestException('Chỉ hỗ trợ SELECT, WITH, EXPLAIN, INSERT, UPDATE hoặc DELETE');
}

function touchedTable(tokens: string[], operation: SqlOperation): string | null {
  if (operation === 'UPDATE') return tokens[1] ?? null;
  const keyword = operation === 'INSERT' ? 'INTO' : 'FROM';
  const at = tokens.indexOf(keyword);
  return at >= 0 ? (tokens[at + 1] ?? null) : null;
}

/** Có WHERE ở cấp ngoài cùng — WHERE trong subquery không bảo vệ UPDATE/DELETE toàn bảng. */
function hasTopLevelWhere(statement: string): boolean {
  let i = 0;
  let depth = 0;
  while (i < statement.length) {
    const c = statement[i] ?? '';
    const next = statement[i + 1] ?? '';
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && next === '-') { i += 2; while (i < statement.length && statement[i] !== '\n') i++; continue; }
    if (c === '/' && next === '*') { const end = statement.indexOf('*/', i + 2); i = end < 0 ? statement.length : end + 2; continue; }
    if (c === "'" || c === '"') {
      const quote = c;
      i++;
      while (i < statement.length) {
        if (statement[i] === quote && statement[i + 1] === quote) { i += 2; continue; }
        if (statement[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '$') {
      const marker = statement.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (marker) { const end = statement.indexOf(marker, i + marker.length); i = end < 0 ? statement.length : end + marker.length; continue; }
    }
    if (c === '(') { depth++; i++; continue; }
    if (c === ')') { depth = Math.max(0, depth - 1); i++; continue; }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < statement.length && /[A-Za-z0-9_$]/.test(statement[j] ?? '')) j++;
      if (depth === 0 && statement.slice(i, j).toUpperCase() === 'WHERE') return true;
      i = j;
      continue;
    }
    i++;
  }
  return false;
}

function rejectProtectedTable(tokens: string[], operation: SqlOperation): void {
  const table = touchedTable(tokens, operation)?.toLowerCase();
  // Kiểm tra cả token để không bị vượt qua bằng schema hoặc định danh có dấu nháy,
  // ví dụ `update public."audit_logs" ...`.
  const protectedName = [table, ...tokens.map((token) => token.toLowerCase())].find((name) =>
    !!name && PROTECTED_WRITE_TABLES.has(name),
  );
  if (protectedName) {
    throw new BadRequestException(`Không được ghi trực tiếp vào bảng hệ thống ${protectedName}; nhật ký và migration phải được bảo toàn`);
  }
}

/** Chuẩn hoá và phân loại một câu lệnh trước khi thực thi. */
export function validateSql(raw: string, requestedMode?: SqlMode): ValidatedSql {
  const statement = String(raw ?? '').trim();
  if (!statement) throw new BadRequestException('Vui lòng nhập câu lệnh SQL');
  if (statement.length > 100_000) throw new BadRequestException('Câu lệnh SQL tối đa 100.000 ký tự');

  const tokens = sqlTokens(statement);
  if (tokens.length === 0) throw new BadRequestException('Câu lệnh SQL không hợp lệ');
  const operation = operationOf(tokens);
  const mode: SqlMode = WRITE_FIRST.has(operation) ? 'WRITE' : 'READ';
  if (requestedMode && requestedMode !== mode) {
    throw new BadRequestException(requestedMode === 'READ' ? 'Chỉ cho phép truy vấn đọc ở thao tác này' : 'Câu lệnh không phải thao tác ghi');
  }

  if (mode === 'READ') {
    if (operation === 'EXPLAIN' && tokens.includes('ANALYZE')) {
      throw new BadRequestException('EXPLAIN ANALYZE không được hỗ trợ vì có thể thực thi câu lệnh tốn tài nguyên');
    }
    if (tokens.some((t) => READ_FORBIDDEN.has(t)) || tokens.some((t) => READ_FORBIDDEN_FUNCTIONS.has(t))) {
      throw new BadRequestException('Truy vấn xem chỉ cho phép SELECT/WITH/EXPLAIN thuần, không được chứa thao tác ghi, khóa hay hàm quản trị hệ thống');
    }
    const forAt = tokens.indexOf('FOR');
    if (forAt >= 0 && ['UPDATE', 'SHARE', 'KEY', 'NO'].includes(tokens[forAt + 1] ?? '')) {
      throw new BadRequestException('Truy vấn xem không được khoá dòng dữ liệu (FOR UPDATE/SHARE)');
    }
  } else {
    if ((operation === 'UPDATE' || operation === 'DELETE') && !hasTopLevelWhere(statement)) {
      throw new BadRequestException(`${operation} bắt buộc có WHERE ở cấp ngoài cùng để tránh thay đổi/xoá toàn bộ dữ liệu ngoài ý muốn`);
    }
    if (tokens.includes('RETURNING')) {
      throw new BadRequestException('Không dùng RETURNING trong thao tác ghi; console sẽ trả số dòng đã tác động');
    }
    rejectProtectedTable(tokens, operation);
  }

  return { statement, mode, operation, tokens };
}

/** Bọc truy vấn đọc để trả dữ liệu xem trước/xuất tệp trong giới hạn an toàn. */
export function limitReadQuery(statement: string, maxRows: number): string {
  const validated = validateSql(statement, 'READ');
  if (validated.operation === 'EXPLAIN') return validated.statement;
  return `select * from (${validated.statement}) as "__qlbs_sql_console" limit ${Math.max(1, Math.floor(maxRows))}`;
}
