import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { limitReadQuery, validateSql } from '../src/modules/sql-console/sql-console.policy';

const messageOf = (fn: () => unknown) => {
  try {
    fn();
    return '';
  } catch (error) {
    return error instanceof HttpException ? error.message : String(error);
  }
};

test('SQL Console cho SELECT, WITH và EXPLAIN thuần; xem trước được giới hạn trên server', () => {
  assert.equal(validateSql('select id from users').operation, 'SELECT');
  assert.equal(validateSql('with active_users as (select id from users) select * from active_users').operation, 'SELECT');
  assert.equal(validateSql('explain select * from users where id = 1').operation, 'EXPLAIN');
  assert.equal(limitReadQuery('select id from users', 1000), 'select * from (select id from users) as "__qlbs_sql_console" limit 1000');
});

test('SQL Console chặn nhiều câu lệnh, DDL, DML ẩn trong CTE và EXPLAIN ANALYZE', () => {
  assert.match(messageOf(() => validateSql('select 1; delete from users where id = 1')), /dấu chấm phẩy/i);
  assert.match(messageOf(() => validateSql('drop table users')), /Chỉ hỗ trợ/i);
  assert.match(messageOf(() => validateSql('with removed as (delete from users where id = 1 returning id) select * from removed')), /thao tác ghi/i);
  assert.match(messageOf(() => validateSql('explain analyze select * from users')), /ANALYZE/i);
  assert.match(messageOf(() => validateSql('select pg_terminate_backend(1)')), /hàm quản trị/i);
  assert.match(messageOf(() => validateSql('select pg_advisory_unlock_all()')), /hàm quản trị/i);
  assert.match(messageOf(() => validateSql('select * into copy_users from users')), /khóa|thao tác ghi/i);
});

test('UPDATE/DELETE bắt buộc WHERE, câu lệnh ghi có phân loại chính xác', () => {
  assert.equal(validateSql("insert into settings(key, value) values ('x', '1')", 'WRITE').operation, 'INSERT');
  assert.equal(validateSql("update settings set value = '1' where key = 'x'", 'WRITE').operation, 'UPDATE');
  assert.equal(validateSql('delete from settings where key = \'x\'', 'WRITE').operation, 'DELETE');
  assert.match(messageOf(() => validateSql('update settings set value = \'x\'')), /bắt buộc có WHERE/i);
  assert.match(messageOf(() => validateSql('delete from settings')), /bắt buộc có WHERE/i);
  assert.match(messageOf(() => validateSql("update settings set value = (select 'x' where true)")), /cấp ngoài cùng/i);
});

test('bảo toàn bảng migration và audit, kể cả định danh có dấu nháy/schema', () => {
  assert.match(messageOf(() => validateSql('delete from audit_logs where id = 1')), /không được ghi trực tiếp/i);
  assert.match(messageOf(() => validateSql('update public."audit_logs" set action = \'x\' where id = 1')), /không được ghi trực tiếp/i);
  assert.match(messageOf(() => validateSql('delete from _qlbs_migrations where id = 1')), /không được ghi trực tiếp/i);
  assert.match(messageOf(() => validateSql('delete from login_logs where id = 1')), /không được ghi trực tiếp/i);
});

test('chuỗi có từ khoá SQL hoặc dấu chấm phẩy không bị hiểu thành lệnh thứ hai', () => {
  assert.equal(validateSql("select 'delete; update' as note from users limit 1").operation, 'SELECT');
  assert.equal(validateSql("update settings set value = 'select; delete' where key = 'x'", 'WRITE').operation, 'UPDATE');
});
