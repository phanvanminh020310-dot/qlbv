import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { PoolClient } from 'pg';
import { DbService } from '../../db/db.service';
import type { AccessContext, ClientMeta } from '../../common/types/access-context';
import { AuditService } from '../audit/audit.service';
import { limitReadQuery, validateSql, type SqlOperation } from './sql-console.policy';

const PREVIEW_ROWS = 1_000;
const EXPORT_ROWS = 10_000;
const STATEMENT_TIMEOUT_MS = 15_000;
const LOCK_TIMEOUT_MS = 3_000;
export const WRITE_CONFIRM_TEXT = 'THUC THI';

export type ExportFormat = 'xlsx' | 'csv' | 'json';
export interface SqlConsoleRow { [key: string]: unknown }

export interface SqlQueryResult {
  operation: SqlOperation;
  columns: string[];
  rows: SqlConsoleRow[];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
}

interface PgResult {
  rows?: Record<string, unknown>[];
  rowCount?: number | null;
  fields?: Array<{ name: string }>;
}

function displayValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[binary ${value.length} bytes]`;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[object]';
    }
  }
  return value;
}

function displayRows(rows: Record<string, unknown>[]): SqlConsoleRow[] {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, displayValue(value)])));
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  // Chặn công thức khi người dùng mở CSV bằng Excel/LibreOffice.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function excelCell(value: unknown): unknown {
  if (typeof value === 'string' && /^[=+\-@]/.test(value)) return `'${value}`;
  return value;
}

/** Console SQL nội bộ: chỉ ADMIN/SUPER_ADMIN, có rào chắn cú pháp và audit riêng. */
@Injectable()
export class SqlConsoleService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private assertAdmin(user: AccessContext): void {
    if (user.isSuperAdmin || user.roles.includes('ADMIN')) return;
    throw new ForbiddenException('SQL Console chỉ dành cho tài khoản có vai trò Quản trị hệ thống (ADMIN) hoặc Quản trị tối cao');
  }

  private auditSql(user: AccessContext, meta: ClientMeta, action: string, statement: string, detail: Record<string, unknown>): void {
    // AuditService tự nuốt lỗi ghi audit, nên console không bao giờ trả thành công
    // khi câu lệnh chưa được thực thi; nội dung SQL giữ lại để truy vết quản trị.
    void this.audit.log({
      userId: user.id,
      username: user.username,
      fullName: user.fullName,
      action,
      module: 'SQL_CONSOLE',
      entity: 'sql_statement',
      entityId: '',
      description: `${action} SQL Console`,
      afterData: { statement: statement.slice(0, 100_000), ...detail },
      departmentId: user.departmentId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  private async readRows(statement: string, limit: number): Promise<{ result: PgResult; rows: Record<string, unknown>[]; truncated: boolean }> {
    const limited = limitReadQuery(statement, limit + 1);
    return this.db.withClient(async (client) => {
      await client.query('begin read only');
      try {
        await client.query(`set local statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
        await client.query(`set local lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
        const result = (await client.query(limited)) as PgResult;
        await client.query('commit');
        const raw = result.rows ?? [];
        return { result, rows: raw.slice(0, limit), truncated: raw.length > limit };
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      }
    });
  }

  async schema(user: AccessContext) {
    this.assertAdmin(user);
    const data = await this.db.withClient(async (client) => {
      const [tables, columns] = await Promise.all([
        client.query(
          `select table_name as name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
        ),
        client.query(
          `select table_name, column_name, data_type, is_nullable, column_default
             from information_schema.columns
            where table_schema = 'public'
            order by table_name, ordinal_position`,
        ),
      ]);
      return { tables: tables.rows as Record<string, unknown>[], columns: columns.rows as Record<string, unknown>[] };
    });
    const byTable = new Map<string, Array<Record<string, unknown>>>();
    for (const column of data.columns) {
      const table = String(column.table_name ?? '');
      const list = byTable.get(table) ?? [];
      list.push({
        name: String(column.column_name ?? ''),
        type: String(column.data_type ?? ''),
        nullable: String(column.is_nullable ?? '') === 'YES',
        default: column.column_default ? String(column.column_default) : null,
      });
      byTable.set(table, list);
    }
    return {
      tables: data.tables.map((table) => {
        const name = String(table.name ?? '');
        return { name, columns: byTable.get(name) ?? [] };
      }),
    };
  }

  async query(user: AccessContext, statement: string, meta: ClientMeta): Promise<SqlQueryResult> {
    this.assertAdmin(user);
    const validated = validateSql(statement, 'READ');
    const started = Date.now();
    const { result, rows, truncated } = await this.readRows(validated.statement, PREVIEW_ROWS);
    const display = displayRows(rows);
    const columns = result.fields?.map((f) => f.name) ?? Object.keys(display[0] ?? {});
    const response = {
      operation: validated.operation,
      columns,
      rows: display,
      rowCount: display.length,
      truncated,
      elapsedMs: Date.now() - started,
    };
    this.auditSql(user, meta, 'QUERY', validated.statement, { operation: validated.operation, rows: response.rowCount, truncated, elapsedMs: response.elapsedMs });
    return response;
  }

  async execute(user: AccessContext, statement: string, reason: string, confirm: string, meta: ClientMeta) {
    this.assertAdmin(user);
    const validated = validateSql(statement, 'WRITE');
    if (String(confirm ?? '').trim().toUpperCase() !== WRITE_CONFIRM_TEXT) {
      throw new BadRequestException(`Hãy gõ đúng "${WRITE_CONFIRM_TEXT}" để xác nhận thao tác ghi`);
    }
    const cleanReason = String(reason ?? '').trim();
    if (cleanReason.length < 5 || cleanReason.length > 500) {
      throw new BadRequestException('Vui lòng nêu lý do từ 5 đến 500 ký tự trước khi thay đổi dữ liệu');
    }

    const started = Date.now();
    const result = await this.db.withClient(async (client) => this.executeWrite(client, validated.statement));
    const affected = Math.max(0, result.rowCount ?? 0);
    const elapsedMs = Date.now() - started;
    this.auditSql(user, meta, 'EXECUTE', validated.statement, {
      operation: validated.operation,
      affectedRows: affected,
      reason: cleanReason,
      elapsedMs,
    });
    return { operation: validated.operation, affectedRows: affected, elapsedMs, message: `Đã thực thi ${validated.operation}: tác động ${affected} dòng` };
  }

  private async executeWrite(client: PoolClient, statement: string): Promise<PgResult> {
    await client.query('begin');
    try {
      await client.query(`set local statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
      await client.query(`set local lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
      const result = (await client.query(statement)) as PgResult;
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    }
  }

  async export(user: AccessContext, statement: string, format: ExportFormat, meta: ClientMeta): Promise<{ buffer: Buffer; fileName: string; mime: string }> {
    this.assertAdmin(user);
    const validated = validateSql(statement, 'READ');
    if (!['xlsx', 'csv', 'json'].includes(format)) throw new BadRequestException('Định dạng xuất chỉ hỗ trợ Excel, CSV hoặc JSON');
    const started = Date.now();
    const { result, rows, truncated } = await this.readRows(validated.statement, EXPORT_ROWS);
    if (truncated) throw new BadRequestException(`Kết quả vượt quá ${EXPORT_ROWS.toLocaleString('vi-VN')} dòng; hãy thêm điều kiện WHERE hoặc LIMIT để xuất nhỏ hơn`);
    const display = displayRows(rows);
    const columns = result.fields?.map((f) => f.name) ?? Object.keys(display[0] ?? {});
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    let buffer: Buffer;
    let mime: string;
    let extension: string;

    if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'QLBS SQL Console';
      workbook.created = new Date();
      const sheet = workbook.addWorksheet('Kết quả');
      sheet.addRow(columns);
      const header = sheet.getRow(1);
      header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
      header.alignment = { vertical: 'middle' };
      for (const row of display) sheet.addRow(columns.map((column) => excelCell(row[column])));
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + Math.min(columns.length, 26))}1` };
      for (let col = 1; col <= columns.length; col++) {
        const width = Math.min(45, Math.max(12, String(columns[col - 1] ?? '').length + 2));
        sheet.getColumn(col).width = width;
      }
      buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      extension = 'xlsx';
    } else if (format === 'csv') {
      buffer = Buffer.from(`\uFEFF${[columns.map(csvCell).join(','), ...display.map((row) => columns.map((column) => csvCell(row[column])).join(','))].join('\r\n')}`, 'utf8');
      mime = 'text/csv; charset=utf-8';
      extension = 'csv';
    } else {
      buffer = Buffer.from(JSON.stringify({ exportedAt: new Date().toISOString(), columns, rows: display }, null, 2), 'utf8');
      mime = 'application/json; charset=utf-8';
      extension = 'json';
    }

    this.auditSql(user, meta, 'EXPORT', validated.statement, {
      operation: validated.operation,
      format,
      rows: display.length,
      elapsedMs: Date.now() - started,
    });
    return { buffer, fileName: `sql-console-${stamp}.${extension}`, mime };
  }
}
