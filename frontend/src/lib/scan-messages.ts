/**
 * Thông báo hiển thị trên trang quét QR điện thoại: ngắn gọn, dễ hiểu, không lộ
 * chi tiết kỹ thuật (độ tương đồng, mô hình AI, chống giả mạo, CSDL...).
 * Phải trùng với backend/src/modules/kiosk/kiosk-scan-messages.ts (có test so khớp).
 */
export const SCAN_MESSAGES = {
  SUCCESS: "Điểm danh thành công.",
  QR_EXPIRED: "Mã QR đã hết hạn. Vui lòng quét mã mới.",
  QR_USED: "Mã QR đã được sử dụng. Vui lòng quét mã mới.",
  RESCAN: "Vui lòng quét lại mã QR.",
  VERIFY_FAILED: "Xác thực không thành công.",
  NO_SHIFT: "Bạn không có ca trực tại phòng khám này.",
  LOOK_AT_CAMERA: "Vui lòng nhìn thẳng vào camera.",
  PROCESSING: "Đang xác thực, vui lòng giữ nguyên.",
  CAMERA_REQUIRED: "Vui lòng xác thực bằng camera trước.",
  SERVICE_BUSY: "Hệ thống đang bận. Vui lòng thử lại.",
} as const;

export type ScanMessage = (typeof SCAN_MESSAGES)[keyof typeof SCAN_MESSAGES];

const KNOWN = new Set<string>(Object.values(SCAN_MESSAGES));
const SOFT = new Set<string>([SCAN_MESSAGES.LOOK_AT_CAMERA, SCAN_MESSAGES.PROCESSING, SCAN_MESSAGES.SERVICE_BUSY]);

/**
 * Chuyển mọi thông báo máy chủ (kể cả bản cũ, chi tiết) về một câu ngắn an toàn.
 * Không bao giờ trả lại nguyên văn chuỗi lạ từ máy chủ.
 */
export function toScanMessage(raw: unknown): ScanMessage {
  const message = typeof raw === "string" ? raw.trim() : "";
  if (KNOWN.has(message)) return message as ScanMessage;
  if (/đã được (sử dụng|tiếp nhận)|Burn-on-scan/i.test(message)) return SCAN_MESSAGES.QR_USED;
  if (/hết hạn|quá thời gian|không tồn tại/i.test(message)) return SCAN_MESSAGES.QR_EXPIRED;
  if (/lịch trực|ca trực/i.test(message)) return SCAN_MESSAGES.NO_SHIFT;
  if (/quét lại mã QR|thiết bị quét|phiên quét trên điện thoại/i.test(message)) return SCAN_MESSAGES.RESCAN;
  if (/Không phát hiện|chưa rõ|\bmờ\b|giữ nguyên/i.test(message)) return SCAN_MESSAGES.LOOK_AT_CAMERA;
  if (/kết nối|đang bận|máy chủ AI/i.test(message)) return SCAN_MESSAGES.SERVICE_BUSY;
  if (/camera trước|ảnh tải lên|ảnh chụp sẵn/i.test(message)) return SCAN_MESSAGES.CAMERA_REQUIRED;
  return SCAN_MESSAGES.VERIFY_FAILED;
}

/** Thông báo tạm thời: trang tiếp tục quét, không chuyển sang màn hình thất bại. */
export function isTransientScanMessage(message: ScanMessage): boolean {
  return SOFT.has(message);
}

/** Mã QR không dùng lại được: chỉ hướng dẫn quét mã mới, không hiện nút thử lại. */
export function needsNewQr(message: ScanMessage): boolean {
  return message === SCAN_MESSAGES.QR_EXPIRED || message === SCAN_MESSAGES.QR_USED;
}

/** Tiêu đề ngắn (bỏ phần hướng dẫn "Vui lòng ...") cho màn hình kết quả. */
export function scanMessageTitle(message: ScanMessage): string {
  return message.split(". Vui lòng")[0].replace(/\.$/, "");
}
