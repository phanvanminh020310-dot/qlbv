import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { SqlConsoleService, WRITE_CONFIRM_TEXT } from '../src/modules/sql-console/sql-console.service';
import type { AccessContext } from '../src/common/types/access-context';

const admin: AccessContext = {
  id: 1, username: 'admin', fullName: 'Quản trị', title: '', departmentId: null, departmentName: '',
  roles: ['ADMIN'], permissions: [], dataScope: 'ALL', departmentIds: [], isSuperAdmin: false, sessionId: 'test',
};
const ordinary: AccessContext = { ...admin, id: 2, username: 'staff', roles: ['NHAN_VIEN'], dataScope: 'OWN' };
const meta = { ip: '127.0.0.1', userAgent: 'test' };

function fixture(result = { rows: [{ id: 1, name: 'A' }], rowCount: 1, fields: [{ name: 'id' }, { name: 'name' }] }) {
  const calls: string[] = [];
  const audit: unknown[] = [];
  const client = {
    query: async (statement: string) => {
      calls.push(statement);
      if (/^select \* from \(/i.test(statement)) return result;
      if (/^(update|insert|delete)/i.test(statement)) return { rows: [], rowCount: 2, fields: [] };
      return { rows: [], rowCount: 0, fields: [] };
    },
  };
  const db = { withClient: async <T>(fn: (c: typeof client) => Promise<T>) => fn(client) };
  const auditService = { log: async (entry: unknown) => { audit.push(entry); } };
  return { service: new SqlConsoleService(db as never, auditService as never), calls, audit };
}

test('ADMIN chạy SELECT bằng giao dịch read-only, giới hạn preview và ghi audit', async () => {
  const { service, calls, audit } = fixture();
  const out = await service.query(admin, 'select id, name from users', meta);
  assert.deepEqual(out.rows, [{ id: 1, name: 'A' }]);
  assert.equal(out.rowCount, 1);
  assert.ok(calls.includes('begin read only'));
  assert.ok(calls.some((q) => q.startsWith('select * from (select id, name from users)')));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((audit[0] as { action: string }).action, 'QUERY');
});

test('thao tác ghi chạy một transaction, cần lý do/xác nhận và audit số dòng', async () => {
  const { service, calls, audit } = fixture();
  const out = await service.execute(admin, "update settings set value = 'x' where key = 'demo'", 'Sửa cấu hình thử nghiệm', WRITE_CONFIRM_TEXT, meta);
  assert.equal(out.affectedRows, 2);
  assert.ok(calls.includes('begin'));
  assert.ok(calls.includes('commit'));
  assert.ok(calls.some((q) => q.startsWith("update settings")));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((audit[0] as { action: string }).action, 'EXECUTE');
  await assert.rejects(
    () => service.execute(admin, "update settings set value = 'x' where key = 'demo'", 'Sửa cấu hình thử nghiệm', 'SAI', meta),
    /THUC THI/,
  );
});

test('tài khoản không có ADMIN/SUPER_ADMIN bị chặn trước khi chạm CSDL', async () => {
  const { service, calls } = fixture();
  await assert.rejects(() => service.query(ordinary, 'select * from users', meta), ForbiddenException);
  assert.equal(calls.length, 0);
});

test('schema trả PK/FK theo từng cột để trợ giúp SQL và vẽ sơ đồ quan hệ', async () => {
  const client = {
    query: async (statement: string) => {
      if (statement.includes('information_schema.tables')) return { rows: [{ name: 'departments' }, { name: 'users' }] };
      if (statement.includes('information_schema.columns')) return { rows: [
        { table_name: 'departments', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null },
        { table_name: 'users', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null },
        { table_name: 'users', column_name: 'department_id', data_type: 'integer', is_nullable: 'YES', column_default: null },
      ] };
      if (statement.includes('from pg_constraint')) return { rows: [
        { table_name: 'departments', constraint_name: 'departments_pkey', constraint_type: 'p', column_name: 'id' },
        { table_name: 'users', constraint_name: 'users_pkey', constraint_type: 'p', column_name: 'id' },
        { table_name: 'users', constraint_name: 'users_department_id_departments_id_fk', constraint_type: 'f', column_name: 'department_id', foreign_table_name: 'departments', foreign_column_name: 'id', update_rule: 'CASCADE', delete_rule: 'SET NULL' },
      ] };
      return { rows: [] };
    },
  };
  const service = new SqlConsoleService({ withClient: async <T>(fn: (c: typeof client) => Promise<T>) => fn(client) } as never, { log: async () => undefined } as never);
  const schema = await service.schema(admin);
  const users = schema.tables.find((table) => table.name === 'users');
  assert.deepEqual(users?.primaryKey, ['id']);
  assert.equal(users?.columns.find((column) => column.name === 'id')?.primaryKey, true);
  assert.deepEqual(users?.foreignKeys, [{ name: 'users_department_id_departments_id_fk', column: 'department_id', referencedTable: 'departments', referencedColumn: 'id', onUpdate: 'CASCADE', onDelete: 'SET NULL' }]);
});
