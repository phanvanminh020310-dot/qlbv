/**
 * Xác thực khuôn mặt qua QR chỉ bằng camera trực tiếp: máy chủ từ chối mọi ảnh
 * chụp sẵn / tải lên trước khi gọi AI, đối chiếu khuôn mặt hoặc mở máy trạm.
 */
import "reflect-metadata";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { KioskService } from "../src/modules/kiosk/kiosk.service";
import { KioskController } from "../src/modules/kiosk/kiosk.controller";
import {
  LIVE_CAPTURE_REQUIRED_MESSAGE,
  validateLiveCaptureProof,
} from "../src/modules/kiosk/kiosk-live-capture";
import { fakeJpegDataUrl, liveCaptureFor, liveCaptureProof } from "./support/live-capture-fixture";
import {
  buildLiveCaptureProof,
  liveFramesReady,
  pushLiveFrame,
} from "../../frontend/src/lib/live-camera";

const TOKEN = "dev_0123456789abcdef0123456789abcdef";
const NONCE = "nonce_for_this_qr_session_only_123456";

function serviceFor(t: TestContext) {
  const query: any = {};
  for (const method of ["from", "where", "limit", "orderBy", "innerJoin"]) query[method] = () => query;
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve([]).then(resolve);
  const service = new KioskService(
    { db: { select: () => query, insert: () => ({ values: async () => undefined }), update: () => ({ set: () => ({ where: async () => [] }) }) } } as any,
    { async onDuty() { return { onDuty: [] }; } } as any,
    { get: async () => null } as any,
    { async log() {} } as any,
  );
  service.loadActiveRoster = async () => [];
  t.after(() => service.onModuleDestroy());
  return service;
}

async function scannedSession(service: KioskService) {
  const session = service.createQrSession("PK01", "Phòng khám 01", "terminal_a", "https://hospital.test", undefined, "https", 15);
  const scan = await service.touchSessionScan(session.sessionId, { claimToken: TOKEN });
  assert.equal(scan.error, undefined);
  return session;
}

test("bằng chứng camera trực tiếp hợp lệ trả về khung cuối làm ảnh xác thực", () => {
  const proof = liveCaptureProof(NONCE);
  const result = validateLiveCaptureProof(proof, NONCE);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.primaryFrame, proof.frames[2]);
});

test("từ chối ảnh tải lên, ảnh tĩnh lặp lại, sai nonce, sai định dạng và chuỗi thời gian giả", () => {
  const still = fakeJpegDataUrl();
  const png = `data:image/png;base64,${Buffer.alloc(4096, 1).toString("base64")}`;
  const cases: Array<[string, unknown, string | undefined]> = [
    ["không có bằng chứng", undefined, NONCE],
    ["chế độ ảnh tải lên", liveCaptureProof(NONCE, { mode: "FILE_UPLOAD" }), NONCE],
    ["nonce của phiên khác", liveCaptureProof("other_session_nonce_value_1234567"), NONCE],
    ["phiên chưa có nonce", liveCaptureProof(NONCE), undefined],
    ["một ảnh tĩnh gửi lại ba lần", liveCaptureProof(NONCE, { frames: [still, still, still] }), NONCE],
    ["chỉ một ảnh", liveCaptureProof(NONCE, { frames: [still], frameTimestamps: [1] }), NONCE],
    ["ảnh PNG từ thư viện", liveCaptureProof(NONCE, { frames: [png, fakeJpegDataUrl(), fakeJpegDataUrl()] }), NONCE],
    ["chuỗi base64 không phải JPEG", liveCaptureProof(NONCE, { frames: ["fixture-only", fakeJpegDataUrl(), fakeJpegDataUrl()] }), NONCE],
    ["khung quá lớn", liveCaptureProof(NONCE, { frames: [fakeJpegDataUrl(700 * 1024), fakeJpegDataUrl(), fakeJpegDataUrl()] }), NONCE],
    ["thời gian không tăng", liveCaptureProof(NONCE, { frameTimestamps: [10, 10, 900] }), NONCE],
    ["chụp dồn trong 20ms", liveCaptureProof(NONCE, { frameTimestamps: [10, 20, 30] }), NONCE],
    ["không có kích thước video", liveCaptureProof(NONCE, { videoWidth: 0, videoHeight: 0 }), NONCE],
  ];
  for (const [name, proof, nonce] of cases) {
    assert.equal(validateLiveCaptureProof(proof as any, nonce).ok, false, name);
  }
});

test("verify-face không có camera trực tiếp bị từ chối trước AI, không cháy phiên QR", async (t) => {
  const service = serviceFor(t);
  const session = await scannedSession(service);
  let aiCalls = 0;
  service.verifyAndExtractAi = async () => { aiCalls++; return { isLive: true, embedding: [1] }; };

  for (const attempt of [
    { snapshotBase64: fakeJpegDataUrl() },
    { snapshotBase64: fakeJpegDataUrl(), liveCapture: liveCaptureProof(NONCE) as any },
    { snapshotBase64: "", liveCapture: liveCaptureProof(session.liveCaptureNonce, { mode: "FILE_UPLOAD" }) as any },
  ]) {
    await assert.rejects(
      service.verifyFaceAndUnlock({ sessionId: session.sessionId, claimToken: TOKEN, ...attempt }),
      (error: any) => error?.message === LIVE_CAPTURE_REQUIRED_MESSAGE,
    );
  }
  assert.equal(aiCalls, 0, "không gửi ảnh tải lên sang AI");
  assert.equal(session.status, "WAITING");
  assert.equal(session.consumed, false);
  assert.equal(session.failCount ?? 0, 0);
  // Thông báo phải là lỗi dứt khoát, không rơi vào nhóm "quét lại" tự động của trang quét.
  assert.doesNotMatch(LIVE_CAPTURE_REQUIRED_MESSAGE, /Không phát hiện|khuôn mặt|mờ|chưa rõ|xử lý|giữ nguyên máy/);
});

test("khung hình camera trực tiếp được chuyển tới AI; snapshotBase64 tùy ý bị bỏ qua", async (t) => {
  const service = serviceFor(t);
  const session = await scannedSession(service);
  const proof = liveCaptureFor(service, session.sessionId);
  let analysed = "";
  service.verifyAndExtractAi = async (image: string) => { analysed = image; return { isLive: false, reason: "fixture", embedding: [] }; };
  await assert.rejects(
    service.verifyFaceAndUnlock({ sessionId: session.sessionId, claimToken: TOKEN, snapshotBase64: "uploaded-photo", liveCapture: proof as any }),
    /Xác thực không thành công\.$/,
  );
  assert.equal(analysed, proof.frames[2], "AI nhận đúng khung camera trực tiếp cuối cùng");
});

test("mỗi phiên QR có nonce riêng, chỉ trả cho trang quét sau khi nhận phiên hợp lệ", async (t) => {
  const service = serviceFor(t);
  const a = service.createQrSession("PK01", "Phòng khám 01", "terminal_a", "https://hospital.test", undefined, "https", 15);
  const b = service.createQrSession("PK02", "Phòng khám 02", "terminal_b", "https://hospital.test", undefined, "https", 15);
  assert.ok(a.liveCaptureNonce.length >= 24);
  assert.notEqual(a.liveCaptureNonce, b.liveCaptureNonce);

  const controller = new KioskController(service);
  const info = await controller.getSessionInfo(a.sessionId, TOKEN, undefined, { headers: {} });
  assert.equal((info as any).liveCaptureNonce, a.liveCaptureNonce);
  await assert.rejects(controller.getSessionInfo(a.sessionId, undefined, undefined, { headers: {} }));
});

test("controller không còn nhận imageBase64/snapshotBase64 làm ảnh xác thực", async (t) => {
  const service = serviceFor(t);
  const session = await scannedSession(service);
  let aiCalls = 0;
  service.verifyAndExtractAi = async () => { aiCalls++; return { isLive: true, embedding: [1] }; };
  const controller = new KioskController(service);
  await assert.rejects(
    controller.verifyFace({ sessionId: session.sessionId, imageBase64: fakeJpegDataUrl(), claimToken: TOKEN }, undefined, undefined, { headers: {} }),
    (error: any) => error?.message === LIVE_CAPTURE_REQUIRED_MESSAGE,
  );
  assert.equal(aiCalls, 0);
});

test("bằng chứng do trang quét tạo ra được máy chủ chấp nhận (hợp đồng frontend ↔ backend)", () => {
  let buffer = pushLiveFrame([], { dataUrl: fakeJpegDataUrl(), at: 1_000 });
  buffer = pushLiveFrame(buffer, { dataUrl: fakeJpegDataUrl(), at: 1_400 });
  assert.equal(liveFramesReady(buffer), false);
  buffer = pushLiveFrame(buffer, { dataUrl: fakeJpegDataUrl(), at: 1_800 });
  assert.equal(liveFramesReady(buffer), true);
  const proof = buildLiveCaptureProof(buffer, NONCE, { videoWidth: 640, videoHeight: 480 });
  assert.equal(validateLiveCaptureProof(proof, NONCE).ok, true);
});
