// Hồi quy: cùng bác sĩ được xếp nhiều phòng trong CÙNG ca/ngày, nhưng các
// ràng buộc cho ca KHÁC vẫn giữ. Chạy với API/Web cục bộ đã build:
// PW_MODULE=/tmp/pw/node_modules/playwright/index.mjs node .ai/examples/parallel-room-assignment-regression.mjs
// Dùng dữ liệu kỳ lịch tạm ở tương lai, luôn xoá trong finally; không đụng dữ liệu lịch sẵn có.
const { chromium } = await import(process.env.PW_MODULE ?? 'playwright');

const WEB = process.env.WEB ?? 'http://localhost:3000';
const API = process.env.API ?? 'http://localhost:4000/api';
const checks = [];
const browserErrors = [];
const check = (label, ok) => checks.push([label, Boolean(ok)]);
const unwrap = (payload) => payload?.data ?? payload;

function addDays(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function vnDate(ymd) {
  const [year, month, day] = ymd.split('-');
  return `${day}/${month}/${year}`;
}

async function login(username, password) {
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(`Không đăng nhập được tài khoản ${username}: HTTP ${response.status}`);
  const json = await response.json();
  const data = unwrap(json);
  return { access: data.accessToken, refresh: data.refreshToken };
}

async function request(auth, path, { method = 'GET', body, expected = [200, 201] } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      authorization: `Bearer ${auth.access}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await response.json().catch(() => ({}));
  if (!expected.includes(response.status)) {
    throw new Error(`${method} ${path}: HTTP ${response.status} — ${JSON.stringify(json).slice(0, 500)}`);
  }
  return { status: response.status, json, data: unwrap(json) };
}

function freeFutureDate(periods) {
  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  for (let days = 120; days <= 1_500; days += 7) {
    const candidate = addDays(today, days);
    if (!periods.some((period) => period.startDate <= candidate && candidate <= period.endDate)) return candidate;
  }
  throw new Error('Không tìm được ngày tương lai trống để tạo kỳ kiểm thử');
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let period;
let temporaryRole;
let admin;
let browser;
let beforePeriodIds = [];
let beforeRoleIds = [];
let thrown;
try {
  admin = await login('admin', 'Admin@123');
  const [before, rolesBefore, roomsResult, shiftsResult] = await Promise.all([
    request(admin, '/duty/periods'),
    request(admin, '/duty/roles/options'),
    request(admin, '/duty/rooms/options'),
    request(admin, '/duty/shifts/options'),
  ]);
  beforePeriodIds = before.data.map((item) => item.id).sort((a, b) => a - b);
  beforeRoleIds = rolesBefore.data.map((item) => item.value).sort((a, b) => a - b);
  const date = freeFutureDate(before.data);
  const suffix = Date.now().toString(36).toUpperCase();
  const rooms = roomsResult.data.filter((item) => item.active !== false);
  const shifts = shiftsResult.data.filter((item) => item.active !== false);
  if (rooms.length < 2 || shifts.length < 2) {
    throw new Error('Cần tối thiểu 2 phòng và 2 ca hoạt động để hồi quy xếp nhiều phòng');
  }

  // Vai trò tạm không ràng buộc chức danh để dùng chính tài khoản ADMIN trong
  // môi trường kiểm thử, tránh tạo/lưu lại một hồ sơ nhân viên giả.
  temporaryRole = (await request(admin, '/duty/roles', {
    method: 'POST',
    body: { code: `TP_${suffix.slice(-10)}`, name: `Vai trò test song song ${suffix}`, requiredTitle: '', active: true },
  })).data;
  if (!temporaryRole?.id) throw new Error('Không tạo được vai trò kiểm thử tạm');

  const create = await request(admin, '/duty/periods', {
    method: 'POST',
    body: {
      name: `Kỳ song song phòng ${suffix}`,
      startDate: date,
      endDate: date,
      lockAt: new Date(Date.now() + 1_800 * 86_400_000).toISOString(),
      // Giới hạn 1 ca/ngày và 1 ca/kỳ làm rõ rằng hai phòng cùng một ca vẫn
      // được tính là một ca; ca khác trong ngày phải bị chặn.
      rules: {
        maxShiftsPerDay: 1,
        maxShiftsPerPeriod: 1,
        maxNightShiftsPerPeriod: 1,
        maxHoursPerDay: 0,
        maxHoursPerWeek: 0,
        minRestHours: 0,
        crossDeptPolicy: 'CHO_PHEP',
      },
    },
  });
  period = create.data;
  if (!period?.id) throw new Error('Không tạo được kỳ kiểm thử tạm');

  const [firstShift, otherShift] = shifts;
  const [firstRoom, secondRoom] = rooms;
  const createSlot = (room, shift) => request(admin, `/duty/periods/${period.id}/slots`, {
    method: 'POST',
    body: { dutyDate: date, roomId: room.value, shiftId: shift.value, roleId: temporaryRole.id, requiredCount: 1 },
  });
  const [slotOneResponse, slotTwoResponse, differentShiftResponse] = await Promise.all([
    createSlot(firstRoom, firstShift),
    createSlot(secondRoom, firstShift),
    createSlot(firstRoom, otherShift),
  ]);
  const slotOne = slotOneResponse.data;
  const slotTwo = slotTwoResponse.data;
  const differentShiftSlot = differentShiftResponse.data;

  const initialCandidates = await request(admin, `/duty/slots/${slotOne.id}/candidates`);
  const doctor = initialCandidates.data.find((candidate) => candidate.ok);
  if (!doctor) throw new Error('Không có bác sĩ phù hợp để kiểm thử phân công');
  check('tìm được bác sĩ hợp lệ cho ca đầu tiên', Boolean(doctor));

  await request(admin, `/duty/slots/${slotOne.id}/assignments`, {
    method: 'POST',
    body: { userId: doctor.userId },
  });
  check('xếp bác sĩ vào phòng thứ nhất thành công', true);

  const secondCandidates = await request(admin, `/duty/slots/${slotTwo.id}/candidates`);
  const sameShiftCandidate = secondCandidates.data.find((candidate) => candidate.userId === doctor.userId);
  check(
    'cùng bác sĩ vẫn là ứng viên hợp lệ ở phòng thứ hai cùng ca/ngày',
    sameShiftCandidate?.ok === true && !sameShiftCandidate.codes.includes('OVERLAP') && !sameShiftCandidate.codes.includes('SHIFTS_PER_DAY') && !sameShiftCandidate.codes.includes('SHIFTS_PER_PERIOD'),
  );

  // Luồng giao diện thực: chọn kỳ tạm, bấm trực tiếp ca ở phòng thứ hai, tìm
  // đúng bác sĩ và xếp không dùng quyền "bỏ qua ràng buộc".
  browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text().slice(0, 240)}`);
  });
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ access, refresh }) => {
    localStorage.setItem('qlbs_access_token', access);
    localStorage.setItem('qlbs_refresh_token', refresh);
  }, admin);
  await page.goto(`${WEB}/lich-truc`, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.getByRole('button', { name: 'Kỳ lịch khám' }).click();
  const periodSearch = page.getByPlaceholder('Ví dụ: tuần 42, 14/10, khám...');
  await periodSearch.fill(period.name);
  await page.getByRole('button', { name: new RegExp(escapeRegex(period.name)) }).click();
  await page.waitForTimeout(450);

  const gridBeforeUi = await request(admin, `/duty/periods/${period.id}/grid`);
  const uiSlotTwo = gridBeforeUi.data.slots.find((slot) => slot.id === slotTwo.id);
  if (!uiSlotTwo) throw new Error('Lưới lịch không có ca phòng thứ hai vừa tạo');
  const assignTile = page.getByRole('button', {
    name: new RegExp(`Xếp bác sĩ cho .*${escapeRegex(uiSlotTwo.roomName)}.*${escapeRegex(vnDate(date))}`),
  });
  await assignTile.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('Tìm bác sĩ...').fill(doctor.fullName);
  await page.waitForTimeout(500);
  check(
    'dialog hiển thị bác sĩ là Phù hợp, không yêu cầu bỏ qua ràng buộc',
    (await dialog.textContent()).includes(doctor.fullName) && (await dialog.textContent()).includes('Phù hợp') && !(await dialog.textContent()).includes('Trùng giờ'),
  );
  await dialog.getByRole('button', { name: 'Xếp', exact: true }).click();
  await page.waitForTimeout(700);
  await context.close();

  const assignedGrid = await request(admin, `/duty/periods/${period.id}/grid`);
  const assignmentIn = (slotId) => assignedGrid.data.slots.find((slot) => slot.id === slotId)?.assignments.some((assignment) => assignment.userId === doctor.userId);
  check('lưới lưu bác sĩ ở cả hai phòng của cùng ca', assignmentIn(slotOne.id) && assignmentIn(slotTwo.id));

  const differentShiftCandidates = await request(admin, `/duty/slots/${differentShiftSlot.id}/candidates`);
  const differentShiftCandidate = differentShiftCandidates.data.find((candidate) => candidate.userId === doctor.userId);
  check(
    'ca khác trong cùng ngày vẫn bị giới hạn số ca/ngày',
    differentShiftCandidate?.ok === false && differentShiftCandidate.codes.includes('SHIFTS_PER_DAY'),
  );
  const blockedDifferentShift = await request(admin, `/duty/slots/${differentShiftSlot.id}/assignments`, {
    method: 'POST',
    body: { userId: doctor.userId },
    expected: [409],
  });
  check('API vẫn từ chối xếp thêm ca khác khi vượt giới hạn', blockedDifferentShift.status === 409);
  check('không có browser error trong luồng xếp trực tiếp', browserErrors.length === 0);
} catch (error) {
  thrown = error;
} finally {
  await browser?.close().catch(() => {});
  if (period?.id && admin) {
    try {
      await request(admin, `/duty/periods/${period.id}/delete`, {
        method: 'POST',
        body: { reason: 'Dọn dữ liệu hồi quy xếp nhiều phòng cùng ca', confirmName: period.name },
      });
      check('đã xoá hoàn toàn kỳ kiểm thử tạm', true);
    } catch (error) {
      check('đã xoá hoàn toàn kỳ kiểm thử tạm', false);
      thrown ??= error;
    }
  }
  if (temporaryRole?.id && admin) {
    try {
      await request(admin, `/duty/roles/${temporaryRole.id}`, { method: 'DELETE' });
      check('đã xoá hoàn toàn vai trò kiểm thử tạm', true);
    } catch (error) {
      check('đã xoá hoàn toàn vai trò kiểm thử tạm', false);
      thrown ??= error;
    }
  }
  if (admin) {
    try {
      const [after, rolesAfter] = await Promise.all([
        request(admin, '/duty/periods'),
        request(admin, '/duty/roles/options'),
      ]);
      const afterIds = after.data.map((item) => item.id).sort((a, b) => a - b);
      const afterRoleIds = rolesAfter.data.map((item) => item.value).sort((a, b) => a - b);
      check('danh sách kỳ lịch có sẵn không thay đổi sau hồi quy', JSON.stringify(afterIds) === JSON.stringify(beforePeriodIds));
      check('danh mục vai trò có sẵn không thay đổi sau hồi quy', JSON.stringify(afterRoleIds) === JSON.stringify(beforeRoleIds));
    } catch (error) {
      thrown ??= error;
    }
  }
}

for (const [label, ok] of checks) console.log(ok ? '  ✔' : '  ✘', label);
if (browserErrors.length) console.log(browserErrors.join('\n'));
if (thrown) console.error(thrown instanceof Error ? thrown.stack : thrown);
const failed = checks.filter(([, ok]) => !ok);
console.log(failed.length || thrown || browserErrors.length ? `\nKhông đạt: ${failed.length} kiểm tra, ${browserErrors.length} browser error` : `\nĐạt ${checks.length} kiểm tra xếp nhiều phòng cùng ca; dữ liệu tạm đã dọn`);
process.exit(failed.length || thrown || browserErrors.length ? 1 : 0);
