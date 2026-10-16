/**
 * Quy tắc gán vai trò mặc định cho nhân sự khám.
 *
 * Danh mục chức danh hiện dùng cả hai cách viết “Bác sĩ” và “Bác Sỹ”.
 * Chuẩn hoá dấu, hoa/thường và khoảng trắng để chính sách không phụ thuộc
 * vào cách nhập liệu, nhưng vẫn chỉ áp dụng cho đúng chức danh bác sĩ.
 */
export const DUTY_STAFF_ROLE_CODE = 'NHAN_VIEN_TRUC';

export function isDoctorTitle(title: string | null | undefined): boolean {
  const normalized = (title ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('vi-VN')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized === 'bac si' || normalized === 'bac sy';
}
