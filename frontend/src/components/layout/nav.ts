import {
  Activity,
  Bell,
  BarChart3,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Radio,
  UserCheck,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  History,
  LayoutDashboard,
  Layers,
  PenLine,
  Printer,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  DatabaseBackup,
  FolderTree,
  BadgeCheck,
  Boxes,
  ArrowLeftRight,
  TrendingDown,
  QrCode,
  ScanLine,
  PackageSearch,
  Terminal,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  /** Đường dẫn — mục cha có `children` thì không cần */
  href?: string;
  label: string;
  icon: LucideIcon;
  /** Quyền tối thiểu để hiện mục này (bỏ trống = ai cũng thấy) */
  permission?: string;
  /** Một trong các quyền thay thế cũng được mở mục này (OR). */
  anyPermissions?: string[];
  /** Chỉ hiện với vai trò ADMIN hoặc SUPER_ADMIN (dùng cho công cụ hạ tầng nhạy cảm). */
  adminOnly?: boolean;
  /** Menu con (thu gọn/mở rộng được). Mục cha tự ẩn khi không có quyền xem mục con nào. */
  children?: NavItem[];
}

/** Toàn bộ đường dẫn của menu (kể cả menu con) */
export function navHrefs(items: NavItem[]): string[] {
  return items.flatMap((i) => [...(i.href ? [i.href] : []), ...navHrefs(i.children ?? [])]);
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Menu điều hướng — mục nào không đủ quyền sẽ tự ẩn.
 * Quản trị viên có thể thêm tiện ích mới trong mục "Tiện ích" mà không cần sửa mã nguồn.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Tổng quan',
    items: [
      { href: '/dashboard', label: 'Bảng điều khiển', icon: LayoutDashboard, permission: 'dashboard.view' },
      { href: '/thong-bao', label: 'Thông báo', icon: Bell },
    ],
  },
  {
    label: 'Hồ sơ bệnh án',
    items: [
      { href: '/ho-so-benh-an', label: 'Phiếu đề nghị sửa', icon: ClipboardList, permission: 'hsba.request.view' },
      { href: '/ho-so-benh-an/tao-moi', label: 'Tạo phiếu mới', icon: PenLine, permission: 'hsba.request.create' },
      { href: '/ho-so-benh-an/quy-trinh', label: 'Quy trình ký', icon: Layers, permission: 'hsba.workflow.view' },
    ],
  },
  {
    label: 'Báo cáo khoa',
    items: [
      { href: '/bao-cao/nhap-lieu', label: 'Nhập số liệu', icon: FileSpreadsheet, permission: 'report.entry.view' },
      { href: '/bao-cao', label: 'Xem báo cáo', icon: BarChart3, permission: 'report.view.view' },
      { href: '/bao-cao/tong-hop', label: 'Tổng hợp toàn viện', icon: Activity, permission: 'report.summary.view' },
      { href: '/bao-cao/mau', label: 'Mẫu báo cáo', icon: FileText, permission: 'report.template.view' },
      { href: '/bao-cao/tuy-bien', label: 'Báo cáo tuỳ biến', icon: SlidersHorizontal, permission: 'studio.report.view' },
    ],
  },
  {
    label: 'Quản lý tài sản',
    items: [
      { href: '/tai-san', label: 'Tổng quan tài sản', icon: Boxes, permission: 'asset.view' },
      { href: '/tai-san/danh-sach', label: 'Danh sách tài sản', icon: PackageSearch, permission: 'asset.view' },
      { href: '/tai-san/nghiep-vu', label: 'Chứng từ nghiệp vụ', icon: ArrowLeftRight, permission: 'asset.transaction.view' },
      { href: '/tai-san/kiem-ke', label: 'Kiểm kê tài sản', icon: ClipboardList, permission: 'asset.inventory.view' },
      { href: '/tai-san/khau-hao', label: 'Khấu hao / hao mòn', icon: TrendingDown, permission: 'asset.depreciation.view' },
      { href: '/tai-san/bao-tri', label: 'Lịch bảo trì / kiểm định', icon: CalendarClock, permission: 'asset.view' },
      { href: '/tai-san/bao-cao', label: 'Báo cáo tài sản', icon: BarChart3, permission: 'asset.report.view' },
      { href: '/tai-san/in-tem', label: 'In tem QR / mã vạch', icon: QrCode, permission: 'asset.label.print' },
      { href: '/tai-san/tra-cuu', label: 'Quét mã', icon: ScanLine, permission: 'asset.view' },
      { href: '/tai-san/danh-muc', label: 'Danh mục tài sản', icon: FolderTree, permission: 'asset.catalog.view' },
    ],
  },
  {
    label: 'Lịch trực',
    items: [
      { href: '/lich-truc', label: 'Lịch trực tuần', icon: CalendarDays, permission: 'duty.view' },
      { href: '/lich-truc/cua-toi', label: 'Lịch của tôi', icon: UserCheck, permission: 'duty.view' },
      { href: '/lich-truc/theo-doi-xac-thuc', label: 'Theo dõi xác thực', icon: Radio, permission: 'duty.manage', anyPermissions: ['duty.manage-all'] },
      { href: '/lich-truc/yeu-cau', label: 'Yêu cầu lịch trực', icon: ArrowLeftRight, permission: 'duty.manage', anyPermissions: ['duty.manage-all', 'duty.swap.approve', 'duty.exception.resolve'] },
      { href: '/lich-truc/ky-lich', label: 'Kỳ lịch & công bố', icon: CalendarRange, permission: 'duty.period.manage' },
      { href: '/lich-truc/danh-muc', label: 'Danh mục trực', icon: Settings2, permission: 'duty.catalog.manage' },
    ],
  },
  {
    label: 'Quản trị hệ thống',
    items: [
      {
        label: 'Danh mục',
        icon: FolderTree,
        children: [
          { href: '/quan-tri/khoa-phong', label: 'Khoa phòng', icon: Building2, permission: 'department.view' },
          { href: '/quan-tri/chuc-danh', label: 'Chức danh', icon: BadgeCheck, permission: 'job_title.view' },
        ],
      },
      { href: '/quan-tri/nguoi-dung', label: 'Người dùng', icon: Users, permission: 'user.view' },
      { href: '/quan-tri/vai-tro', label: 'Vai trò & quyền', icon: ShieldCheck, permission: 'role.view' },
      { href: '/quan-tri/mau-in', label: 'Thiết kế bản in', icon: Printer, permission: 'print.template.view' },
      { href: '/quan-tri/tien-ich', label: 'Tiện ích', icon: SlidersHorizontal, permission: 'utility.view' },
      { href: '/quan-tri/tac-vu', label: 'Tác vụ định kỳ', icon: CalendarClock, permission: 'job.view' },
      { href: '/quan-tri/sao-luu', label: 'Sao lưu & phục hồi', icon: DatabaseBackup, permission: 'backup.view' },
      { href: '/quan-tri/truy-van-sql', label: 'SQL Console', icon: Terminal, adminOnly: true },
      { href: '/quan-tri/cau-hinh', label: 'Cấu hình hệ thống', icon: Settings2, permission: 'setting.view' },
      { href: '/quan-tri/nhat-ky', label: 'Nhật ký kiểm toán', icon: History, permission: 'audit.log.view' },
    ],
  },
];
