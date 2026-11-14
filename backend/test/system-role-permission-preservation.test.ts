import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(__dirname, '..');

test('khởi động sau update không thay tập quyền đã cấu hình của vai trò hệ thống', () => {
  const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');
  const seed = readFileSync(resolve(root, 'scripts', 'seed.ts'), 'utf8');
  const sync = readFileSync(resolve(root, 'scripts', 'sync-system-roles.ts'), 'utf8');

  assert.doesNotMatch(dockerfile, /sync-system-roles\.ts\s+--apply/, 'Docker CMD không được chạy cơ chế thay quyền mỗi lần update');
  assert.match(seed, /rolePermissions[\s\S]{0,400}onConflictDoNothing\(\)/, 'seed phải chỉ thêm liên kết quyền còn thiếu');
  assert.doesNotMatch(sync, /delete\(rolePermissions\)/, 'script đồng bộ thủ công không được xóa quyền đang có');
  assert.match(sync, /const toAdd = .*?!current\.has/, 'script đồng bộ chỉ xác định quyền chuẩn còn thiếu để bổ sung');
  assert.match(sync, /preservedCustom/, 'script phải nhận diện và giữ quyền tùy chỉnh');
});
