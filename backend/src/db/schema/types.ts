/**
 * Kiểu dữ liệu dùng chung — hằng số trạng thái & union type.
 *
 * Nguyên tắc: dùng `text` + union type (thay vì pgEnum) để có thể bổ sung
 * trạng thái mới mà không phải ALTER TYPE trên CSDL đang chạy.
 */

/* ----------------------------------------------------------------- Trạng thái phiếu sửa HSBA */
export const REQUEST_STATUSES = [
  'CHO_DE_NGHI', // chờ người đề nghị xác nhận
  'CHO_KHTB', // chờ duyệt / TB.KHTH
  'CHO_BAOHIEM', // chờ trưởng bộ phận bảo hiểm xác nhận
  'CHO_TC', // chờ tài chính (mã cũ, giữ để tương thích)
  'CHO_TAICHINH', // chờ tài chính xác nhận hủy thanh toán (theo bước TAICHINH)
  'HOAN_TAT', // hoàn tất
  'TRA_LAI', // bị trả lại
  'DA_HUY', // đã hủy
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  CHO_DE_NGHI: 'Chờ người đề nghị xác nhận',
  CHO_KHTB: 'Chờ Duyệt/TB.KHTH',
  CHO_BAOHIEM: 'Chờ Tr.BP bảo hiểm xác nhận',
  CHO_TC: 'Chờ TC xác nhận hủy thanh toán',
  CHO_TAICHINH: 'Chờ TC xác nhận hủy thanh toán',
  HOAN_TAT: 'Hoàn tất',
  TRA_LAI: 'Bị trả lại — chờ sửa & gửi lại',
  DA_HUY: 'Đã hủy',
};

/* ----------------------------------------------------------------- Loại chữ ký */
export const SIGNATURE_TYPES = ['DE_NGHI', 'KHTB', 'TAICHINH'] as const;
export type SignatureType = (typeof SIGNATURE_TYPES)[number];

export const SIGNATURE_TITLES: Record<SignatureType, string> = {
  DE_NGHI: 'NGƯỜI ĐỀ NGHỊ SỬA HSBA',
  KHTB: 'DUYỆT/ TB.KHTH',
  TAICHINH: 'TC XÁC NHẬN ĐÃ HỦY THANH TOÁN',
};

/* ----------------------------------------------------------------- Kiểu cột / cách tính */
export const COLUMN_KINDS = ['INPUT', 'CALC'] as const;
export type ColumnKind = (typeof COLUMN_KINDS)[number];

export const AGG_MODES = ['SUM', 'FIRST', 'LAST', 'AVG', 'MIN', 'MAX'] as const;
export type AggMode = (typeof AGG_MODES)[number];

/* ----------------------------------------------------------------- Loại kỳ báo cáo */
export const PERIOD_MODES = [
  'day',
  'yesterday',
  'week',
  'month',
  'quarter',
  'year',
  'range',
  'all',
] as const;
export type PeriodMode = (typeof PERIOD_MODES)[number];

/* ----------------------------------------------------------------- Loại tiện ích */
export const UTILITY_KINDS = ['BUILTIN', 'FORM', 'REPORT', 'LINK', 'IFRAME'] as const;
export type UtilityKind = (typeof UTILITY_KINDS)[number];

/* ----------------------------------------------------------------- Trạng thái công việc */
export const JOB_STATUSES = ['PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const DATA_JOB_KINDS = ['IMPORT', 'EXPORT'] as const;
export type DataJobKind = (typeof DATA_JOB_KINDS)[number];

/* ----------------------------------------------------------------- Phạm vi dữ liệu */
/** OWN = chỉ dữ liệu mình tạo · DEPT = dữ liệu khoa được gán · ALL = toàn viện */
export const DATA_SCOPES = ['OWN', 'DEPT', 'ALL'] as const;
export type DataScope = (typeof DATA_SCOPES)[number];

/* ----------------------------------------------------------------- Mẫu in */
export const PRINT_MODULES = ['HSBA', 'REPORT', 'ASSET', 'UTILITY', 'TASK', 'GENERIC'] as const;
export type PrintModule = (typeof PRINT_MODULES)[number];

export const PAPER_SIZES = ['A4', 'A5', 'A3', 'Letter', 'Legal', 'Custom'] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];
