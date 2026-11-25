import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { PERMISSIONS_KEY } from '../src/common/decorators';
import type { AccessContext } from '../src/common/types/access-context';
import { DbService } from '../src/db/db.service';
import * as schema from '../src/db/schema';
import type { PrintDocument } from '../src/db/schema/printing';
import type { AuditService } from '../src/modules/audit/audit.service';
import {
  PrintSqlService,
  assertSafePrintSql,
  bindNamedParams,
  namedParams,
  normalizeSqlSource,
  scopeDepartments,
} from '../src/modules/printing/print-sql-source';
import { PrintingController } from '../src/modules/printing/printing.controller';
import { PrintingService } from '../src/modules/printing/printing.service';
import type { NotificationCenterService } from '../src/modules/notifications/notification-center.service';
import type { RealtimeService } from '../src/modules/realtime/realtime.service';
import { TasksService } from '../src/modules/tasks/tasks.service';

const dir = resolve(__dirname, '..', 'drizzle');
const ctx = (id: number, departmentId: number | null, permissions: string[], dataScope: 'OWN' | 'DEPT' | 'ALL' = 'DEPT'): AccessContext =>
  ({ id, username: `u${id}`, fullName: `User ${id}`, title: '', departmentId, departmentName: '', roles: [], permissions, dataScope,
    departmentIds: departmentId ? [departmentId] : [], isSuperAdmin: false, sessionId: `t-${id}` }) as AccessContext;

test('chính sách SQL mẫu in: chỉ SELECT, chặn bảng/cột nhạy cảm, tham số khai báo đủ', () => {
  assert.doesNotThrow(() => assertSafePrintSql('select ma, tieu_de from v_cv_cong_viec where khoa_id = :khoa'));
  assert.throws(() => assertSafePrintSql('delete from tasks where id = 1'), /đọc|SELECT/);
  assert.throws(() => assertSafePrintSql('select 1; select 2'), /chấm phẩy/);
  assert.throws(() => assertSafePrintSql('select password_hash from users'), /password_hash/);
  assert.throws(() => assertSafePrintSql('select * from "settings"'), /settings/);
  assert.throws(() => assertSafePrintSql('select * from pg_catalog.pg_user'), /pg_/);
  assert.throws(() => assertSafePrintSql("select query_to_xml('select 1', true, true, '')"), /query_to_xml/);
  assert.throws(() => assertSafePrintSql('explain select 1'), /SELECT/);
  assert.throws(() => normalizeSqlSource({ queries: [{ key: 'a', sql: 'select :chua_khai_bao' }] }), /chưa khai báo/);
  assert.throws(() => normalizeSqlSource({ queries: [{ key: 'a', sql: 'select 1' }, { key: 'a', sql: 'select 2' }] }), /trùng/);
  assert.throws(() => normalizeSqlSource({ queries: [{ key: 'a', sql: 'select 1' }], params: [{ name: 'khoa_id', type: 'number' }] }), /tự động/);
  assert.equal(normalizeSqlSource({ queries: [] }), null);
});

test('ràng buộc :tham_so → $n có ép kiểu; bỏ qua ::cast, chuỗi và comment', () => {
  const sql = "select ':khong_phai', x::date, :a, :b, :a -- :c\n /* :d */ from t where y = :b";
  assert.deepEqual(namedParams(sql).sort(), ['a', 'b']);
  const bound = bindNamedParams(sql, { a: { value: 1, cast: 'int' }, b: { value: 'x', cast: 'text' } });
  assert.equal(bound.text, "select ':khong_phai', x::date, $1::int, $2::text, $1::int -- :c\n /* :d */ from t where y = $2::text");
  assert.deepEqual(bound.values, [1, 'x']);
  assert.deepEqual(scopeDepartments(ctx(1, 10, [], 'ALL')), null);
  assert.deepEqual(scopeDepartments(ctx(1, 10, [], 'DEPT')), [10]);
  assert.deepEqual(scopeDepartments(ctx(1, 10, [], 'OWN')), []);
});

test('API nguồn SQL yêu cầu quyền print.datasource.sql', () => {
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, PrintingController.prototype.testSql), ['print.datasource.sql']);
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, PrintingController.prototype.sqlCatalog), ['print.datasource.sql']);
});

test('3 mẫu in mặc định chạy được SQL theo phạm vi khoa, kết xuất PDF; chặn sửa SQL khi thiếu quyền', async (t) => {
  const pg = await PGlite.create();
  t.after(() => pg.close());
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pg.exec(readFileSync(join(dir, f), 'utf8'));
  await pg.exec(`
    INSERT INTO departments (id, code, name, short_name, sort_order, active) VALUES (10, 'A1', 'Khoa A1', 'A1', 10, true), (11, 'B1', 'Khoa B1', 'B1', 20, true);
    INSERT INTO users (id, manv, username, password_hash, full_name, title, department_id, active) VALUES
      (1, 'NV01', 'tk', 'h', 'Trưởng khoa A', 'Trưởng khoa', 10, true), (2, 'NV02', 'nv2', 'h', 'Nhân viên Hai', 'Điều dưỡng', 10, true),
      (4, 'NV04', 'kb', 'h', 'Người khoa B', 'Bác sĩ', 11, true), (5, 'NV05', 'kb2', 'h', 'Người khoa B2', 'Bác sĩ', 11, true);
  `);
  const db = drizzle(pg, { schema });
  const dbs = {
    db,
    transaction: db.transaction.bind(db),
    withClient: (fn: (client: unknown) => Promise<unknown>) => fn({ query: (text: string, values?: unknown[]) => pg.query(text, values as never) }),
  } as unknown as DbService;
  const audits: Array<{ action: string }> = [];
  const audit = { log: async (e: { action: string }) => void audits.push(e) } as unknown as AuditService;
  const sqlService = new PrintSqlService(dbs, audit);
  const printing = new PrintingService(dbs, sqlService);
  const tasks = new TasksService(dbs, { notify: async () => undefined } as unknown as NotificationCenterService, { publish: () => undefined } as unknown as RealtimeService);

  const boss = ctx(1, 10, ['task.assign', 'task.manage', 'task.report', 'print.render.export']);
  const bossB = ctx(4, 11, ['task.assign', 'task.manage', 'task.report', 'print.render.export']);
  const a = await tasks.create(boss, { title: 'Việc khoa A', assigneeId: 2, checklist: ['Bước 1', 'Bước 2'], description: 'Chi tiết yêu cầu' });
  await tasks.create(bossB, { title: 'Việc khoa B', assigneeId: 5 });

  const rows = await pg.query<{ code: string; document: PrintDocument }>(`select code, document from print_templates where module = 'TASK' order by code`);
  assert.deepEqual(rows.rows.map((r) => r.code), ['CV_BAO_CAO_TINH_HINH', 'CV_HIEU_SUAT_NHAN_VIEN', 'CV_PHIEU_GIAO_VIEC']);
  for (const r of rows.rows) assert.ok(normalizeSqlSource((r.document as { sqlSource?: unknown }).sqlSource), `${r.code} hợp lệ theo chính sách`);

  // Báo cáo tình hình: trưởng khoa A chỉ thấy việc khoa A
  const report = await printing.renderTemplate('CV_BAO_CAO_TINH_HINH', {}, [], { user: boss, params: {} });
  assert.ok(report.result.buffer.subarray(0, 5).toString() === '%PDF-', 'kết xuất PDF');
  const source = normalizeSqlSource((rows.rows[0]!.document as { sqlSource?: unknown }).sqlSource)!;
  const runA = await sqlService.run(boss, source, {});
  assert.deepEqual(runA.rows.map((r) => r['tieu_de']), ['Việc khoa A']);
  assert.equal(Number(runA.data.one['tong_hop']!['giao']), 1);
  const runAll = await sqlService.run(ctx(9, null, [], 'ALL'), source, {});
  assert.equal(runAll.rows.length, 2, 'toàn viện thấy cả 2 khoa');

  // Hiệu suất
  const perf = normalizeSqlSource((rows.rows[1]!.document as { sqlSource?: unknown }).sqlSource)!;
  const perfRun = await sqlService.run(boss, perf, { tu_ngay: '2020-01-01' });
  assert.deepEqual(perfRun.rows.map((r) => r['ho_ten']), ['Nhân viên Hai']);
  await printing.renderTemplate('CV_HIEU_SUAT_NHAN_VIEN', {}, [], { user: boss, params: {} });

  // Phiếu giao việc: khoa B không in được việc khoa A (dòng rỗng)
  const slip = normalizeSqlSource((rows.rows[2]!.document as { sqlSource?: unknown }).sqlSource)!;
  const own = await sqlService.run(boss, slip, { cong_viec_id: a.id });
  assert.equal(own.data.one['cv']!['tieu_de'], 'Việc khoa A');
  assert.deepEqual(own.data.ds['checklist']!.map((c) => c['noi_dung']), ['Bước 1', 'Bước 2']);
  const other = await sqlService.run(bossB, slip, { cong_viec_id: a.id });
  assert.equal(other.rows.length, 0, 'ngoài phạm vi khoa');
  await assert.rejects(sqlService.run(boss, slip, {}), /ID công việc/, 'tham số bắt buộc');
  const pdf = await printing.renderTemplate('CV_PHIEU_GIAO_VIEC', {}, [], { user: boss, params: { cong_viec_id: a.id } });
  assert.ok(pdf.result.pages >= 1);
  assert.ok(audits.length >= 5 && audits.every((x) => x.action === 'SQL_RENDER'), 'mỗi lần chạy đều ghi audit');

  // Sửa SQL cần quyền print.datasource.sql
  const tpl = (await pg.query<{ id: number }>(`select id from print_templates where code = 'CV_PHIEU_GIAO_VIEC'`)).rows[0]!;
  const doc = rows.rows[2]!.document as PrintDocument & { sqlSource: { queries: Array<{ sql: string }> } };
  const changed = { ...doc, sqlSource: { ...doc.sqlSource, queries: [{ key: 'cv', sql: 'select * from v_nguoi_dung' }] } };
  const designer = ctx(1, 10, ['print.template.update']);
  await assert.rejects(printing.update(tpl.id, { document: changed as never }, designer), /print\.datasource\.sql/);
  await printing.update(tpl.id, { document: { ...doc, margins: { top: 15, right: 10, bottom: 12, left: 10 } } as never }, designer);
  await printing.update(tpl.id, { document: changed as never }, ctx(1, 10, ['print.template.update', 'print.datasource.sql']));
  await assert.rejects(
    printing.update(tpl.id, { document: { ...doc, sqlSource: { queries: [{ key: 'x', sql: 'select password_hash from users' }] } } as never }, ctx(1, 10, ['print.datasource.sql'])),
    /password_hash/,
  );
});

test('xuất Excel/CSV dữ liệu nguồn SQL: BOM, chống formula injection, mỗi truy vấn một sheet', async () => {
  const { buildSqlExport } = await import('../src/modules/printing/print-sql-source');
  const ExcelJS = ((await import('exceljs')) as unknown as { default: typeof import('exceljs') }).default;
  const result = {
    data: {
      ds: { a: [{ ten: '=HYPERLINK("x")', so: -5, ghi_chu: 'có, dấu "nháy"' }], b: [{ x: 1 }] },
      one: {},
      params: {},
    },
    rows: [],
    queries: [
      { key: 'a', label: 'Danh sách/việc', columns: ['ten', 'so', 'ghi_chu'], rowCount: 1, truncated: false, ms: 1 },
      { key: 'b', label: 'Danh sách/việc', columns: [], rowCount: 1, truncated: true, ms: 1 },
    ],
  };
  const csv = await buildSqlExport(result, 'csv', 'a');
  const text = csv.buffer.toString('utf8');
  assert.ok(text.startsWith('\uFEFFten,so,ghi_chu\r\n'));
  assert.ok(text.includes(`"'=HYPERLINK(""x"")"`), 'công thức bị vô hiệu hoá');
  assert.ok(text.includes(',-5,'), 'số âm giữ nguyên');
  assert.ok(text.includes('"có, dấu ""nháy"""'));
  const xlsx = await buildSqlExport(result, 'xlsx');
  assert.match(xlsx.fileName, /\.xlsx$/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx.buffer as unknown as ArrayBuffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Danh sách việc', 'Danh sách việc (2)']);
  assert.equal(wb.worksheets[1]!.getCell('A1').value, 'x');
  assert.match(String(wb.worksheets[1]!.getCell('A3').value), /đã cắt/);
});
