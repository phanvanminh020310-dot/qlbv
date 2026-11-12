import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AccessContext } from '../src/common/types/access-context';
import { DbService } from '../src/db/db.service';
import * as schema from '../src/db/schema';
import { CreateUserDto, UpdateUserDto } from '../src/modules/users/dto/user.dto';
import { parseImportFile } from '../src/modules/users/user-import.parser';
import { UserImportService } from '../src/modules/users/user-import.service';
import { UsersService } from '../src/modules/users/users.service';

const migration = (...parts: string[]) => readFileSync(resolve(__dirname, '..', 'drizzle', ...parts), 'utf8');

const actor: AccessContext = {
  id: 99,
  username: 'manager',
  fullName: 'Quản lý',
  title: '',
  departmentId: null,
  departmentName: '',
  roles: [],
  permissions: [],
  dataScope: 'ALL',
  departmentIds: [],
  isSuperAdmin: true,
  sessionId: 'test',
};

async function setup() {
  const pg = await PGlite.create();
  await pg.exec(migration('0000_init_khoi_tao.sql'));
  await pg.exec(migration('0005_them_danh_muc_chuc_danh.sql'));
  await pg.exec(migration('0013_telegram_link.sql'));
  await pg.exec(migration('0034_ma_nhan_vien_lien_thong.sql'));
  const db = drizzle(pg, { schema });
  const dbService = { db, transaction: db.transaction.bind(db) } as unknown as DbService;
  const auth = {
    hashPassword: async (value: string) => `hash:${value}`,
    invalidateUserCache: async () => undefined,
    revokeAllSessions: async () => undefined,
  };
  const settings = { passwordMinLength: async () => 1 };
  return {
    pg,
    dbService,
    auth,
    settings,
    importer: new UserImportService(dbService, auth as never, { log: async () => undefined } as never, settings as never),
    users: new UsersService(dbService, auth as never, {} as never, settings as never),
  };
}

test('migration MANV backfill 4 ký tự đầu, cho phép trùng lịch sử và giữ liên kết sinh trắc học', async (t) => {
  const pg = await PGlite.create();
  t.after(() => pg.close());
  await pg.exec(migration('0000_init_khoi_tao.sql'));
  await pg.exec(migration('0015_lich_truc.sql'));
  await pg.exec(migration('0019_kiosk_duty_attendance.sql'));
  await pg.exec(`
    INSERT INTO users (id, username, password_hash, full_name) VALUES
      (1, 'abcdef', 'hash', 'Người A'),
      (2, 'abcd-legacy', 'hash', 'Người B'),
      (3, 'abc', 'hash', 'Người C');
    INSERT INTO user_biometrics (user_id, face_descriptor) VALUES (1, '[0.1,0.2]');
  `);

  await pg.exec(migration('0034_ma_nhan_vien_lien_thong.sql'));
  await pg.exec(migration('0034_ma_nhan_vien_lien_thong.sql'));

  const users = await pg.query<{ id: number; username: string; manv: string }>('SELECT id, username, manv FROM users ORDER BY id');
  assert.deepEqual(users.rows, [
    { id: 1, username: 'abcdef', manv: 'abcd' },
    { id: 2, username: 'abcd-legacy', manv: 'abcd' },
    { id: 3, username: 'abc', manv: 'abc' },
  ], 'backfill không sửa username/ID, giữ đúng 4 ký tự đầu (hoặc toàn bộ username ngắn hơn 4)');
  const biometric = await pg.query<{ user_id: number; face_descriptor: string }>('SELECT user_id, face_descriptor FROM user_biometrics');
  assert.deepEqual(biometric.rows, [{ user_id: 1, face_descriptor: '[0.1,0.2]' }], 'không thay đổi khoá liên kết khuôn mặt');

  await pg.exec("UPDATE users SET manv = 'CUSTOM' WHERE id = 1");
  await pg.exec(migration('0034_ma_nhan_vien_lien_thong.sql'));
  const [manual] = (await pg.query<{ manv: string }>('SELECT manv FROM users WHERE id = 1')).rows;
  assert.equal(manual?.manv, 'CUSTOM', 'chạy lại migration không ghi đè MANV đã được nhập');
});

test('DTO API yêu cầu MANV khi thêm mới, kiểm tra định dạng và cho phép sửa từng phần', async () => {
  const valid = plainToInstance(CreateUserDto, { username: 'nhan.vien', manv: 'NV-001', fullName: 'Nhân viên' });
  assert.equal((await validate(valid)).length, 0);

  const missing = plainToInstance(CreateUserDto, { username: 'nhan.vien', fullName: 'Nhân viên' });
  assert.ok((await validate(missing)).some((error) => error.property === 'manv'));
  const invalid = plainToInstance(CreateUserDto, { username: 'nhan.vien', manv: 'mã có dấu', fullName: 'Nhân viên' });
  assert.ok((await validate(invalid)).some((error) => error.property === 'manv'));

  const partial = plainToInstance(UpdateUserDto, { manv: 'NV-002' });
  assert.equal((await validate(partial)).length, 0, 'sửa người dùng có thể chỉ gửi MANV');
});

test('API người dùng trả/lưu MANV khi tạo, sửa, tìm kiếm và sắp xếp', async (t) => {
  const fixture = await setup();
  t.after(() => fixture.pg.close());

  const created = await fixture.users.create({
    manv: 'EXT-01',
    username: 'New.Staff',
    fullName: 'Nhân viên mới',
    active: true,
  } as never, actor);
  assert.equal(created.manv, 'EXT-01');
  assert.equal(created.username, 'new.staff', 'tên đăng nhập vẫn là định danh đăng nhập riêng');

  const listed = await fixture.users.list({ page: 1, pageSize: 10, limit: 10, offset: 0, q: 'EXT-01', sortBy: 'manv', sortDir: 'asc' } as never);
  assert.equal(listed.total, 1);
  assert.equal(listed.items[0]?.manv, 'EXT-01');

  const updated = await fixture.users.update(created.id as number, { manv: 'EXT-02' } as never, actor);
  assert.equal(updated.manv, 'EXT-02');
  assert.equal(updated.username, 'new.staff', 'sửa MANV không thay đổi username hoặc ID');
});

test('nhập MANV từ JSON/tệp: lưu mã cung cấp, tự sinh khi trống và không ghi đè mã cũ nếu tệp không có MANV', async (t) => {
  const fixture = await setup();
  t.after(() => fixture.pg.close());

  const parsed = await parseImportFile(
    Buffer.from('Họ và tên,MANV,Tên đăng nhập\nNguyễn Văn An,NV-001,nguyen.van.an\n', 'utf8'),
    'nhan-vien.csv',
  );
  assert.equal(parsed.columns.find((column) => column.header === 'MANV')?.field, 'employeeCode');
  assert.equal(parsed.rows[0]?.values.employeeCode, 'NV-001');

  const first = await fixture.importer.importJson(
    [
      { username: 'long.login', manv: 'NV-001', fullName: 'Nhân viên có mã liên thông' },
      { username: 'no-code-user', fullName: 'Nhân viên tự sinh mã' },
    ],
    { overwrite: false, dryRun: false },
    actor,
  );
  assert.deepEqual(first.rows.map((row) => ({ username: row.username, manv: row.manv })), [
    { username: 'long.login', manv: 'NV-001' },
    { username: 'no-code-user', manv: 'no-c' },
  ]);

  await fixture.importer.importJson(
    [{ username: 'long.login', manv: 'EXTERNAL-07', fullName: 'Nhân viên cập nhật mã' }],
    { overwrite: true, dryRun: false },
    actor,
  );
  await fixture.importer.importJson(
    [{ username: 'long.login', fullName: 'Nhân viên giữ mã cũ' }],
    { overwrite: true, dryRun: false },
    actor,
  );
  const imported = await fixture.dbService.db
    .select({ username: schema.users.username, manv: schema.users.manv, fullName: schema.users.fullName })
    .from(schema.users)
    .orderBy(schema.users.username);
  assert.deepEqual(imported, [
    { username: 'long.login', manv: 'EXTERNAL-07', fullName: 'Nhân viên giữ mã cũ' },
    { username: 'no-code-user', manv: 'no-c', fullName: 'Nhân viên tự sinh mã' },
  ]);
});
