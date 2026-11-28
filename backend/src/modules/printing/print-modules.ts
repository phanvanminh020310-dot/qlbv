/**
 * Danh mục phân hệ dùng để phân loại mẫu in.
 *
 * Danh sách này chỉ là GỢI Ý có nhãn tiếng Việt — mã phân hệ là chuỗi tự do (chữ in hoa,
 * số, gạch dưới). Khi có phân hệ mới, người thiết kế chỉ cần nhập mã mới trong “Thông tin
 * mẫu”; mã đã dùng trong CSDL tự xuất hiện trong danh sách, không phải sửa mã nguồn.
 */
import { BadRequestException } from '@nestjs/common';

export const PRINT_MODULE_CATALOG: Array<{ code: string; label: string }> = [
  { code: 'HSBA', label: 'Hồ sơ bệnh án' },
  { code: 'TASK', label: 'Quản lý công việc' },
  { code: 'REPORT', label: 'Báo cáo khoa' },
  { code: 'ASSET', label: 'Quản lý tài sản' },
  { code: 'DUTY', label: 'Lịch khám bệnh' },
  { code: 'STAFF_LEARNING', label: 'Lịch học cán bộ nhân viên' },
  { code: 'DUTY_ATTENDANCE', label: 'Chấm công' },
  { code: 'USER', label: 'Nhân sự / người dùng' },
  { code: 'DEPARTMENT', label: 'Khoa phòng' },
  { code: 'UTILITY', label: 'Tiện ích' },
  { code: 'GENERIC', label: 'Dùng chung' },
];

const MODULE_RE = /^[A-Z][A-Z0-9_]{0,39}$/;

/** Chuẩn hoá mã phân hệ người dùng nhập (in hoa, bỏ dấu cách). */
export function normalizeModuleCode(input: unknown, fallback = 'GENERIC'): string {
  const raw = String(input ?? '').trim();
  if (!raw) return fallback;
  const code = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!MODULE_RE.test(code)) throw new BadRequestException(`Mã phân hệ “${raw}” không hợp lệ (chữ in hoa không dấu, số, gạch dưới; bắt đầu bằng chữ)`);
  return code;
}

export function moduleLabel(code: string): string {
  return PRINT_MODULE_CATALOG.find((m) => m.code === code)?.label ?? code;
}
