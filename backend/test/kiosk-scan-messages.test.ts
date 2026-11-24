/**
 * Thông báo trên trang quét QR điện thoại phải ngắn gọn và không lộ từ nhạy cảm
 * (độ tương đồng, độ tin cậy, chống giả mạo, AI/ArcFace/PAD/ISO, CSDL, địa chỉ dịch vụ...).
 */
import "reflect-metadata";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { KioskService } from "../src/modules/kiosk/kiosk.service";
import { KioskController } from "../src/modules/kiosk/kiosk.controller";
import { KIOSK_SCAN_MESSAGES, SENSITIVE_SCAN_TERMS } from "../src/modules/kiosk/kiosk-scan-messages";
import {
  SCAN_MESSAGES,
  isTransientScanMessage,
  needsNewQr,
  scanMessageTitle,
  toScanMessage,
} from "../../frontend/src/lib/scan-messages";
import { liveCaptureFor } from "./support/live-capture-fixture";

const TOKEN = "dev_0123456789abcdef0123456789abcdef";
const M = KIOSK_SCAN_MESSAGES;

function assertSafe(message: string, context: string) {
  for (const term of SENSITIVE_SCAN_TERMS) assert.doesNotMatch(message, term, `${context}: "${message}"`);
}

function serviceFor(t: TestContext) {
  const rows: any[] = [];
  const query: any = {};
  for (const method of ["from", "where", "limit", "orderBy", "innerJoin"]) query[method] = () => query;
  query.then = (resolveRows: (value: unknown) => unknown) => Promise.resolve(rows).then(resolveRows);
  const service = new KioskService(
    { db: { select: () => query, insert: () => ({ values: async () => undefined }), update: () => ({ set: () => ({ where: async () => [] }) }) } } as any,
    { async onDuty() { return { onDuty: [] }; } } as any,
    { get: async () => null } as any,
    { async log() {} } as any,
  );
  service.loadActiveRoster = async () => [];
  t.after(() => service.onModuleDestroy());
  return { service, rows };
}

async function scanned(service: KioskService) {
  const session = service.createQrSession("PK01", "Phòng khám 01", "terminal_a", "https://hospital.test", undefined, "https", 15);
  await service.touchSessionScan(session.sessionId, { claimToken: TOKEN });
  return session;
}

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error: any) {
    return String(error?.message);
  }
  assert.fail("phải bị từ chối");
}

test("danh sách thông báo backend và trang quét trùng khớp, tất cả đều ngắn và an toàn", () => {
  assert.deepEqual(SCAN_MESSAGES, KIOSK_SCAN_MESSAGES);
  for (const [key, message] of Object.entries(KIOSK_SCAN_MESSAGES)) {
    assertSafe(message, key);
    assert.ok(message.length <= 60, `${key} quá dài`);
  }
});

test("các tình huống quét trả đúng một câu ngắn, không lộ lý do kỹ thuật", async (t) => {
  const { service, rows } = serviceFor(t);
  const run = async (session: any) =>
    rejectionMessage(service.verifyFaceAndUnlock({ sessionId: session.sessionId, claimToken: TOKEN, liveCapture: liveCaptureFor(service, session.sessionId) as any }));

  // Liveness từ chối (ảnh giả) → chỉ "Xác thực không thành công."
  service.verifyAndExtractAi = async () => ({ isLive: false, reason: "spoof score 0.12 — ISO 30107 PAD", embedding: [] });
  assert.equal(await run(await scanned(service)), M.VERIFY_FAILED);

  // AI chưa thấy rõ mặt → câu nhắc tạm thời, trang tự quét tiếp.
  service.verifyAndExtractAi = async () => { throw new Error("Không phát hiện khuôn mặt trong ảnh (score 0.2)"); };
  assert.equal(await run(await scanned(service)), M.LOOK_AT_CAMERA);

  // Mất kết nối dịch vụ AI → không lộ địa chỉ máy chủ.
  service.verifyAndExtractAi = async () => { throw new Error("Không thể kết nối đến máy chủ AI thẩm định người thật (http://ai:8000)."); };
  assert.equal(await run(await scanned(service)), M.SERVICE_BUSY);

  // Chưa có hồ sơ khuôn mặt nào → vẫn chỉ là "Xác thực không thành công."
  service.verifyAndExtractAi = async () => ({ isLive: true, embedding: [1, 0, 0] });
  assert.equal(await run(await scanned(service)), M.VERIFY_FAILED);

  // Không khớp hồ sơ → không lộ độ tương đồng.
  rows.push({ id: 1, userId: 7, faceDescriptor: (service as any).encryptDescriptor([0, 1, 0]), username: "bs7", fullName: "Bác sĩ Bảy", title: "BS." });
  assert.equal(await run(await scanned(service)), M.VERIFY_FAILED);

  // Khớp nhưng không có ca trực → không nêu tên/độ tương đồng.
  rows[0].faceDescriptor = (service as any).encryptDescriptor([1, 0, 0]);
  assert.equal(await run(await scanned(service)), M.NO_SHIFT);

  // Mã QR đã bị khoá sau nhiều lần thất bại → "đã được sử dụng".
  const burned = await scanned(service);
  burned.consumed = true;
  assert.equal(await run(burned), M.QR_USED);

  // Mã QR hết hạn.
  const expired = await scanned(service);
  expired.expiresAt = Date.now() - 1;
  assert.equal(await run(expired), M.QR_EXPIRED);

  // Không có claim token → yêu cầu quét lại.
  const session = await scanned(service);
  assert.equal(
    await rejectionMessage(service.verifyFaceAndUnlock({ sessionId: session.sessionId, liveCapture: liveCaptureFor(service, session.sessionId) as any })),
    M.RESCAN,
  );
});

test("mở trang bằng mã QR hết hạn chỉ báo \"Mã QR đã hết hạn\"", async (t) => {
  const { service } = serviceFor(t);
  const controller = new KioskController(service);
  const session = await scanned(service);
  session.expiresAt = Date.now() - 1;
  assert.equal(await rejectionMessage(controller.getSessionInfo(session.sessionId, TOKEN, undefined, { headers: {} })), M.QR_EXPIRED);
  assert.equal(await rejectionMessage(controller.getSessionInfo("khong-ton-tai", TOKEN, undefined, { headers: {} })), M.QR_EXPIRED);
});

test("phiên đã xác thực trả \"Điểm danh thành công.\" và không kèm chỉ số độ tương đồng", async (t) => {
  const { service } = serviceFor(t);
  const session = await scanned(service);
  session.status = "VERIFIED";
  session.verifiedDoctor = { fullName: "Bác sĩ Bảy", title: "BS.", shiftName: "Sáng" };
  const reply: any = await service.verifyFaceAndUnlock({ sessionId: session.sessionId, claimToken: TOKEN });
  assert.equal(reply.success, true);
  assert.equal(reply.message, M.SUCCESS);
  assert.equal("similarity" in reply, false);
});

test("trang quét quy mọi thông báo máy chủ (kể cả bản cũ chi tiết) về câu ngắn an toàn", () => {
  const legacy: Array<[string, string]> = [
    ["Khuôn mặt không khớp với hồ sơ Bác sĩ nào trong CSDL bệnh viện (Độ tương đồng: 41.2%).", SCAN_MESSAGES.VERIFY_FAILED],
    ["AI từ chối: Phát hiện hình ảnh giả mạo (spoof).", SCAN_MESSAGES.VERIFY_FAILED],
    ["Bác sĩ BS. A nhận diện thành công (88.0%), nhưng KHÔNG CÓ LỊCH TRỰC hôm nay tại P1!", SCAN_MESSAGES.NO_SHIFT],
    ["Hiện tại không trong khung giờ ca trực của Bác sĩ BS. A tại P1.", SCAN_MESSAGES.NO_SHIFT],
    ["Phiên quét QR đã quá thời gian cho phép. Vui lòng quét lại trên màn hình phòng khám.", SCAN_MESSAGES.QR_EXPIRED],
    ["Mã QR đã hết hạn hoặc phiên không tồn tại. Vui lòng quét lại trên màn hình phòng khám.", SCAN_MESSAGES.QR_EXPIRED],
    ["Mã QR này đã được tiếp nhận xác thực trước đó (Burn-on-scan). Vui lòng nhìn lên màn hình phòng khám để quét mã mới!", SCAN_MESSAGES.QR_USED],
    ["Không xác định được phiên quét trên điện thoại. Vui lòng quét lại mã QR đang hiển thị tại phòng khám.", SCAN_MESSAGES.RESCAN],
    ["Không thể kết nối đến máy chủ AI thẩm định người thật (http://ai:8000).", SCAN_MESSAGES.SERVICE_BUSY],
    ["Internal server error", SCAN_MESSAGES.VERIFY_FAILED],
    ["", SCAN_MESSAGES.VERIFY_FAILED],
  ];
  for (const [raw, expected] of legacy) {
    const shown = toScanMessage(raw);
    assert.equal(shown, expected, raw);
    assertSafe(shown, raw);
  }
  for (const message of Object.values(SCAN_MESSAGES)) assert.equal(toScanMessage(message), message);
  assert.equal(toScanMessage(undefined), SCAN_MESSAGES.VERIFY_FAILED);
  assert.equal(toScanMessage({ message: "x" }), SCAN_MESSAGES.VERIFY_FAILED);

  assert.equal(isTransientScanMessage(SCAN_MESSAGES.LOOK_AT_CAMERA), true);
  assert.equal(isTransientScanMessage(SCAN_MESSAGES.PROCESSING), true);
  assert.equal(isTransientScanMessage(SCAN_MESSAGES.VERIFY_FAILED), false);
  assert.equal(isTransientScanMessage(SCAN_MESSAGES.NO_SHIFT), false);
  assert.equal(needsNewQr(SCAN_MESSAGES.QR_EXPIRED), true);
  assert.equal(needsNewQr(SCAN_MESSAGES.VERIFY_FAILED), false);
  assert.equal(scanMessageTitle(SCAN_MESSAGES.QR_EXPIRED), "Mã QR đã hết hạn");
  assert.equal(scanMessageTitle(SCAN_MESSAGES.VERIFY_FAILED), "Xác thực không thành công");
  assert.equal(scanMessageTitle(SCAN_MESSAGES.SUCCESS), "Điểm danh thành công");
});

test("trang quét không còn chữ nhạy cảm và không hiển thị nguyên văn lỗi máy chủ", () => {
  const page = readFileSync(resolve(__dirname, "../../frontend/src/app/scan/[sessionId]/page.tsx"), "utf8");
  for (const term of [/ArcFace/, /Bio-PAD/, /\bPAD\b/, /ISO 30107/, /tin cậy/i, /tương đồng/i, /similarity/, /giả mạo/i, /sinh trắc/i, /sinh học/i, /CSDL/]) {
    assert.doesNotMatch(page, term, `trang quét còn ${term}`);
  }
  assert.doesNotMatch(page, /setErrorMessage\((msg \|\||data\?\.message|err)/, "không được hiện nguyên văn message máy chủ");
  assert.doesNotMatch(page, /setSessionError\(err\.message/);
  assert.match(page, /toScanMessage/);
});
