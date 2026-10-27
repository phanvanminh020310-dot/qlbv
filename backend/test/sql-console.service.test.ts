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
