import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { KIOSK_SCAN_MESSAGES } from "./kiosk-scan-messages";

/**
 * Bằng chứng khung hình lấy trực tiếp từ luồng camera trước (getUserMedia).
 *
 * Trang quét QR không còn chế độ chọn/chụp ảnh tải lên. Máy chủ chỉ nhận một
 * chuỗi nhiều khung hình liên tiếp do chính trang quét lấy từ video trực tiếp,
 * gắn với nonce ngẫu nhiên chỉ cấp cho phiên QR đã được quét. Một ảnh tĩnh tải
 * lên (hoặc cùng một ảnh lặp lại) cho ra các khung giống hệt nhau và bị từ chối
 * trước khi gọi AI, đối chiếu khuôn mặt hay mở máy.
 */
export const LIVE_CAPTURE_MODE = "LIVE_CAMERA_STREAM" as const;
export const LIVE_CAPTURE_MIN_FRAMES = 3;
export const LIVE_CAPTURE_MAX_FRAMES = 5;
export const LIVE_CAPTURE_MIN_SPAN_MS = 250;
export const LIVE_CAPTURE_MAX_SPAN_MS = 15_000;
const MIN_FRAME_BYTES = 1_024;
const MAX_FRAME_BYTES = 600 * 1024;

/** Thông báo ngắn gọn cho người dùng; chi tiết lý do không gửi ra ngoài. */
export const LIVE_CAPTURE_REQUIRED_MESSAGE = KIOSK_SCAN_MESSAGES.CAMERA_REQUIRED;

export interface LiveCaptureProof {
  mode?: unknown;
  nonce?: unknown;
  frames?: unknown;
  frameTimestamps?: unknown;
  videoWidth?: unknown;
  videoHeight?: unknown;
}

export type LiveCaptureResult =
  | { ok: true; primaryFrame: string }
  | { ok: false; reason: string };

export function createLiveCaptureNonce(): string {
  return randomBytes(24).toString("base64url");
}

function sameNonce(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function decodeJpegFrame(frame: unknown): Buffer | null {
  if (typeof frame !== "string") return null;
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(frame);
  if (!match) return null;
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length < MIN_FRAME_BYTES || bytes.length > MAX_FRAME_BYTES) return null;
  // JPEG SOI (FFD8) đầu tệp và EOI (FFD9) cuối tệp do canvas.toDataURL tạo ra.
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
  return bytes;
}

/** Kiểm tra cấu trúc bằng chứng camera trực tiếp; không gọi AI, không thay đổi phiên. */
export function validateLiveCaptureProof(
  proof: LiveCaptureProof | null | undefined,
  expectedNonce: string | undefined,
): LiveCaptureResult {
  const fail = (reason: string): LiveCaptureResult => ({ ok: false, reason });
  if (!proof || typeof proof !== "object") return fail("missing-proof");
  if (proof.mode !== LIVE_CAPTURE_MODE) return fail("not-live-camera");
  if (
    !expectedNonce ||
    typeof proof.nonce !== "string" ||
    !sameNonce(proof.nonce, expectedNonce)
  ) {
    return fail("nonce-mismatch");
  }
  const width = Number(proof.videoWidth);
  const height = Number(proof.videoHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 64 || height < 64) {
    return fail("no-video-dimensions");
  }

  const frames = proof.frames;
  if (
    !Array.isArray(frames) ||
    frames.length < LIVE_CAPTURE_MIN_FRAMES ||
    frames.length > LIVE_CAPTURE_MAX_FRAMES
  ) {
    return fail("frame-count");
  }
  const times = proof.frameTimestamps;
  if (!Array.isArray(times) || times.length !== frames.length) return fail("timestamps");
  for (let i = 0; i < times.length; i++) {
    if (typeof times[i] !== "number" || !Number.isFinite(times[i])) return fail("timestamps");
    if (i > 0 && times[i] <= times[i - 1]) return fail("timestamps");
  }
  const span = times[times.length - 1] - times[0];
  if (span < LIVE_CAPTURE_MIN_SPAN_MS || span > LIVE_CAPTURE_MAX_SPAN_MS) return fail("timestamps");

  const hashes = new Set<string>();
  for (const frame of frames) {
    const bytes = decodeJpegFrame(frame);
    if (!bytes) return fail("invalid-frame");
    hashes.add(createHash("sha256").update(bytes).digest("hex"));
  }
  // Cảm biến camera thật luôn có nhiễu giữa các khung liên tiếp; ảnh tĩnh thì không.
  if (hashes.size !== frames.length) return fail("static-image");

  return { ok: true, primaryFrame: frames[frames.length - 1] as string };
}
