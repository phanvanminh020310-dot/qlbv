// Kiểm thử giao diện LỊCH TRỰC (Playwright): đăng nhập bằng API, mở các trang chính ở máy tính và điện thoại,
// kiểm tra quyền hiển thị (nhân viên không vào được Kỳ lịch/Danh mục), chụp ảnh vào /tmp/shots và báo lỗi console.
// Chạy:
//   PW_MODULE=/tmp/pw/node_modules/playwright/index.mjs node .ai/examples/duty-ui-test.mjs
// (WEB mặc định http://localhost:3000, API mặc định http://localhost:4000/api; cần admin / Admin@123)
const { chromium } = await import(process.env.PW_MODULE ?? 'playwright');
const WEB = process.env.WEB ?? 'http://localhost:3000';
const API = process.env.API ?? 'http://localhost:4000/api';
const fs = await import('node:fs');
fs.mkdirSync('/tmp/shots', { recursive: true });

const login = async (u, p) => {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
  const j = await r.json();
  return { access: j.data?.accessToken ?? j.accessToken, refresh: j.data?.refreshToken ?? j.refreshToken };
};
const admin = await login('admin', 'Admin@123');
const uname = `nvtruc_ui_${Date.now().toString(36)}`;
await fetch(`${API}/users`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${admin.access}` },
  body: JSON.stringify({ username: uname, fullName: 'BS. Kiểm thử giao diện', password: 'Test@12345', title: 'Bác sĩ', roleCodes: ['NHAN_VIEN_TRUC'], mustChangePassword: false }),
});
const emp = await login(uname, 'Test@12345');

// Kỳ lịch tạm (60 ngày sau, không trùng kỳ khác) để mở hộp thoại xoá; được xoá lại ở cuối
const todayBkk = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const adminJson = { 'content-type': 'application/json', authorization: `Bearer ${admin.access}` };
const uiName = `Kỳ giao diện ${Date.now().toString(36).toUpperCase()}`;
const uiCreate = await fetch(`${API}/duty/periods`, {
  method: 'POST',
  headers: adminJson,
  body: JSON.stringify({ name: uiName, startDate: addDays(todayBkk, 60), endDate: addDays(todayBkk, 65), lockAt: new Date(Date.now() + 90 * 24 * 3600e3).toISOString(), autoGenerateSlots: true }),
});
const uiPeriod = (await uiCreate.json()).data;

const problems = [];
const expectations = [];
const open = async (ctx, tok, path, name, { wait = 1200 } = {}) => {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`[${name}] lỗi trang: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${name}] console: ${m.text().slice(0, 200)}`); });
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ a, r }) => { localStorage.setItem('qlbs_access_token', a); localStorage.setItem('qlbs_refresh_token', r); }, { a: tok.access, r: tok.refresh });
  await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => problems.push(`[${name}] tải trang: ${e.message}`));
  await page.waitForTimeout(wait);
  return page;
};

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const desk = { viewport: { width: 1440, height: 900 } };
const phone = { viewport: { width: 390, height: 844 } };

// 1) Ảnh các trang chính
for (const [vp, tok, path, name] of [
  [desk, admin, '/lich-truc', 'lich-admin'],
  [desk, admin, '/lich-truc/ky-lich', 'ky-lich'],
  [desk, emp, '/lich-truc/cua-toi', 'cua-toi'],
  [desk, admin, '/lich-truc/yeu-cau', 'yeu-cau'],
  [phone, emp, '/lich-truc', 'dien-thoai-lich'],
  [phone, emp, '/lich-truc/cua-toi', 'dien-thoai-cua-toi'],
]) {
  const ctx = await browser.newContext(vp);
  const page = await open(ctx, tok, path, name);
  await page.screenshot({ path: `/tmp/shots/${name}.png` });
  await ctx.close();
}

// 2) Quản trị xếp bác sĩ: bấm thẳng ca sáng/chiều mở danh sách bác sĩ, không qua hộp quản lý trung gian.
{
  const ctx = await browser.newContext(desk);
  const page = await open(ctx, admin, '/lich-truc', 'xep-truc-tiep', { wait: 1800 });
  await page.getByRole('button', { name: 'Để sau' }).click().catch(() => {});
  await page.getByRole('button', { name: 'Kỳ lịch khám' }).click();
  const periodSearch = page.getByPlaceholder('Ví dụ: tuần 42, 14/10, khám...');
  await periodSearch.fill(uiName);
  const periodFilterOk = await periodSearch.isVisible() && (await page.textContent('body')).includes('1 kỳ phù hợp');
  expectations.push(['bộ chọn kỳ có tìm kiếm và lọc được kỳ trong danh sách dài', periodFilterOk]);
  await page.keyboard.press('Escape');
  const roomPicker = page.getByRole('combobox', { name: 'Tìm và chọn phòng khám' });
  await roomPicker.click();
  const roomOptions = page.getByRole('option');
  expectations.push(['ô tìm phòng mở danh sách phòng để chọn', await roomOptions.count() > 1]);
  await roomOptions.nth(1).click();
  const selectedRoomOnly = (await page.textContent('body')).includes('1 phòng đang hiển thị');
  expectations.push(['chọn phòng thu hẹp lịch về đúng phòng đó', selectedRoomOnly]);
  const assignTiles = page.locator('button[title^="Xếp bác sĩ:"]');
  expectations.push(['lịch theo ngày hiển thị các ca có thể bấm xếp trực tiếp', await assignTiles.count() > 0]);
  await assignTiles.first().click().catch(() => {});
  await page.waitForTimeout(600);
  const body = await page.textContent('body');
  expectations.push(['bấm ca mở trực tiếp danh sách xếp bác sĩ', body.includes('Xếp bác sĩ khám') && body.includes('Chọn bác sĩ')]);
  expectations.push(['không còn bước “Quản lý người trực” trung gian', !body.includes('Quản lý người trực')]);
  await page.screenshot({ path: '/tmp/shots/xep-truc-tiep.png' });
  await page.keyboard.press('Escape');
  await ctx.close();
}

// 3) Điện thoại: bảng nhiều phòng vẫn cuộn dọc trong khung, không tạo thanh cuộn ngang.
{
  const ctx = await browser.newContext(phone);
  const page = await open(ctx, admin, '/lich-truc', 'dien-thoai-xep-truc', { wait: 1800 });
  await page.getByRole('button', { name: 'Để sau' }).click().catch(() => {});
  const metrics = await page.evaluate(() => ({ body: document.body.scrollWidth, root: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expectations.push(['bảng lịch khám nhiều phòng không tràn ngang trên điện thoại', metrics.body <= metrics.viewport && metrics.root <= metrics.viewport]);
  expectations.push(['điện thoại vẫn hiển thị ca bấm trực tiếp để xếp bác sĩ', await page.locator('button[title^="Xếp bác sĩ:"]').count() > 0]);
  await page.screenshot({ path: '/tmp/shots/dien-thoai-xep-truc.png' });
  await page.getByText('Chọn ngày xem lịch phòng khám', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/shots/dien-thoai-lich-phong.png' });
  await ctx.close();
}

// 4) Nhân viên thường không vào được Kỳ lịch và Danh mục (kể cả nhập URL trực tiếp)
for (const [path, name, text] of [
  ['/lich-truc/ky-lich', 'nv-ky-lich', 'Trang này dành cho người quản lý lịch khám'],
  ['/lich-truc/danh-muc', 'nv-danh-muc', 'Trang này dành cho người quản trị danh mục lịch khám'],
]) {
  const ctx = await browser.newContext(desk);
  const page = await open(ctx, emp, path, name);
  const body = await page.textContent('body');
  expectations.push([`nhân viên thường thấy thông báo chặn ở ${path}`, body.includes(text)]);
  expectations.push([`nhân viên thường không thấy tab Giờ trực ở ${path}`, !body.includes('Khối lượng khám') || !body.includes('Nhật ký')]);
  await page.screenshot({ path: `/tmp/shots/${name}.png` });
  await ctx.close();
}

// 3) Quản trị: bảng màu khi thêm ca trực; hộp thoại xoá cả kỳ lịch (không xác nhận xoá)
{
  const ctx = await browser.newContext(desk);
  const page = await open(ctx, admin, '/lich-truc/danh-muc', 'danh-muc');
  await page.getByText('Ca khám', { exact: true }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Thêm ca khám/ }).first().click();
  await page.waitForTimeout(600);
  const swatches = await page.getByRole('radio').count();
  expectations.push(['bảng màu ca có 12 ô màu để chọn', swatches === 12]);
  const grp = await page.getByRole('radiogroup').first().boundingBox();
  const edges = await page.getByRole('radio').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
  expectations.push(['bảng màu nằm gọn trong khung, không tràn', !!grp && edges.every((r) => r <= grp.x + grp.width + 1)]);
  await page.screenshot({ path: '/tmp/shots/danh-muc-ca-form.png' });
  await page.keyboard.press('Escape');
  await ctx.close();
}
{
  const ctx = await browser.newContext(desk);
  const page = await open(ctx, admin, '/lich-truc/ky-lich', 'ky-lich-xoa');
  await page.getByRole('button', { name: /Xoá kỳ khám/ }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  const body = await page.textContent('body');
  expectations.push(['hộp thoại xoá kỳ hiển thị cảnh báo và nút xác nhận', body.includes('Xác nhận xoá kỳ lịch khám') && body.includes('Xác nhận xoá')]);
  await page.screenshot({ path: '/tmp/shots/ky-lich-xoa.png' });
  await page.keyboard.press('Escape');
  await ctx.close();
}
await browser.close();
if (uiPeriod?.id) {
  await fetch(`${API}/duty/periods/${uiPeriod.id}/delete`, { method: 'POST', headers: adminJson, body: JSON.stringify({ reason: 'Dọn kỳ kiểm thử giao diện', confirmName: uiName }) });
}

const bad = expectations.filter(([, ok]) => !ok);
for (const [label, ok] of expectations) console.log(ok ? '  ✔' : '  ✘', label);
if (problems.length) console.log(problems.join('\n'));
else console.log('KHÔNG CÓ LỖI CONSOLE — đã chụp ảnh các trang lịch khám');
console.log(bad.length ? `\nCó ${bad.length} kiểm tra giao diện không đạt` : '\nTất cả kiểm tra giao diện đạt');
process.exit(bad.length || problems.length ? 1 : 0);
