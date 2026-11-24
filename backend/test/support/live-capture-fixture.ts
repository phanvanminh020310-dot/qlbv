import { randomBytes } from "node:crypto";
import type { KioskService } from "../../src/modules/kiosk/kiosk.service";

/** JPEG tối thiểu hợp lệ về cấu trúc (SOI…EOI) với nội dung khác nhau như nhiễu cảm biến camera. */
export function fakeJpegDataUrl(size = 4096): string {
  const body = randomBytes(size);
  body[0] = 0xff; body[1] = 0xd8;
  body[size - 2] = 0xff; body[size - 1] = 0xd9;
  return `data:image/jpeg;base64,${body.toString("base64")}`;
}

/** Bằng chứng ba khung hình camera trực tiếp gắn nonce của đúng phiên QR. */
export function liveCaptureProof(nonce: string, overrides: Record<string, unknown> = {}) {
  const start = 1_000_000;
  return {
    mode: "LIVE_CAMERA_STREAM",
    nonce,
    frames: [fakeJpegDataUrl(), fakeJpegDataUrl(), fakeJpegDataUrl()],
    frameTimestamps: [start, start + 400, start + 800],
    videoWidth: 640,
    videoHeight: 480,
    ...overrides,
  };
}

export function liveCaptureFor(service: KioskService, sessionId: string) {
  const session = service.getSession(sessionId);
  if (!session) throw new Error(`fixture: no session ${sessionId}`);
  return liveCaptureProof(session.liveCaptureNonce);
}
