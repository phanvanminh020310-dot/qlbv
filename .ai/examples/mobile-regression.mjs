// Hồi quy mobile QLBS: iPhone Safari (mô phỏng UA/viewport) và Android Chrome.
// Chạy: PW_MODULE=/tmp/pw/node_modules/playwright/index.mjs node .ai/examples/mobile-regression.mjs
// Cần API/Web cục bộ và admin / Admin@123. Tạo kỳ lịch UI tạm rồi luôn xoá ở finally.
const { chromium } = await import(process.env.PW_MODULE ?? 'playwright');

const WEB = process.env.WEB ?? 'http://localhost:3000';
const API = process.env.API ?? 'http://localhost:4000/api';
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

const results = [];
const errors = [];
const check = (label, ok) => results.push([label, Boolean(ok)]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function login(username, password) {
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json = await response.json();
  return { access: json.data?.accessToken ?? json.accessToken, refresh: json.data?.refreshToken ?? json.refreshToken };
}

const addDays = (ymd, days) => {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const measure = (page) => page.evaluate(() => ({
  body: document.body.scrollWidth,
  root: document.documentElement.scrollWidth,
  viewport: window.innerWidth,
  visualHeight: Math.round(window.visualViewport?.height ?? window.innerHeight),
  cssHeight: getComputedStyle(document.documentElement).getPropertyValue('--qlbs-viewport-height').trim(),
  ios: document.documentElement.classList.contains('ios-visual-viewport'),
}));

async function noHorizontalOverflow(page, label) {
  const m = await measure(page);
  check(`${label}: không tràn ngang`, m.body <= m.viewport && m.root <= m.viewport);
  return m;
}

async function dismissPwa(page) {
  await page.getByRole('button', { name: 'Để sau' }).click().catch(() => {});
}

async function openAuthed(browser, profile, auth, route, name) {
  const context = await browser.newContext(profile);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`[${name}] pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`[${name}] console: ${message.text().slice(0, 240)}`);
  });
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ access, refresh }) => {
    localStorage.setItem('qlbs_access_token', access);
    localStorage.setItem('qlbs_refresh_token', refresh);
  }, auth);
  await page.goto(`${WEB}${route}`, { waitUntil: 'networkidle', timeout: 60000 });
  await sleep(900);
  return { context, page };
}

async function inspectDevice(browser, name, profile, auth, isIos) {
  // Login: iOS marker, visual viewport variable, and no Safari auto-zoom font size regression.
  {
    const context = await browser.newContext(profile);
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`[${name}: login] pageerror: ${error.message}`));
    await page.goto(`${WEB}/login`, { waitUntil: 'networkidle', timeout: 60000 });
    await sleep(500);
    const m = await noHorizontalOverflow(page, `${name} login`);
    if (isIos) {
      check(`${name}: bật iOS visual viewport stabilizer`, m.ios && m.cssHeight === `${m.visualHeight}px`);
      const loginFont = await page.locator('input').first().evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
      check(`${name}: input đăng nhập từ 16px, không kích hoạt Safari zoom`, loginFont >= 16);
    } else {
      check(`${name}: không áp dụng iOS-only marker`, !m.ios);
    }
    await context.close();
  }

  // Authenticated shell, drawer and administration route must remain inside the mobile viewport.
  for (const route of ['/dashboard', '/lich-truc/ky-lich', '/quan-tri/nguoi-dung']) {
    const { context, page } = await openAuthed(browser, profile, auth, route, `${name} ${route}`);
    await noHorizontalOverflow(page, `${name} ${route}`);
    if (route === '/dashboard') {
      await page.getByRole('button', { name: 'Mở menu' }).click();
      await sleep(180);
      const drawer = await page.locator('.app-viewport-fixed').first().evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return { height: Math.round(rect.height), visual: Math.round(window.visualViewport?.height ?? window.innerHeight) };
      });
      check(`${name}: ngăn menu có chiều cao đúng visual viewport`, drawer.height === drawer.visual);
      await page.keyboard.press('Escape').catch(() => {});
    }
    await context.close();
  }

  // New clinic schedule UI: choose room, direct assignment, and modal frame.
  {
    const { context, page } = await openAuthed(browser, profile, auth, '/lich-truc', `${name} lịch khám`);
    await dismissPwa(page);
    await noHorizontalOverflow(page, `${name} lịch khám nhiều phòng`);

    const roomPicker = page.getByRole('combobox', { name: 'Tìm và chọn phòng khám' });
    const roomFont = await roomPicker.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
    check(`${name}: ô tìm phòng dễ đọc`, isIos ? roomFont >= 16 : roomFont >= 14);
    await roomPicker.click();
    check(`${name}: tìm phòng hiện danh sách để chọn`, await page.getByRole('option').count() > 1);
    await page.getByRole('option').nth(1).click();
    check(`${name}: chọn phòng chỉ hiển thị đúng phòng`, (await page.textContent('body')).includes('1 phòng đang hiển thị'));

    const slot = page.locator('button[title^="Xếp bác sĩ:"]').first();
    check(`${name}: ca sáng/chiều bấm xếp trực tiếp`, await slot.count() === 1);
    await slot.click();
    await sleep(300);
    const dialog = page.getByRole('dialog');
    check(`${name}: mở thẳng hộp xếp bác sĩ`, await dialog.count() === 1 && (await dialog.textContent()).includes('Chọn bác sĩ'));
    const dialogBox = await dialog.boundingBox();
    const visual = await page.evaluate(() => ({ width: window.innerWidth, height: window.visualViewport?.height ?? window.innerHeight, scale: window.visualViewport?.scale ?? 1 }));
    check(`${name}: dialog nằm gọn trong màn hình`, !!dialogBox && dialogBox.x >= 0 && dialogBox.y >= 0 && dialogBox.x + dialogBox.width <= visual.width + 1 && dialogBox.y + dialogBox.height <= visual.height + 1);
    check(`${name}: visual viewport scale giữ 1`, visual.scale === 1);

    if (isIos) {
      const candidateFont = await page.getByPlaceholder('Tìm bác sĩ...').evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
      check(`${name}: ô tìm bác sĩ trong dialog từ 16px`, candidateFont >= 16);
      await page.setViewportSize({ width: 844, height: 390 });
      await sleep(220);
      const m = await noHorizontalOverflow(page, `${name} landscape dialog`);
      const overlayHeight = await page.locator('.app-viewport-fixed').first().evaluate((node) => Math.round(node.getBoundingClientRect().height));
      check(`${name}: xoay ngang vẫn đồng bộ visual viewport`, m.cssHeight === `${m.visualHeight}px` && overlayHeight === m.visualHeight);
    }
    await page.screenshot({ path: `/tmp/shots/mobile-${isIos ? 'ios' : 'android'}-schedule.png` });
    await context.close();
  }

  // Public Kiosk layout: verify public full-screen page was not affected by shell changes.
  {
    const context = await browser.newContext(profile);
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`[${name}: kiosk] pageerror: ${error.message}`));
    await page.goto(`${WEB}/kiosk/P1`, { waitUntil: 'networkidle', timeout: 60000 });
    await sleep(700);
    await noHorizontalOverflow(page, `${name} Kiosk công khai`);
    await context.close();
  }
}

let temporaryPeriod;
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const admin = await login('admin', 'Admin@123');
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const name = `Kỳ mobile ${Date.now().toString(36).toUpperCase()}`;
  const create = await fetch(`${API}/duty/periods`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${admin.access}` },
    body: JSON.stringify({
      name,
      startDate: addDays(today, 60),
      endDate: addDays(today, 65),
      lockAt: new Date(Date.now() + 90 * 86400_000).toISOString(),
      autoGenerateSlots: true,
    }),
  });
  temporaryPeriod = (await create.json()).data;
  if (!temporaryPeriod?.id) throw new Error('Không tạo được kỳ dữ liệu tạm để kiểm thử mobile');

  await inspectDevice(browser, 'iPhone 390×844', {
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IOS_UA,
  }, admin, true);
  await inspectDevice(browser, 'Android 412×915', {
    viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: ANDROID_UA,
  }, admin, false);
} finally {
  await browser.close();
  if (temporaryPeriod?.id) {
    const admin = await login('admin', 'Admin@123');
    await fetch(`${API}/duty/periods/${temporaryPeriod.id}/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${admin.access}` },
      body: JSON.stringify({ reason: 'Dọn dữ liệu kiểm thử mobile', confirmName: temporaryPeriod.name }),
    });
  }
}

for (const [label, ok] of results) console.log(ok ? '  ✔' : '  ✘', label);
if (errors.length) console.log(errors.join('\n'));
const failed = results.filter(([, ok]) => !ok);
console.log(failed.length || errors.length ? `\nKhông đạt: ${failed.length} kiểm tra, ${errors.length} lỗi browser` : `\nĐạt ${results.length} kiểm tra mobile; không có browser error`);
process.exit(failed.length || errors.length ? 1 : 0);
