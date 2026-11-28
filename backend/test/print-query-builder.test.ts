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
  buildSqlFromSpec,
  columnLabel,
  normalizeBuilderSpec,
  pgTypeToFieldType,
  referencedTables,
  sqlTypeToFieldType,
} from '../src/modules/printing/print-query-builder';
import { normalizeModuleCode } from '../src/modules/printing/print-modules';
import { PrintSqlService, normalizeSqlSource } from '../src/modules/printing/print-sql-source';
import { PrintingController } from '../src/modules/printing/printing.controller';
import { PrintingService } from '../src/modules/printing/printing.service';

const dir = resolve(__dirname, '..', 'drizzle');
const ctx = (id: number, departmentId: number | null, permissions: string[], dataScope: 'OWN' | 'DEPT' | 'ALL' = 'DEPT'): AccessContext =>
  ({ id, username: `u${id}`, fullName: `User ${id}`, title: '', departmentId, departmentName: '', roles: [], permissions, dataScope,
    departmentIds: departmentId ? [departmentId] : [], isSuperAdmin: false, sessionId: `t-${id}` }) as AccessContext;

test('trình chọn bảng: sinh SELECT an toàn, đặt nháy định danh, escape giá trị, lọc tuỳ chọn theo tham số', () => {
  const spec = normalizeBuilderSpec({
    table: 'v_nguoi_dung',
    columns: [{ name: 'ma_nv' }, { name: 'ho_ten', label: 'Họ và tên' }],
    filters: [
      { column: 'ten_khoa', op: 'contains', value: "O'Brien" },
      { column: 'ma_nv', op: 'eq', param: 'ma' },
      { column: 'dang_hoat_dong', op: 'is_true', value: 'bỏ qua' },
    ],
    sort: [{ column: 'ho_ten' }],
    limit: 999999,
    scopeColumn: 'khoa_id',
    junk: 'x',
  });
  assert.equal(spec.limit, 5000, 'giới hạn tối đa 5000 dòng');
  assert.equal((spec as unknown as Record<string, unknown>)['junk'], undefined);
  assert.equal(spec.filters![2]!.value, undefined, 'phép không cần giá trị thì bỏ giá trị');
  const sql = buildSqlFromSpec(spec);
  assert.equal(
    sql,
    [
      'SELECT t."ma_nv", t."ho_ten"',
      'FROM "v_nguoi_dung" AS t',
      `WHERE (:pham_vi_khoa IS NULL OR t."khoa_id" = ANY(:pham_vi_khoa))`,
      `  AND t."ten_khoa"::text ILIKE '%' || 'O''Brien' || '%'`,
      '  AND (:ma IS NULL OR t."ma_nv" = :ma)',
      '  AND t."dang_hoat_dong" IS TRUE',
      'ORDER BY t."ho_ten" ASC NULLS LAST',
      'LIMIT 5000',
    ].join('\n'),
  );
});

test('trình chọn bảng: tổng hợp tự GROUP BY, ngày giờ so theo lịch Việt Nam, từ chối định danh lạ', () => {
  const sql = buildSqlFromSpec(
    normalizeBuilderSpec({
      table: 'tasks',
      columns: [{ name: 'status' }, { agg: 'count' }, { name: 'progress', agg: 'avg', alias: 'tien_do_tb' }],
      filters: [{ column: 'created_at', op: 'gte', param: 'tu_ngay', columnType: 'timestamp with time zone' }],
      sort: [{ column: 'progress', dir: 'desc' }],
    }),
  );
  assert.match(sql, /^SELECT t\."status", count\(\*\) AS "so_luong", avg\(t\."progress"\) AS "tien_do_tb"/);
  assert.match(sql, /\(:tu_ngay IS NULL OR \(t\."created_at" AT TIME ZONE 'Asia\/Ho_Chi_Minh'\)::date >= :tu_ngay\)/);
  assert.match(sql, /GROUP BY t\."status"/);
  assert.match(sql, /ORDER BY "tien_do_tb" DESC NULLS LAST/);

  for (const bad of ['users; drop table x', 'Users', 'a"b', 'x--', '1abc', 'tên']) {
    assert.throws(() => normalizeBuilderSpec({ table: bad, columns: [{ name: 'id' }] }), /không hợp lệ/, bad);
    assert.throws(() => normalizeBuilderSpec({ table: 'tasks', columns: [{ name: bad }] }), /không hợp lệ/, bad);
    assert.throws(() => normalizeBuilderSpec({ table: 'tasks', columns: [{ name: 'id' }], filters: [{ column: 'id', op: 'eq', param: bad }] }), /không hợp lệ/);
  }
  assert.throws(() => normalizeBuilderSpec({ table: 'tasks', columns: [] }), /ít nhất một cột/);
  assert.throws(() => normalizeBuilderSpec({ table: 'tasks', columns: [{ name: 'id' }], filters: [{ column: 'id', op: 'raw' }] }), /Phép so sánh/);
  assert.throws(() => normalizeBuilderSpec({ table: 'tasks', columns: [{ name: 'id', agg: 'sum' }, { name: 'id', agg: 'sum' }] }), /trùng/);
  assert.throws(() => normalizeBuilderSpec({ table: 'tasks', columns: [{ name: '*' }] }), /không hợp lệ|hàm đếm/);

  // Nguồn SQL: bảng nhạy cảm vẫn bị chặn; tham số phải khai báo; SQL gửi kèm bị bỏ qua
  assert.throws(() => normalizeSqlSource({ queries: [{ key: 'a', builder: { table: 'user_biometrics', columns: [{ name: 'id' }] } }] }), /user_biometrics/);
  assert.throws(() => normalizeSqlSource({ queries: [{ key: 'a', builder: { table: 'users', columns: [{ name: 'password_hash' }] } }] }), /password_hash/);
  assert.throws(
    () => normalizeSqlSource({ queries: [{ key: 'a', builder: { table: 'tasks', columns: [{ name: 'id' }], filters: [{ column: 'id', op: 'eq', param: 'x' }] } }] }),
    /chưa khai báo/,
  );
  const src = normalizeSqlSource({ queries: [{ key: 'a', sql: 'select password_hash from users', builder: { table: 'tasks', columns: [{ name: 'id' }] } }] })!;
  assert.equal(src.queries[0]!.sql, 'SELECT t."id"\nFROM "tasks" AS t');
});

test('nhãn tiếng Việt, kiểu trường, mã phân hệ tự do', () => {
  assert.equal(columnLabel('ho_ten'), 'Họ tên');
  assert.equal(columnLabel('ngay_bat_dau'), 'Ngày bắt đầu');
  assert.equal(columnLabel('so_viec_qua_han'), 'Số việc quá hạn');
  assert.equal(columnLabel('id'), 'ID');
  assert.deepEqual(referencedTables('select * from v_cv_cong_viec c join users u on true', ['users', 'v_cv_cong_viec', 'tasks']), ['v_cv_cong_viec', 'users']);
  assert.equal(pgTypeToFieldType(1184), 'datetime');
  assert.equal(pgTypeToFieldType(1082), 'date');
  assert.equal(pgTypeToFieldType(23), 'integer');
  assert.equal(pgTypeToFieldType(1700), 'number');
  assert.equal(pgTypeToFieldType(16), 'bool');
  assert.equal(pgTypeToFieldType(25), 'text');
  assert.equal(sqlTypeToFieldType('numeric'), 'number');
  assert.equal(sqlTypeToFieldType('timestamp with time zone'), 'datetime');
  assert.equal(normalizeModuleCode('Kho dược'), 'KHO_DUOC');
  assert.equal(normalizeModuleCode(''), 'GENERIC');
  assert.equal(normalizeModuleCode('task'), 'TASK');
  assert.throws(() => normalizeModuleCode('123'), /không hợp lệ/);
});

test('API trường dữ liệu/phân hệ dùng quyền xem mẫu in; danh sách mẫu dùng quyền in', () => {
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, PrintingController.prototype.fields), ['print.template.view']);
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, PrintingController.prototype.modules), ['print.template.view']);
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, PrintingController.prototype.available), ['print.render.view']);
});

test('mẫu dựng bằng chọn bảng chạy được theo phạm vi khoa; trường dữ liệu theo nguồn; bảng mới tự có trong danh mục; mẫu cũ không đổi', async (t) => {
  const pg = await PGlite.create();
  t.after(() => pg.close());
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pg.exec(readFileSync(join(dir, f), 'utf8'));
  await pg.exec(`
    INSERT INTO departments (id, code, name, short_name, sort_order, active) VALUES (10, 'A1', 'Khoa A1', 'A1', 10, true), (11, 'B1', 'Khoa B1', 'B1', 20, true);
    INSERT INTO users (id, manv, username, password_hash, full_name, title, department_id, active) VALUES
      (1, 'NV01', 'tk', 'h', 'Trưởng khoa A', 'Trưởng khoa', 10, true), (2, 'NV02', 'nv2', 'h', 'Nhân viên Hai', 'Điều dưỡng', 10, true),
      (4, 'NV04', 'kb', 'h', 'Người khoa B', 'Bác sĩ', 11, true);
  `);
  const before = (await pg.query<{ code: string; document: unknown; version: number }>(`select code, document, version from print_templates order by code`)).rows;
  const db = drizzle(pg, { schema });
  const dbs = {
    db,
    transaction: db.transaction.bind(db),
    withClient: (fn: (client: unknown) => Promise<unknown>) => fn({ query: (text: string, values?: unknown[]) => pg.query(text, values as never) }),
  } as unknown as DbService;
  const audit = { log: async () => undefined } as unknown as AuditService;
  const sqlService = new PrintSqlService(dbs, audit);
  const printing = new PrintingService(dbs, sqlService);

  // Danh mục: có nhãn tiếng Việt, cột phạm vi khoa, không lộ cột nhạy cảm
  const catalog = await printing.sqlCatalog();
  const vUser = catalog.find((x) => x.name === 'v_nguoi_dung')!;
  assert.equal(vUser.kind, 'view');
  assert.equal(vUser.scopeColumn, 'khoa_id');
  assert.equal(vUser.columns.find((c) => c.name === 'ho_ten')!.label, 'Họ tên');
  const users = catalog.find((x) => x.name === 'users')!;
  assert.ok(!users.columns.some((c) => c.name === 'password_hash'));
  assert.ok(!catalog.some((x) => x.name === 'user_biometrics'));

  // Bảng của phân hệ tương lai (chưa có trong từ điển) tự xuất hiện, dùng COMMENT nếu có
  await pg.exec(`CREATE TABLE kho_thuoc (id serial primary key, ten_thuoc text, so_luong int, department_id int, ngay_nhap date);
                 COMMENT ON TABLE kho_thuoc IS 'Kho thuốc khoa';
                 INSERT INTO kho_thuoc (ten_thuoc, so_luong, department_id, ngay_nhap) VALUES ('Paracetamol', 10, 10, '2026-01-05'), ('Amoxicillin', 3, 11, '2026-02-01');`);
  const kho = (await printing.sqlCatalog()).find((x) => x.name === 'kho_thuoc')!;
  assert.equal(kho.label, 'Kho thuốc khoa');
  assert.equal(kho.scopeColumn, 'department_id');
  assert.equal(kho.columns.find((c) => c.name === 'ten_thuoc')!.label, 'Tên thuoc');
  assert.equal(kho.columns.find((c) => c.name === 'so_luong')!.fieldType, 'integer');

  // Tạo mẫu bằng chọn bảng cho phân hệ mới (mã tự do) → in theo phạm vi khoa
  const author = ctx(1, 10, ['print.template.create', 'print.template.update', 'print.datasource.sql', 'print.render.view']);
  const document = {
    margins: { top: 10, right: 10, bottom: 10, left: 10 },
    elements: [{ id: 't', type: 'table', x: 10, y: 10, w: 180, h: 40, dataSource: 'ds.kho', columns: [{ field: 'ten_thuoc', header: 'Tên thuốc' }] }],
    sqlSource: {
      params: [{ name: 'tu_ngay', label: 'Từ ngày', type: 'date' }],
      queries: [
        {
          key: 'kho',
          label: 'Tồn kho',
          builder: {
            table: 'kho_thuoc',
            columns: [{ name: 'ten_thuoc', label: 'Tên thuốc' }, { name: 'so_luong' }, { name: 'ngay_nhap' }],
            filters: [{ column: 'ngay_nhap', op: 'gte', param: 'tu_ngay', columnType: 'date' }],
            sort: [{ column: 'ten_thuoc' }],
            scopeColumn: 'department_id',
          },
        },
      ],
    },
  } as unknown as PrintDocument;
  const created = await printing.create({ code: 'KHO_TON', name: 'Tồn kho', module: 'Kho thuốc' as never, docType: 'KHO_TON', document }, author);
  assert.equal(created.module, 'KHO_THUOC');
  const saved = (created.document as unknown as { sqlSource: { queries: Array<{ sql: string; builder: unknown }> } }).sqlSource.queries[0]!;
  assert.match(saved.sql, /FROM "kho_thuoc" AS t/, 'lưu SQL do máy chủ sinh');
  assert.ok(saved.builder, 'giữ cấu hình chọn bảng để sửa lại');

  const src = normalizeSqlSource((created.document as unknown as { sqlSource: unknown }).sqlSource)!;
  const runA = await sqlService.run(author, src, {});
  assert.deepEqual(runA.rows.map((r) => r['ten_thuoc']), ['Paracetamol'], 'chỉ khoa của người in');
  const runAll = await sqlService.run(ctx(9, null, [], 'ALL'), src, {});
  assert.deepEqual(runAll.rows.map((r) => r['ten_thuoc']), ['Amoxicillin', 'Paracetamol']);
  const runDate = await sqlService.run(ctx(9, null, [], 'ALL'), src, { tu_ngay: '2026-01-20' });
  assert.deepEqual(runDate.rows.map((r) => r['ten_thuoc']), ['Amoxicillin'], 'lọc theo tham số');
  const pdf = await printing.renderTemplate('KHO_TON', {}, [], { user: author, params: {} });
  assert.equal(pdf.result.buffer.subarray(0, 5).toString(), '%PDF-');

  // Trường dữ liệu theo đúng nguồn của mẫu — không có trường HSBA
  const designer = ctx(2, 10, ['print.template.view', 'print.template.update']);
  const fields = await printing.fields(designer, { templateId: created.id });
  assert.deepEqual(fields.errors, []);
  const one = fields.groups.find((g) => g.id === 'one.kho')!;
  assert.deepEqual(one.fields.map((f) => f.key), ['one.kho.ten_thuoc', 'one.kho.so_luong', 'one.kho.ngay_nhap']);
  assert.equal(one.fields[0]!.label, 'Tên thuốc');
  assert.deepEqual(one.fields.map((f) => f.type), ['text', 'integer', 'date']);
  const list = fields.groups.find((g) => g.id === 'ds.kho')!;
  assert.equal(list.dataSource, 'ds.kho');
  assert.deepEqual(fields.groups.find((g) => g.id === 'params')!.fields.map((f) => f.key), ['params.tu_ngay']);
  assert.ok(!JSON.stringify(fields).includes('benh_nhan') && !JSON.stringify(fields).includes('so_ba'));
  // Người không có quyền SQL không dò được bảng khác qua SQL gửi kèm — chỉ dùng SQL đã lưu
  const probe = await printing.fields(designer, { templateId: created.id, sqlSource: { queries: [{ key: 'x', sql: 'select * from users' }] } });
  assert.ok(!probe.groups.some((g) => g.query === 'x'));
  // Người có quyền SQL xem trường của bản nháp chưa lưu; SQL lỗi trả thông báo thay vì làm hỏng
  const draft = await printing.fields(author, { sqlSource: { queries: [{ key: 'tk', sql: 'select status, count(*) as so_viec from tasks group by status' }, { key: 'loi', sql: 'select khong_co from tasks' }] } });
  assert.deepEqual(draft.groups.find((g) => g.id === 'one.tk')!.fields.map((f) => [f.column, f.type]), [['status', 'text'], ['so_viec', 'integer']]);
  assert.equal(draft.groups.find((g) => g.id === 'one.loi')!.fields.length, 0);
  assert.match(draft.groups.find((g) => g.id === 'one.tk')!.sql!, /from tasks/);
  assert.equal(one.sql, undefined, 'người không có quyền SQL không thấy câu lệnh');
  assert.ok(draft.errors.some((e) => e.includes('loi')));

  // Danh mục phân hệ có mã mới; mẫu in khả dụng lọc theo phân hệ
  const mods = await printing.modules();
  assert.ok(mods.some((m) => m.code === 'KHO_THUOC' && m.docTypes.includes('KHO_TON') && m.templates === 1));
  assert.ok(mods.some((m) => m.code === 'TASK' && m.label === 'Quản lý công việc'));
  const avail = await printing.available(author, 'kho_thuoc');
  assert.deepEqual(avail.map((x) => x.code), ['KHO_TON']);
  assert.deepEqual(avail[0]!.params.map((p) => p.name), ['tu_ngay']);
  const taskAvail = await printing.available(author, 'TASK');
  assert.ok(taskAvail.length >= 3 && taskAvail.every((x) => x.module === 'TASK'));

  // Mẫu cũ (SQL thô) không đổi gì
  const after = (await pg.query<{ code: string; document: unknown; version: number }>(`select code, document, version from print_templates where code <> 'KHO_TON' order by code`)).rows;
  assert.deepEqual(after, before);
  // Mẫu công việc có sẵn: trường lấy theo SQL của chính mẫu (không còn trường HSBA), không lỗi
  for (const r of (await pg.query<{ id: number; code: string }>(`select id, code from print_templates where module = 'TASK' order by code`)).rows) {
    const tf = await printing.fields(designer, { templateId: r.id });
    assert.deepEqual(tf.errors, [], r.code);
    assert.ok(tf.groups.some((g) => g.kind === 'list' && g.fields.length > 0), `${r.code} có danh sách cột`);
    assert.ok(!tf.groups.some((g) => g.fields.some((f) => /patient|hsba|maKcb/i.test(f.key))), `${r.code} không có trường HSBA`);
  }
});
