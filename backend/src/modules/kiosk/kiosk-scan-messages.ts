/**
 * Thông báo công khai cho trang quét QR trên điện thoại.
 *
 * Ngắn gọn, dễ hiểu và không lộ chi tiết kỹ thuật/nhạy cảm (độ tương đồng, tên
 * mô hình AI, chống giả mạo, CSDL, địa chỉ dịch vụ, tên người khác...). Chi tiết
 * chẩn đoán chỉ ghi vào log máy chủ cho CNTT.
 */
export const KIOSK_SCAN_MESSAGES = {
  SUCCESS: "Điểm danh thành công.",
  QR_EXPIRED: "Mã QR đã hết hạn. Vui lòng quét mã mới.",
  QR_USED: "Mã QR đã được sử dụng. Vui lòng quét mã mới.",
  RESCAN: "Vui lòng quét lại mã QR.",
  VERIFY_FAILED: "Xác thực không thành công.",
  NO_SHIFT: "Bạn không có ca trực tại phòng khám này.",
  /** Tạm thời: trang quét tự quét tiếp, không chuyển sang màn hình thất bại. */
  LOOK_AT_CAMERA: "Vui lòng nhìn thẳng vào camera.",
  PROCESSING: "Đang xác thực, vui lòng giữ nguyên.",
  CAMERA_REQUIRED: "Vui lòng xác thực bằng camera trước.",
  SERVICE_BUSY: "Hệ thống đang bận. Vui lòng thử lại.",
} as const;

export type KioskScanMessage = (typeof KIOSK_SCAN_MESSAGES)[keyof typeof KIOSK_SCAN_MESSAGES];

/** Không được xuất hiện trong bất kỳ thông báo nào gửi tới trang quét. */
export const SENSITIVE_SCAN_TERMS = [
  /tương đồng|tin cậy|similarity|%/i,
  /ArcFace|PAD|ISO|30107|liveness|vector|embedding/i,
  /giả mạo|người thật|sinh trắc|sinh học/i,
  /CSDL|Postgres|AI Engine|máy chủ AI|http/i,
  /Burn-on-scan/i,
];
