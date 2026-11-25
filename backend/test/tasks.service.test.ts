import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

// Lưu tệp đính kèm vào thư mục tạm (phải đặt trước khi nạp config)
const STORAGE = mkdtempSync(join(tmpdir(), 'qlbv-task-'));
process.env.STORAGE_DIR = STORAGE;

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as ExcelJS from 'exceljs';
import { PERMISSIONS_KEY } from '../src/common/decorators';
import type { AccessContext } from '../src/common/types/access-context';
import { DbService } from '../src/db/db.service';
import * as schema from '../src/db/schema';
import type { NotificationCenterService } from '../src/modules/notifications/notification-center.service';
import { normalizeVnPhone } from '../src/modules/notify-channels/telegram.service';
import type { RealtimeService } from '../src/modules/realtime/realtime.service';
import type { SettingsService } from '../src/modules/settings/settings.service';
import { TaskDigestService, composeDigest } from '../src/modules/tasks/task-digest.service';
import { TaskProjectsService } from '../src/modules/tasks/task-projects.service';
import { TaskRemindersService } from '../src/modules/tasks/task-reminders.service';
import { TaskReportsService, buildBuckets, bucketStart } from '../src/modules/tasks/task-reports.service';
import {
  actionForMove,
  allowedActions,
  canPerform,
  fileSignatureMatches,
  nextOccurrence,
  performanceScore,
} from '../src/modules/tasks/task-workflow';
import { TasksController } from '../src/modules/tasks/tasks.controller';
import { TasksService } from '../src/modules/tasks/tasks.service';

test.after(() => rmSync(STORAGE, { recursive: true, force: true }));

const dir = resolve(__dirname, '..', 'drizzle');
const migrations = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

const ctx = (id: number, departmentId: number | null, permissions: string[] = [], dataScope: 'OWN' | 'DEPT' | 'ALL' = 'DEPT'): AccessContext => ({
  id, username: `u${id}`, fullName: `User ${id}`, title: '', departmentId, departmentName: '', roles: [], permissions, dataScope,
  departmentIds: departmentId ? [departmentId] : [], isSuperAdmin: false, sessionId: `t-${id}`,
} as AccessContext);

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

async function setup() {
  const pg = await PGlite.create();
  for (const f of migrations) await pg.exec(readFileSync(join(dir, f), 'utf8'));
  await pg.exec(`
    INSERT INTO departments (id, code, name, short_name, sort_order, active) VALUES
      (10, 'A1', 'Khoa A1', 'A1', 10, true), (11, 'B1', 'Khoa B1', 'B1', 20, true);
    INSERT INTO users (id, manv, username, password_hash, full_name, title, department_id, active, phone) VALUES
      (1, 'NV01', 'truongkhoa', 'h', 'Trưởng khoa A', 'Trưởng khoa', 10, true, '0901 234 567'),
      (2, 'NV02', 'nhanvien2', 'h', 'Nhân viên Hai', 'Điều dưỡng', 10, true, ''),
      (3, 'NV03', 'nhanvien3', 'h', 'Nhân viên Ba', 'Kỹ thuật viên', 10, true, ''),
      (4, 'NV04', 'khoab', 'h', 'Người khoa B', 'Bác sĩ', 11, true, '');
  `);
  const db = drizzle(pg, { schema });
  const dbs = { db, transaction: db.transaction.bind(db) } as unknown as DbService;
  const sent: Array<{ userIds: number[]; title: string; kind?: string; body?: string }> = [];
  const notifications = {
    notify: async (userIds: number[], input: { title: string; body?: string; externalKind?: string }) => {
      sent.push({ userIds, title: input.title, kind: input.externalKind, body: input.body });
    },
  } as unknown as NotificationCenterService;
  const realtime = { publish: () => undefined } as unknown as RealtimeService;
  const settings = { get: async (_k: string, fallback: unknown) => fallback } as unknown as SettingsService;
  const service = new TasksService(dbs, notifications, realtime);
  return {
    pg, db, sent, service,
    projects: new TaskProjectsService(dbs, service),
    reports: new TaskReportsService(dbs),
    reminders: new TaskRemindersService(dbs, settings, service),
    digest: new TaskDigestService(dbs, settings, notifications),
  };
}

const manager = ctx(1, 10, ['task.assign', 'task.manage', 'task.report', 'task.export']);
const staff2 = ctx(2, 10);
const staff3 = ctx(3, 10);
const outsider = ctx(4, 11);

test('hàm thuần: luồng trạng thái, kéo thả Kanban, lặp lại, điểm hiệu suất, chữ ký tệp, số điện thoại', () => {
  const people = { assigneeId: 2, assignerId: 1, reviewerId: 1 };
  const assignee = { isAssignee: true, isAssigner: false, isReviewer: false, isCreator: false, managesScope: false, isProjectManager: false };
  const boss = { isAssignee: false, isAssigner: true, isReviewer: true, isCreator: true, managesScope: false, isProjectManager: false };
  assert.ok(canPerform('accept', 'ASSIGNED', assignee, people));
  assert.ok(!canPerform('approve', 'SUBMITTED', assignee, people), 'người thực hiện không tự duyệt');
  assert.ok(canPerform('approve', 'SUBMITTED', boss, people));
  assert.ok(!canPerform('accept', 'ASSIGNED', boss, people), 'người giao không nhận thay');
  assert.deepEqual(allowedActions('SUBMITTED', assignee, people), []);
  // tự giao cho mình: được tự duyệt
  const self = { assigneeId: 1, assignerId: 1, reviewerId: 1 };
  assert.ok(canPerform('approve', 'SUBMITTED', { ...boss, isAssignee: true }, self));

  assert.equal(actionForMove('IN_PROGRESS', 'SUBMITTED'), 'submit');
  assert.equal(actionForMove('ASSIGNED', 'ACCEPTED'), 'accept');
  assert.equal(actionForMove('SUBMITTED', 'DONE'), 'approve');
  assert.equal(actionForMove('DONE', 'ASSIGNED'), null);

  assert.equal(nextOccurrence(new Date('2026-01-31T02:00:00Z'), 'MONTHLY', 1).toISOString().slice(0, 10), '2026-02-28', 'cuối tháng không nhảy sang tháng sau');
  assert.equal(nextOccurrence(new Date('2026-03-02T02:00:00Z'), 'WEEKLY', 2).toISOString().slice(0, 10), '2026-03-16');
  assert.equal(performanceScore({ onTimeRate: 1, completionRate: 1, returnRate: 0 }), 100);
  assert.equal(performanceScore({ onTimeRate: 0.5, completionRate: 1, returnRate: 0.5 }), 65);
  assert.equal(performanceScore({ onTimeRate: null, completionRate: null, returnRate: null }), null);

  assert.ok(fileSignatureMatches('.png', PNG));
  assert.ok(!fileSignatureMatches('.pdf', PNG), 'đổi đuôi tệp bị chặn');
  assert.ok(fileSignatureMatches('.pdf', Buffer.from('%PDF-1.7\n')));

  assert.equal(normalizeVnPhone('+84 901 234 567'), '0901234567');
  assert.equal(normalizeVnPhone('84901234567'), '0901234567');
  assert.equal(normalizeVnPhone('0901.234.567'), '0901234567');
  assert.equal(normalizeVnPhone('12345'), '', 'số quá ngắn không hợp lệ');

  assert.equal(bucketStart('2026-10-08', 'week'), '2026-10-05', 'tuần bắt đầu Thứ Hai');
  assert.deepEqual(buildBuckets('2026-01-15', '2026-03-02', 'month'), ['2026-01-01', '2026-02-01', '2026-03-01']);
});

test('API: quyền giao việc, báo cáo, xuất báo cáo khai báo đúng', () => {
  const meta = (name: keyof TasksController) => Reflect.getMetadata(PERMISSIONS_KEY, TasksController.prototype[name]);
  assert.equal(meta('list'), undefined, 'mọi nhân viên xem việc của mình');
  assert.deepEqual(meta('createProject'), ['task.assign']);
  assert.deepEqual(meta('reportOverview'), ['task.report']);
  assert.deepEqual(meta('reportExport'), ['task.report', 'task.export']);
  assert.deepEqual(meta('createTemplate'), ['task.assign']);
});

test('giao việc → nhận → làm → gửi duyệt → trả lại → duyệt; phân quyền xem và thông báo', async (t) => {
  const { pg, service, sent, reports } = await setup();
  t.after(() => pg.close());

  await assert.rejects(service.create(staff2, { title: 'Giao trái phép', assigneeId: 3 }), /quyền|phạm vi/i, 'nhân viên thường không giao việc cho người khác');
  await assert.rejects(service.create(manager, { title: 'Ngoài phạm vi', assigneeId: 4 }), /phạm vi|khoa/i);

  const due = new Date(Date.now() + 3 * 86400_000).toISOString();
  const created = await service.create(manager, {
    title: 'Rà soát hồ sơ bệnh án tháng 10',
    description: 'Kiểm tra đủ chữ ký',
    assigneeIds: [2, 3],
    priority: 'HIGH',
    dueAt: due,
    checklist: ['Khoa nội', 'Khoa ngoại'],
    labels: ['HSBA'],
    files: [{ fileName: 'mau.png', contentBase64: PNG.toString('base64') }],
  });
  assert.equal(created.ids.length, 2, 'giao nhiều người → mỗi người một việc');
  assert.match(created.code, /^CV-\d{4}-\d{5}$/);
  assert.ok(sent.some((s) => s.userIds.includes(2) && s.kind === 'task.assigned'), 'người được giao nhận thông báo');

  const id = created.items.find((i) => i.assigneeId === 2)!.id;
  const other = created.items.find((i) => i.assigneeId === 3)!.id;
  await assert.rejects(service.detail(outsider, id), /quyền/i, 'khoa khác không xem được');
  await assert.rejects(service.detail(staff3, id), /quyền/i, 'đồng nghiệp không liên quan không xem được');

  const d0 = await service.detail(staff2, id);
  assert.equal(d0.status, 'ASSIGNED');
  assert.deepEqual(d0.viewer.allowedActions.sort(), ['accept', 'decline']);
  assert.equal(d0.checklist.length, 2);
  assert.equal(d0.attachments.length, 1);

  const mine = await service.list(staff2, { view: 'mine' });
  assert.deepEqual(mine.items.map((i) => i.id), [id]);

  await assert.rejects(service.transition(staff2, id, { action: 'decline' }), /lý do/i);
  await service.transition(staff3, other, { action: 'decline', reason: 'Đang nghỉ phép' });
  await assert.rejects(service.transition(manager, id, { action: 'accept' }), /quyền/i);
  await service.transition(staff2, id, { action: 'accept' });
  await service.transition(staff2, id, { action: 'start' });
  await assert.rejects(service.transition(staff2, id, { action: 'submit' }), /kết quả/i, 'gửi duyệt cần nội dung hoặc tệp');
  await service.transition(staff2, id, { action: 'submit', resultContent: 'Đã rà soát 120 hồ sơ' });
  await assert.rejects(service.transition(staff2, id, { action: 'approve' }), /tự duyệt/i);
  await service.transition(manager, id, { action: 'return', reason: 'Thiếu khoa ngoại' });
  await service.addComment(staff2, id, { content: 'Em bổ sung ngay ạ @truongkhoa' });
  assert.ok(sent.some((s) => s.userIds.includes(1) && /nhắc|trao đổi|bình luận/i.test(s.title)), 'nhắc tên @username gửi thông báo');
  await service.addWorklog(staff2, id, { workDate: '2026-10-10', hours: 2.5, content: 'Rà soát bổ sung', progress: 90 });
  await service.transition(staff2, id, { action: 'submit', resultContent: 'Đã bổ sung khoa ngoại' });
  const done = await service.transition(manager, id, { action: 'approve' });
  assert.equal(done.status, 'DONE');
  assert.equal(done.returnCount, 1);
  assert.ok(sent.some((s) => s.userIds.includes(2) && s.kind === 'task.approved'));

  const history = await service.history(staff2, id);
  const actions = history.logs.map((h) => h.action);
  for (const a of ['CREATE', 'ACCEPT', 'START', 'SUBMIT', 'RETURN', 'APPROVE']) assert.ok(actions.includes(a), `lịch sử có ${a}`);

  // Tổng quan cá nhân: thống kê + danh sách tôi đã giao
  const mySum = await service.mySummary(staff2);
  assert.equal(mySum.stats.series.length, 30);
  assert.ok(mySum.stats.byStatus.some((b) => b.status === 'DONE' && b.count === 1));
  assert.equal(mySum.stats.series.reduce((a, d) => a + d.done, 0), 1);
  assert.equal(mySum.stats.onTimeRateMonth, 1);
  const boss = await service.mySummary(manager);
  assert.ok(Array.isArray(boss.assigned));
  assert.ok(boss.assigned.every((t) => !['DONE', 'CANCELLED', 'DRAFT'].includes(t.status)));

  // Báo cáo
  const ov = await reports.overview(manager, {});
  assert.equal(ov.kpi.assigned, 2);
  assert.equal(ov.kpi.done, 1);
  assert.equal(ov.kpi.onTime, 1);
  assert.equal(ov.kpi.returned, 1);
  await assert.rejects(reports.overview(staff2, {}), /quyền/i);
});

test('việc tự giao, việc con, phụ thuộc, lặp lại định kỳ, nhắc hạn', async (t) => {
  const { pg, service, reminders, sent, db } = await setup();
  t.after(() => pg.close());

  const selfTask = await service.create(staff2, { title: 'Tự lập kế hoạch tuần', assigneeId: 2, recurrence: { freq: 'WEEKLY', interval: 1 }, dueAt: new Date(Date.now() + 2 * 3600_000).toISOString() });
  const s = await service.detail(staff2, selfTask.id);
  assert.equal(s.status, 'ACCEPTED', 'việc tự giao không cần nhận');

  const parent = await service.create(manager, { title: 'Chuẩn bị đoàn kiểm tra', assigneeId: 2 });
  const child = await service.create(staff2, { title: 'In biểu mẫu', assigneeId: 2, parentId: parent.id });
  const blocker = await service.create(manager, { title: 'Duyệt kinh phí', assigneeId: 3 });
  await service.setDependencies(manager, parent.id, [blocker.id]);
  await service.transition(staff2, parent.id, { action: 'accept' });
  await assert.rejects(service.transition(staff2, parent.id, { action: 'start' }), /tiên quyết/i);
  await service.transition(manager, blocker.id, { action: 'cancel', reason: 'Không cần nữa' });
  await service.transition(staff2, parent.id, { action: 'start' });
  await assert.rejects(service.transition(staff2, parent.id, { action: 'submit', resultContent: 'xong' }), /việc con/i);
  await service.transition(staff2, child.id, { action: 'submit', resultContent: 'Đã in' });
  await service.transition(staff2, child.id, { action: 'approve' });

  // Lặp lại: tự duyệt việc tự giao → sinh kỳ kế tiếp
  await service.transition(staff2, selfTask.id, { action: 'submit', resultContent: 'Kế hoạch xong' });
  await service.transition(staff2, selfTask.id, { action: 'approve' });
  const list = await service.list(staff2, { view: 'mine', q: 'Tự lập kế hoạch' });
  assert.equal(list.items.filter((i) => i.status !== 'DONE').length, 1, 'đã sinh việc kỳ sau');

  // Nhắc hạn: việc hạn trong 24h + việc đã quá hạn
  const soon = await service.create(manager, { title: 'Nộp báo cáo giao ban', assigneeId: 3, dueAt: new Date(Date.now() + 5 * 3600_000).toISOString() });
  const late = await service.create(manager, { title: 'Cập nhật danh mục', assigneeId: 3, dueAt: new Date(Date.now() + 3600_000).toISOString() });
  await db.update(schema.tasks).set({ dueAt: new Date(Date.now() - 3600_000) }).where((await import('drizzle-orm')).eq(schema.tasks.id, late.id));
  sent.length = 0;
  const r1 = await reminders.run();
  assert.ok(r1.dueSoon >= 1 && r1.overdue >= 1);
  assert.ok(sent.some((x) => x.kind === 'task.dueSoon' && x.userIds.includes(3)));
  assert.ok(sent.some((x) => x.kind === 'task.overdue' && x.userIds.includes(3) && x.userIds.includes(1)));
  const r2 = await reminders.run();
  assert.deepEqual(r2, { dueSoon: 0, overdue: 0 }, 'mỗi việc chỉ nhắc một lần');
  assert.ok(soon.id);
});

test('dự án: thành viên, ai làm việc gì, tiến độ; xuất Excel/Word/CSV', async (t) => {
  const { pg, projects, service, reports } = await setup();
  t.after(() => pg.close());
  await assert.rejects(projects.create(staff2, { name: 'Không có quyền' }), /quyền/i);
  const p = await projects.create(manager, { name: 'Chuẩn bị kiểm tra chất lượng 2026', members: [{ userId: 2 }, { userId: 3, role: 'MEMBER' }] });
  assert.match(p.code, /^DA-\d{4}-\d{4}$/);
  const t1 = await service.create(manager, { title: 'Bảng kiểm A', assigneeId: 2, projectId: p.id });
  await service.create(manager, { title: 'Bảng kiểm B', assigneeId: 3, projectId: p.id });
  await service.transition(staff2, t1.id, { action: 'accept' });
  await service.transition(staff2, t1.id, { action: 'submit', resultContent: 'ok' });
  await service.transition(manager, t1.id, { action: 'approve' });

  const detail = await projects.detail(staff3, p.id);
  assert.equal(detail.members.length, 3);
  assert.equal(detail.stats.total, 2);
  assert.equal(detail.progress, 50);
  const m2 = detail.members.find((m) => m.userId === 2)!;
  assert.equal(m2.tasks[0]!.title, 'Bảng kiểm A');
  assert.equal(detail.viewer.canManage, false);
  await assert.rejects(projects.update(staff3, p.id, { name: 'x' }), /quản lý dự án/i);
  await assert.rejects(projects.detail(outsider, p.id), /quyền/i);
  const listed = await projects.list(staff2, {});
  assert.deepEqual(listed.map((x) => x.id), [p.id]);
  await assert.rejects(projects.remove(manager, p.id), /đang mở/i);

  const xlsx = await reports.export(manager, { format: 'xlsx' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx.buffer as unknown as ArrayBuffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Tổng quan', 'Theo nhân viên', 'Theo khoa phòng', 'Theo dự án', 'Theo thời gian', 'Chi tiết công việc']);
  assert.equal(wb.getWorksheet('Chi tiết công việc')!.rowCount, 5);
  const docx = await reports.export(manager, { format: 'docx' });
  assert.equal(docx.buffer.subarray(0, 2).toString(), 'PK');
  const csv = await reports.export(manager, { format: 'csv' });
  assert.ok(csv.buffer.toString('utf8').includes('Bảng kiểm A'));
  const perf = await reports.performance(manager, {});
  assert.equal(perf.people.find((x) => x.key === 2)!.score, 100);
});

test('sửa tin nhắn, lọc theo hạn chót (lịch), khối lượng công việc, số việc khi chọn người', async (t) => {
  const { pg, service, reports, sent } = await setup();
  t.after(() => pg.close());
  const a = await service.create(manager, { title: 'Việc hạn 15/10', assigneeId: 2, dueAt: '2026-10-15T09:00:00+07:00', priority: 'HIGH', estimateHours: 4 });
  await service.create(manager, { title: 'Việc hạn 20/11', assigneeId: 2, dueAt: '2026-11-20T09:00:00+07:00' });
  await service.create(manager, { title: 'Việc của NV3', assigneeId: 3 });

  // Lịch: chỉ lấy việc có hạn trong tháng 10
  const oct = await service.list(manager, { dueFrom: '2026-10-01', dueTo: '2026-10-31', pageSize: '500' });
  assert.deepEqual(oct.items.map((i) => i.title), ['Việc hạn 15/10']);

  // Sửa tin nhắn: chỉ người viết; nhắc tên mới được thông báo; đánh dấu đã sửa
  const c = await service.addComment(staff2, a.id, { content: 'Em đang làm' });
  await assert.rejects(service.editComment(manager, a.id, c.id, { content: 'sửa hộ' }), /người viết/i);
  await assert.rejects(service.editComment(staff2, a.id, c.id, { content: '   ' }), /trống/i);
  await new Promise((r) => setTimeout(r, 1100));
  sent.length = 0;
  const edited = await service.editComment(staff2, a.id, c.id, { content: 'Em đang làm, nhờ @truongkhoa xem giúp' });
  assert.equal(edited?.content, 'Em đang làm, nhờ @truongkhoa xem giúp');
  assert.equal(edited?.edited, true);
  assert.ok(sent.some((x) => x.kind === 'task.mention' && x.userIds.includes(1)));
  const hist = await service.history(manager, a.id);
  assert.ok(hist.logs.some((l) => l.action === 'COMMENT_EDIT'));
  const list = await service.listComments(manager, a.id);
  assert.equal(list[0]!.canEdit, false);
  assert.equal(list[0]!.canDelete, true, 'người giao việc vẫn xóa được');

  // Khối lượng
  await assert.rejects(reports.workload(staff2, {}), /quyền/i);
  const wl = await reports.workload(manager, {});
  const p2 = wl.people.find((p) => p.userId === 2)!;
  assert.equal(p2.waiting, 2);
  assert.equal(p2.urgent, 1);
  assert.equal(p2.remainingHours, 4);
  assert.ok(wl.people.some((p) => p.userId === 1 && p.active === 0 && p.level === 'idle'), 'liệt kê cả người rảnh trong khoa');
  assert.ok(!wl.people.some((p) => p.userId === 4), 'không lộ người khoa khác');
  await assert.rejects(reports.workload(manager, { departmentId: '11' }), /phạm vi/i);

  const people = await service.assignableUsers(manager, {});
  assert.equal(people.find((u) => u.id === 2)!.openCount, 2);
});

test('tổng hợp công việc hàng tuần: soạn nội dung, đúng ngày giờ, không gởi trùng, tắt theo người', async (t) => {
  const { pg, service, digest, sent } = await setup();
  t.after(() => pg.close());
  const text = composeDigest(
    { open: 3, toAccept: 1, inProgress: 2, onHold: 0, returned: 0, overdue: 1, dueWeek: 2, mySubmitted: 0, doneWeek: 4, doneOnTime: 3, doneLate: 1, toReview: 2, assignedOpen: 5, assignedOverdue: 1 },
    [{ code: 'CV-2026-00001', title: 'Báo cáo quý', dueAt: '2026-10-01T02:00:00Z', status: 'IN_PROGRESS', priority: 'URGENT' }],
    new Date('2026-10-12T00:30:00Z'),
  );
  assert.match(text.title, /12\/10/);
  assert.match(text.body, /3 đang mở · 1 chờ nhận · 2 đang làm/);
  assert.match(text.body, /hoàn thành 4 việc \(đúng hạn 3, trễ 1\)/);
  assert.match(text.body, /Chờ tôi duyệt: 2/);
  assert.match(text.body, /🔴 CV-2026-00001 Báo cáo quý — hạn 01\/10 \(quá hạn\)/);

  // 12/10/2026 là Thứ Hai: 06:59 chưa gởi, 07:00 mới gởi
  assert.equal(TaskDigestService.dueWindow(new Date('2026-10-11T23:59:00Z'), 1, 7), null);
  assert.ok(TaskDigestService.dueWindow(new Date('2026-10-12T00:00:00Z'), 1, 7));
  assert.equal(TaskDigestService.dueWindow(new Date('2026-10-13T01:00:00Z'), 1, 7), null, 'Thứ Ba không gởi');

  await service.create(manager, { title: 'Lập kế hoạch tháng', assigneeId: 2, dueAt: new Date(Date.now() + 2 * 86400_000).toISOString() });
  sent.length = 0;
  const monday = new Date('2026-10-12T01:00:00Z');
  const r1 = await digest.run(monday);
  assert.equal(r1.sent, 2, 'người được giao + người giao việc; người không có việc bỏ qua');
  const toStaff = sent.find((x) => x.userIds.includes(2))!;
  assert.equal(toStaff.kind, 'task.weeklyDigest');
  assert.match(toStaff.body ?? '', /Lập kế hoạch tháng/);
  assert.match(sent.find((x) => x.userIds.includes(1))!.body ?? '', /Tôi đã giao: 1 đang thực hiện/);
  assert.equal((await digest.run(new Date('2026-10-12T05:00:00Z'))).sent, 0, 'không gởi trùng trong ngày');

  await digest.setEnabled(2, false);
  const st = await digest.myStatus(2);
  assert.equal(st.enabled, false);
  assert.match(st.schedule, /Thứ Hai/);
  sent.length = 0;
  await digest.run(new Date('2026-10-19T01:00:00Z'));
  assert.ok(!sent.some((x) => x.userIds.includes(2)), 'đã tắt thì không nhận');
  assert.ok(sent.some((x) => x.userIds.includes(1)), 'tuần sau người khác vẫn nhận');

  const pv = await digest.preview(2);
  assert.equal(pv.hasContent, true);
  await digest.sendTest(2);
  assert.ok(sent.some((x) => x.userIds.includes(2) && x.kind === 'task.weeklyDigest'), 'gửi thử vẫn được dù đã tắt');
});
