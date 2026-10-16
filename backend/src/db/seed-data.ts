/**
 * Dữ liệu nền của hệ thống: quyền, vai trò, cấu hình, tiện ích, tác vụ định kỳ,
 * quy trình ký và các mẫu in mặc định.
 *
 * Tất cả đều có thể sửa tiếp từ giao diện quản trị — đây chỉ là điểm khởi đầu hợp lý.
 */
import type { PrintDocument } from './schema/printing';
import type { WorkflowStep } from './schema/hsba';
import { defaultSettings, type SettingItem } from '../modules/settings/settings.service';

export interface PermissionSeed {
  code: string;
  name: string;
  module: string;
  action: string;
  description?: string;
}

const P = (
  module: string,
  action: string,
  name: string,
  description = '',
): PermissionSeed => ({
  code: `${module}.${action}`,
  name,
  module,
  action,
  description,
});

/* ------------------------------------------------------------------ Danh mục quyền */

export const PERMISSIONS: PermissionSeed[] = [
  // Bảng điều khiển
  P('dashboard', 'view', 'Xem trang tổng quan'),
  P('dashboard', 'view-all', 'Xem tổng quan toàn viện'),

  // Đơn vị / khoa phòng
  P('department', 'view', 'Xem đơn vị / khoa phòng'),
  P('department', 'create', 'Thêm đơn vị / khoa phòng'),
  P('department', 'update', 'Sửa đơn vị / khoa phòng'),
  P('department', 'delete', 'Xoá đơn vị / khoa phòng'),

  // Danh mục chức danh
  P('job_title', 'view', 'Xem danh mục chức danh'),
  P('job_title', 'create', 'Thêm chức danh'),
  P('job_title', 'update', 'Sửa chức danh'),
  P('job_title', 'delete', 'Xoá chức danh'),

  // Người dùng
  P('user', 'view', 'Xem danh sách người dùng'),
  P('user', 'create', 'Thêm người dùng'),
  P('user', 'update', 'Sửa người dùng'),
  P('user', 'delete', 'Xoá người dùng'),
  P('user', 'reset-password', 'Đặt lại mật khẩu người dùng'),
  P('user', 'assign-role', 'Gán vai trò cho người dùng'),
  P('user', 'import', 'Nhập danh sách người dùng'),
  P('user', 'export', 'Kết xuất danh sách người dùng'),

  // Vai trò & quyền
  P('role', 'view', 'Xem vai trò và quyền'),
  P('role', 'create', 'Thêm vai trò'),
  P('role', 'update', 'Sửa vai trò và gán quyền'),
  P('role', 'delete', 'Xoá vai trò'),

  // Quy trình ký HSBA
  P('hsba.workflow', 'view', 'Xem quy trình ký'),
  P('hsba.workflow', 'create', 'Thêm quy trình ký'),
  P('hsba.workflow', 'update', 'Sửa quy trình ký'),
  P('hsba.workflow', 'delete', 'Xoá quy trình ký'),

  // Phiếu sửa hồ sơ bệnh án
  P('hsba.request', 'view', 'Xem phiếu đề nghị sửa HSBA'),
  P('hsba.request', 'view-all', 'Xem phiếu của mọi khoa'),
  P('hsba.request', 'create', 'Tạo phiếu đề nghị sửa HSBA'),
  P('hsba.request', 'update', 'Sửa nội dung phiếu'),
  P('hsba.request', 'delete', 'Xoá phiếu'),
  P('hsba.request', 'sign-requester', 'Ký với tư cách người đề nghị'),
  P('hsba.request', 'sign-khtb', 'Duyệt / ký TB.KHTH'),
  P('hsba.request', 'sign-insurance', 'Xác nhận / ký Tr.BP bảo hiểm'),
  P('hsba.request', 'sign-finance', 'Xác nhận tài chính đã hủy thanh toán'),
  P('hsba.request', 'return', 'Trả lại phiếu kèm lý do'),
  P('hsba.request', 'cancel', 'Huỷ phiếu đã tạo'),
  P('hsba.request', 'assign-requester', 'Chỉ định người đề nghị trên phiếu'),
  P('hsba.request', 'export', 'Kết xuất phiếu ra PDF/Word/Excel'),
  P('hsba.request', 'print', 'In phiếu'),
  P('hsba.request', 'comment', 'Ghi ý kiến trên phiếu'),

  // Mẫu báo cáo
  P('report.template', 'view', 'Xem mẫu báo cáo'),
  P('report.template', 'create', 'Thêm mẫu báo cáo'),
  P('report.template', 'update', 'Sửa cấu trúc mẫu báo cáo'),
  P('report.template', 'delete', 'Xoá mẫu báo cáo'),

  // Số liệu báo cáo
  P('report.entry', 'view', 'Xem số liệu báo cáo'),
  P('report.entry', 'update', 'Nhập / sửa số liệu báo cáo'),
  P('report.entry', 'delete', 'Xoá số liệu báo cáo'),
  P('report.entry', 'import', 'Nhập số liệu từ Excel'),
  P('report.entry', 'view-audit', 'Xem lịch sử sửa số liệu'),

  // Báo cáo & tổng hợp
  P('report.view', 'view', 'Xem báo cáo công tác'),
  P('report.view', 'all-departments', 'Xem báo cáo của mọi khoa'),
  P('report.export', 'excel', 'Kết xuất báo cáo ra Excel'),
  P('report.export', 'word', 'Kết xuất báo cáo ra Word'),
  P('report.export', 'pdf', 'Kết xuất báo cáo ra PDF'),
  P('report.summary', 'view', 'Xem bảng tổng hợp toàn viện'),
  P('report.snapshot', 'create', 'Chốt số liệu kỳ báo cáo'),
  P('report.snapshot', 'approve', 'Duyệt báo cáo đã chốt'),
  P('report.snapshot', 'lock', 'Khoá báo cáo đã duyệt'),

  // Thiết kế bản in
  P('print.template', 'view', 'Xem mẫu in'),
  P('print.template', 'create', 'Thêm mẫu in'),
  P('print.template', 'update', 'Thiết kế / sửa mẫu in'),
  P('print.template', 'delete', 'Xoá mẫu in'),
  P('print.template', 'publish', 'Ban hành mẫu in'),
  P('print.render', 'view', 'Xem trước bản in'),
  P('print.render', 'export', 'Kết xuất bản in ra PDF'),

  // Quản lý tài sản
  P('asset', 'view', 'Xem tài sản', 'Danh sách, hồ sơ, dòng thời gian tài sản (theo phạm vi khoa của vai trò)'),
  P('asset', 'view-all', 'Xem tài sản toàn viện', 'Bỏ qua giới hạn khoa — xem mọi tài sản'),
  P('asset', 'create', 'Thêm tài sản'),
  P('asset', 'update', 'Sửa hồ sơ tài sản'),
  P('asset', 'delete', 'Xoá tài sản', 'Chỉ xoá được tài sản chưa phát sinh chứng từ đã duyệt'),
  P('asset', 'import', 'Nhập tài sản từ Excel'),
  P('asset', 'export', 'Xuất danh sách tài sản ra Excel'),
  P('asset', 'dashboard', 'Xem tổng quan tài sản'),
  P('asset.label', 'print', 'In tem tài sản (mã vạch/QR)'),
  P('asset.catalog', 'view', 'Xem danh mục tài sản', 'Loại tài sản, vị trí, nhà cung cấp, nguồn vốn'),
  P('asset.catalog', 'manage', 'Quản lý danh mục tài sản'),
  P('asset.transaction', 'view', 'Xem chứng từ tài sản'),
  P('asset.transaction', 'create', 'Lập chứng từ tài sản', 'Ghi tăng, cấp phát, điều chuyển, thu hồi, báo hỏng, sửa chữa, thanh lý, đánh giá lại'),
  P('asset.transaction', 'approve', 'Duyệt chứng từ tài sản', 'Duyệt mới áp dụng thay đổi vào tài sản'),
  P('asset.depreciation', 'view', 'Xem khấu hao / hao mòn'),
  P('asset.depreciation', 'run', 'Tính & chốt kỳ khấu hao / hao mòn'),
  P('asset.inventory', 'view', 'Xem đợt kiểm kê tài sản', 'Danh sách, tiến độ, kết quả, biên bản kiểm kê'),
  P('asset.inventory', 'manage', 'Lập & điều hành kiểm kê', 'Lập đợt, chốt sổ sách, khoá số liệu, xử lý chênh lệch'),
  P('asset.inventory', 'scan', 'Tham gia quét kiểm kê', 'Quét mã / xác nhận tài sản trong đợt kiểm kê được phân công hoặc thuộc khoa mình'),
  P('asset.inventory', 'approve', 'Duyệt kết quả kiểm kê', 'Phê duyệt biên bản, hoàn tất đợt kiểm kê'),
  P('asset.report', 'view', 'Xem báo cáo tài sản', 'Sổ TSCĐ, tăng giảm, theo khoa, chi phí sửa chữa, lịch bảo trì (theo phạm vi khoa)'),

  // Tiện ích
  P('utility', 'view', 'Xem tiện ích'),
  P('utility', 'create', 'Thêm tiện ích'),
  P('utility', 'update', 'Sửa tiện ích'),
  P('utility', 'delete', 'Xoá tiện ích'),

  // Tác vụ định kỳ
  P('job', 'view', 'Xem tác vụ định kỳ'),
  P('job', 'create', 'Thêm tác vụ định kỳ'),
  P('job', 'update', 'Sửa tác vụ định kỳ'),
  P('job', 'delete', 'Xoá tác vụ định kỳ'),
  P('job', 'run', 'Chạy tác vụ ngay'),

  // Nhật ký & cấu hình
  P('audit.log', 'view', 'Xem nhật ký kiểm toán'),
  P('setting', 'view', 'Xem cấu hình hệ thống'),
  P('setting', 'update', 'Sửa cấu hình hệ thống'),

  // Studio — dashboard & báo cáo tùy biến (GĐ3)
  P('studio.dashboard', 'view', 'Xem bảng điều khiển tùy biến', 'Xem các trang dashboard dùng chung/cá nhân'),
  P('studio.dashboard', 'manage', 'Thiết kế bảng điều khiển', 'Tạo/sửa/xóa trang dashboard của mình; quản trị sửa trang dùng chung'),
  P('studio.report', 'view', 'Xem báo cáo tùy biến'),
  P('studio.report', 'manage', 'Thiết kế báo cáo tùy biến', 'Tự tạo báo cáo từ nguồn dữ liệu được phép, xuất Excel'),

  // Dữ liệu
  P('data', 'import', 'Nhập dữ liệu từ tệp'),
  P('data', 'export', 'Kết xuất dữ liệu ra tệp'),
  P('backup', 'view', 'Xem lịch sử sao lưu'),
  P('backup', 'create', 'Tạo bản sao lưu'),
  P('backup', 'restore', 'Phục hồi từ bản sao lưu'),
  P('file', 'upload', 'Tải tệp lên'),
  P('file', 'delete', 'Xoá tệp đã tải lên'),

  // Lịch trực khám bệnh
  P('duty', 'view', 'Xem lịch trực', 'Xem lịch trực các phòng khám và kỳ lịch đã công bố'),
  P('duty', 'manage', 'Phân công trực (trong khoa)', 'Tạo ô trực, phân công/gỡ người trực, ghi nhận nghỉ phép — trong phạm vi khoa được giao'),
  P('duty', 'manage-all', 'Điều phối toàn viện', 'Phân công mọi phòng khám; bỏ qua ràng buộc khi có lý do (ghi nhật ký)'),
  P('duty', 'period.manage', 'Lập, chốt và công bố kỳ lịch', 'Tạo kỳ lịch, cấu hình ràng buộc, công bố, chốt sớm và mở chốt'),
  P('duty', 'catalog.manage', 'Quản lý danh mục trực', 'Phòng khám, ca trực, vai trò trực, ngày nghỉ'),
  P('duty', 'swap.approve', 'Duyệt đổi/nhường ca', 'Duyệt yêu cầu đổi/nhường ca trước khi chốt (trong phạm vi khoa)'),
  P('duty', 'exception.resolve', 'Xử lý ngoại lệ đổi trực (KHTH)', 'Duyệt ngoại lệ sau khi chốt và đổi trực trực tiếp — tài khoản đổi trực'),
  P('duty', 'export', 'Xuất / in lịch trực', 'Xuất Excel lịch trực và bảng tổng hợp giờ trực'),
];

/* ------------------------------------------------------------------------ Vai trò */

export interface RoleSeed {
  code: string;
  name: string;
  description: string;
  dataScope: 'OWN' | 'DEPT' | 'ALL';
  priority: number;
  color: string;
  isSystem: boolean;
  /** Mã quyền; '*' = toàn bộ */
  permissions: string[] | '*';
}

export const ROLES: RoleSeed[] = [
  /* ============================ TẦNG HỆ THỐNG (không phân biệt nghiệp vụ) ============ */
  {
    code: 'SUPER_ADMIN',
    name: 'Quản trị tối cao',
    description: 'Tài khoản chủ của hệ thống — toàn quyền ngầm, bỏ qua mọi kiểm tra. Chỉ nên dùng 1 tài khoản dự phòng, hạn chế dùng hằng ngày',
    dataScope: 'ALL',
    priority: 1,
    color: '#dc2626',
    isSystem: true,
    permissions: '*',
  },
  {
    code: 'ADMIN',
    name: 'Quản trị hệ thống',
    description:
      'Quản lý người dùng, vai trò, khoa phòng, danh mục, mẫu báo cáo/in, tác vụ, sao lưu và tiện ích — KHÔNG thao tác nghiệp vụ, KHÔNG phục hồi CSDL, KHÔNG sửa cấu hình hệ thống',
    dataScope: 'ALL',
    priority: 10,
    color: '#ea580c',
    isSystem: true,
    permissions: [
      'duty.view', 'duty.catalog.manage',
      // Tổng quan & Studio (thiết kế trang cho cả hệ thống dùng)
      'dashboard.view', 'dashboard.view-all',
      'studio.dashboard.view', 'studio.dashboard.manage',
      'studio.report.view', 'studio.report.manage',
      // Quản trị tổ chức
      'department.view', 'department.create', 'department.update', 'department.delete',
      'job_title.view', 'job_title.create', 'job_title.update', 'job_title.delete',
      'user.view', 'user.create', 'user.update', 'user.delete',
      'user.reset-password', 'user.assign-role', 'user.import', 'user.export',
      'role.view', 'role.create', 'role.update', 'role.delete',
      // Cấu hình nghiệp vụ
      'hsba.workflow.view', 'hsba.workflow.create', 'hsba.workflow.update', 'hsba.workflow.delete',
      'report.template.view', 'report.template.create', 'report.template.update', 'report.template.delete',
      'print.template.view', 'print.template.create', 'print.template.update', 'print.template.delete', 'print.template.publish',
      'print.render.view', 'print.render.export',
      // Tiện ích & tác vụ nền
      'utility.view', 'utility.create', 'utility.update', 'utility.delete',
      'job.view', 'job.create', 'job.update', 'job.delete', 'job.run',
      // Giám sát & dữ liệu
      'audit.log.view',
      'setting.view',
      'data.import', 'data.export',
      'backup.view', 'backup.create',
      'file.upload', 'file.delete',
      // Tra cứu xử lý sự cố (chỉ xem/in, không ký-duyệt-nhập)
      'hsba.request.view', 'hsba.request.view-all',
      'report.entry.view', 'report.entry.view-audit',
      'report.view.view', 'report.view.all-departments', 'report.summary.view',
      'report.export.excel', 'report.export.word', 'report.export.pdf',
      'asset.view', 'asset.view-all', 'asset.dashboard',
      'asset.catalog.view', 'asset.transaction.view',
      'asset.inventory.view', 'asset.depreciation.view', 'asset.report.view',
    ],
  },

  /* ============================ TẦNG LÃNH ĐẠO & DUYỆT ============================ */
  {
    code: 'LANH_DAO',
    name: 'Ban giám đốc / Lãnh đạo xét duyệt',
    description:
      'Xem toàn bộ dữ liệu đọc của bệnh viện; duyệt & khoá bản chốt kỳ báo cáo, duyệt chứng từ tài sản và biên bản kiểm kê',
    dataScope: 'ALL',
    priority: 15,
    color: '#be185d',
    isSystem: true,
    permissions: [
      'duty.view',
      'dashboard.view', 'dashboard.view-all',
      'studio.dashboard.view', 'studio.report.view',
      // HSBA: chỉ xem/toàn viện/in
      'hsba.request.view', 'hsba.request.view-all', 'hsba.request.export', 'hsba.request.print',
      // Báo cáo: xem toàn viện + duyệt/khoá bản chốt
      'report.view.view', 'report.view.all-departments', 'report.summary.view',
      'report.export.excel', 'report.export.word', 'report.export.pdf',
      'report.snapshot.approve', 'report.snapshot.lock',
      // Tài sản: xem toàn viện + duyệt
      'asset.view', 'asset.view-all', 'asset.dashboard', 'asset.export',
      'asset.catalog.view',
      'asset.transaction.view', 'asset.transaction.approve',
      'asset.depreciation.view',
      'asset.inventory.view', 'asset.inventory.approve',
      'asset.report.view',
      'print.render.view', 'print.render.export',
      'utility.view',
    ],
  },
  {
    code: 'KHTB',
    name: 'Duyệt — TB.KHTH',
    description: 'Trưởng ban KHTB: duyệt hoặc trả lại phiếu đề nghị sửa hồ sơ bệnh án; duyệt & khoá bản chốt kỳ báo cáo khoa',
    dataScope: 'ALL',
    priority: 20,
    color: '#2563eb',
    isSystem: true,
    permissions: [
      'duty.view', 'duty.manage', 'duty.manage-all', 'duty.period.manage', 'duty.swap.approve', 'duty.exception.resolve', 'duty.export',
      'dashboard.view', 'dashboard.view-all',
      'studio.dashboard.view', 'studio.report.view',
      'hsba.request.view', 'hsba.request.view-all',
      'hsba.request.sign-khtb', 'hsba.request.return', 'hsba.request.comment',
      'hsba.request.export', 'hsba.request.print',
      'report.view.view', 'report.view.all-departments', 'report.summary.view',
      'report.export.excel', 'report.export.word', 'report.export.pdf',
      'report.snapshot.approve', 'report.snapshot.lock',
      'print.render.view', 'print.render.export',
      'utility.view',
    ],
  },
  {
    code: 'BAO_HIEM',
    name: 'Trưởng BP bảo hiểm',
    description: 'Trưởng bộ phận bảo hiểm: kiểm tra và xác nhận hồ sơ bảo hiểm sau khi TB.KHTH duyệt; được phép trả lại phiếu đề nghị sửa HSBA',
    dataScope: 'ALL',
    priority: 20,
    color: '#7c3aed',
    isSystem: true,
    permissions: [
      'dashboard.view',
      'studio.dashboard.view', 'studio.report.view',
      'hsba.request.view', 'hsba.request.view-all',
      'hsba.request.sign-insurance', 'hsba.request.return', 'hsba.request.comment',
      'hsba.request.export', 'hsba.request.print',
      'report.view.view', 'report.export.excel',
      'utility.view',
    ],
  },
  {
    code: 'TAI_CHINH',
    name: 'Tài chính (huỷ thanh toán)',
    description: 'Xác nhận đã huỷ thanh toán BHYT cho hồ sơ bệnh án trước khi sửa; xem báo cáo công tác',
    dataScope: 'ALL',
    priority: 20,
    color: '#0891b2',
    isSystem: true,
    permissions: [
      'dashboard.view',
      'studio.dashboard.view', 'studio.report.view',
      'hsba.request.view', 'hsba.request.view-all',
      'hsba.request.sign-finance', 'hsba.request.comment',
      'hsba.request.export', 'hsba.request.print',
      'report.view.view', 'report.export.excel',
      'utility.view',
    ],
  },

  /* ============================ TẦNG CHUYÊN MÔN / PHÒNG BAN ============================ */
  {
    code: 'QL_TAI_SAN',
    name: 'Quản lý tài sản',
    description: 'Phòng HC-QT / Vật tư — TBYT: toàn bộ nghiệp vụ tài sản toàn viện (hồ sơ, danh mục, chứng từ, khấu hao, kiểm kê, in tem)',
    dataScope: 'ALL',
    priority: 25,
    color: '#0d9488',
    isSystem: true,
    permissions: [
      'dashboard.view',
      'studio.dashboard.view', 'studio.report.view',
      'asset.view', 'asset.view-all',
      'asset.create', 'asset.update', 'asset.delete',
      'asset.import', 'asset.export',
      'asset.dashboard', 'asset.label.print',
      'asset.catalog.view', 'asset.catalog.manage',
      'asset.transaction.view', 'asset.transaction.create', 'asset.transaction.approve',
      'asset.depreciation.view', 'asset.depreciation.run',
      'asset.inventory.view', 'asset.inventory.manage', 'asset.inventory.scan', 'asset.inventory.approve',
      'asset.report.view',
      'print.render.view', 'print.render.export',
      'utility.view', 'file.upload',
    ],
  },
  {
    code: 'TRUONG_KHOA',
    name: 'Trưởng khoa',
    description: 'Nhập & chịu trách nhiệm số liệu báo cáo của khoa; xem tài sản của khoa, lập đề nghị chứng từ, tham gia kiểm kê tại khoa',
    dataScope: 'DEPT',
    priority: 30,
    color: '#7c3aed',
    isSystem: true,
    permissions: [
      'duty.view',
      'dashboard.view',
      'studio.dashboard.view', 'studio.report.view',
      // Báo cáo của khoa mình
      'report.entry.view', 'report.entry.update', 'report.entry.import', 'report.entry.view-audit',
      'report.view.view',
      'report.export.excel', 'report.export.word', 'report.export.pdf',
      'report.snapshot.create',
      'print.render.view', 'print.render.export',
      // Phiếu HSBA của khoa (ký đề nghị thay mặt khoa)
      'hsba.request.view', 'hsba.request.sign-requester',
      // Tài sản của khoa mình (phạm vi DEPT)
      'asset.view', 'asset.dashboard',
      'asset.transaction.view', 'asset.transaction.create',
      'asset.catalog.view',
      'asset.inventory.view', 'asset.inventory.scan',
      'asset.report.view',
      'utility.view', 'file.upload',
    ],
  },

  /* ============================ TẦNG NGƯỜI DÙNG THƯỜNG ============================ */
  {
    code: 'NHAP_LIEU',
    name: 'Người đề nghị sửa HSBA',
    description: 'Bác sĩ / điều dưỡng: tạo phiếu đề nghị sửa hồ sơ bệnh án và ký với tư cách người đề nghị',
    dataScope: 'OWN',
    priority: 40,
    color: '#16a34a',
    isSystem: true,
    permissions: [
      'dashboard.view',
      'studio.dashboard.view', 'studio.report.view',
      'hsba.request.view', 'hsba.request.create', 'hsba.request.update',
      'hsba.request.sign-requester', 'hsba.request.comment', 'hsba.request.print',
      'file.upload', 'utility.view',
    ],
  },
  {
    code: 'NHAP_BAO_CAO',
    name: 'Nhân viên thống kê nhập báo cáo',
    description: 'Chỉ nhập số liệu báo cáo công tác của khoa được gán',
    dataScope: 'DEPT',
    priority: 50,
    color: '#65a30d',
    isSystem: true,
    permissions: [
      'dashboard.view',
      'studio.dashboard.view', 'studio.report.view',
      'report.entry.view', 'report.entry.update',
      'report.view.view', 'report.export.excel',
      'utility.view',
    ],
  },
  {
    code: 'XEM_BAO_CAO',
    name: 'Xem báo cáo',
    description: 'Chỉ xem và kết xuất báo cáo của khoa được gán, không sửa số liệu',
    dataScope: 'DEPT',
    priority: 60,
    color: '#64748b',
    isSystem: true,
    permissions: [
      'dashboard.view',
      'studio.dashboard.view', 'studio.report.view',
      'report.view.view',
      'report.export.excel', 'report.export.pdf',
      'utility.view',
    ],
  },

  /* ============================ LỊCH TRỰC KHÁM BỆNH ============================ */
  {
    code: 'DIEU_PHOI_TRUC',
    name: 'Điều phối lịch trực (KHTH)',
    description:
      'Lập kỳ lịch, chốt và công bố lịch trực; quản lý danh mục phòng/ca; duyệt ngoại lệ và đổi trực khẩn sau khi chốt (tài khoản đổi trực)',
    dataScope: 'ALL',
    priority: 25,
    color: '#0891b2',
    isSystem: true,
    permissions: [
      'duty.view', 'duty.manage', 'duty.manage-all', 'duty.period.manage',
      'duty.catalog.manage', 'duty.swap.approve', 'duty.exception.resolve', 'duty.export',
    ],
  },
  {
    code: 'NGUOI_XEP_LICH_TRUC_KHOA',
    name: 'Người xếp lịch trực khoa',
    description:
      'Giao cho Hành chính khoa, Chủ nhiệm khoa hoặc Phó chủ nhiệm khoa để phân công, gỡ phân công, duyệt nghỉ/bận và duyệt đổi/nhường ca trong đúng các khoa được gán',
    dataScope: 'DEPT',
    priority: 35,
    color: '#0f766e',
    isSystem: true,
    permissions: ['duty.view', 'duty.manage', 'duty.swap.approve', 'duty.export'],
  },
  {
    code: 'NHAN_VIEN_TRUC',
    name: 'Nhân viên trực khám',
    description:
      'Bác sĩ, điều dưỡng tham gia trực phòng khám: chỉ xem lịch trực đã công bố; việc xếp, đổi/nhường ca và ghi nhận nghỉ/bận do người xếp lịch trực khoa xử lý',
    dataScope: 'OWN',
    priority: 90,
    color: '#16a34a',
    isSystem: true,
    permissions: ['duty.view'],
  },
];

/* ------------------------------------------------------------------ Quy trình ký */

export const DEFAULT_WORKFLOW = {
  code: 'MAC_DINH',
  name: 'Quy trình mặc định (Người đề nghị → KHTH → Bảo hiểm → Tài chính)',
  description:
    'Bốn bước ký xác nhận điện tử: người đề nghị tạo và ký, TB.KHTH duyệt, Tr.BP bảo hiểm xác nhận, tài chính xác nhận đã hủy thanh toán.',

  steps: [
    {
      key: 'DE_NGHI',
      name: 'Người đề nghị xác nhận',
      title: 'NGƯỜI ĐỀ NGHỊ SỬA HSBA',
      kind: 'requester',
      confirmText:
        'Tôi xác nhận nội dung giấy đề nghị trên là đúng và gửi Ban KHTH để đề nghị sửa HSBA điện tử.',
      allowReturn: false,
    },
    {
      key: 'KHTB',
      name: 'Duyệt – TB.KHTH',
      title: 'DUYỆT/ TB.KHTH',
      kind: 'role',
      roleCodes: ['KHTB'],
      confirmText:
        'Tôi đã xem xét và DUYỆT / Thông báo cho sửa HSBA điện tử theo nội dung trên.',
      allowReturn: true,
      requireNote: false,
    },
    {
      key: 'BAOHIEM',
      name: 'Tr.BP bảo hiểm xác nhận',
      title: 'TR.BPBH XÁC NHẬN',
      kind: 'role',
      roleCodes: ['BAO_HIEM'],
      confirmText:
        'Tôi đã kiểm tra hồ sơ bảo hiểm liên quan và ĐỒNG Ý cho sửa HSBA điện tử theo nội dung trên.',
      allowReturn: true,
      requireNote: false,
    },
    {
      key: 'TAICHINH',
      name: 'Tài chính xác nhận hủy thanh toán',
      title: 'TC XÁC NHẬN ĐÃ HỦY THANH TOÁN',
      kind: 'role',
      roleCodes: ['TAI_CHINH'],
      confirmText:
        'Tôi xác nhận ĐÃ HỦY THANH TOÁN (giao dịch BHYT) liên quan đến hồ sơ bệnh án này.',
      allowReturn: true,
    },
  ] satisfies WorkflowStep[],
};

/* -------------------------------------------------------------- Tiện ích mặc định */

export const UTILITIES = [
  {
    code: 'SUA_HSBA',
    name: 'Sửa hồ sơ bệnh án',
    description: 'Tạo và theo dõi giấy đề nghị sửa hồ sơ bệnh án điện tử',
    icon: 'FileSignature',
    kind: 'BUILTIN' as const,
    route: '/ho-so-benh-an',
    permissionCode: 'hsba.request.view',
    sortOrder: 1,
    color: '#2563eb',
  },
  {
    code: 'BAO_CAO_KHOA',
    name: 'Báo cáo công tác khoa',
    description: 'Nhập số liệu và xem báo cáo công tác của khoa',
    icon: 'ClipboardList',
    kind: 'BUILTIN' as const,
    route: '/bao-cao',
    permissionCode: 'report.view.view',
    sortOrder: 2,
    color: '#16a34a',
  },
  {
    code: 'TONG_HOP_VIEN',
    name: 'Tổng hợp toàn viện',
    description: 'Bảng so sánh số liệu của tất cả các khoa cho ban giám đốc',
    icon: 'Building2',
    kind: 'BUILTIN' as const,
    route: '/bao-cao/tong-hop',
    permissionCode: 'report.summary.view',
    sortOrder: 3,
    placement: 'both' as const,
    color: '#0891b2',
  },
  {
    code: 'THIET_KE_BAN_IN',
    name: 'Thiết kế bản in',
    description: 'Thiết kế mẫu in chuyên nghiệp: kéo thả, nhiều thuộc tính, xuất PDF',
    icon: 'PenTool',
    kind: 'BUILTIN' as const,
    route: '/quan-tri/mau-in',
    permissionCode: 'print.template.view',
    sortOrder: 4,
    color: '#7c3aed',
  },
  {
    code: 'QUAN_TRI',
    name: 'Quản trị hệ thống',
    description: 'Người dùng, vai trò, quyền, khoa phòng, cấu hình',
    icon: 'Settings',
    kind: 'BUILTIN' as const,
    route: '/quan-tri/khoa-phong',
    permissionCode: 'user.view',
    sortOrder: 9,
    color: '#64748b',
  },
];

/* ------------------------------------------------------------ Tác vụ định kỳ mẫu */

export const SCHEDULED_JOBS = [
  {
    code: 'NHAC_HAN_TAI_SAN',
    name: 'Nhắc hạn kiểm định / bảo dưỡng / bảo hành tài sản',
    description: 'Lúc 07:30 mỗi ngày, gửi thông báo cho người quản lý tài sản và trưởng khoa về thiết bị quá hạn hoặc sắp đến hạn (payload.days, mặc định 15 ngày)',
    handler: 'asset.due-reminder',
    cron: '30 7 * * *',
    payload: { days: 15 },
    active: true,
  },
  {
    code: 'BACKUP_HANG_NGAY',
    name: 'Sao lưu CSDL hằng ngày',
    description: 'Sao lưu logic toàn bộ dữ liệu ra tệp JSON lúc 23:30 mỗi ngày',
    handler: 'db.backup',
    cron: '30 23 * * *',
    payload: {},
    active: true,
  },
  {
    code: 'NHAC_NHAP_BAO_CAO',
    name: 'Nhắc nhập báo cáo buổi chiều',
    description: 'Lúc 15:30 mỗi ngày, liệt kê các khoa chưa nhập số liệu báo cáo',
    handler: 'report.daily-digest',
    cron: '30 15 * * *',
    payload: {},
    active: true,
  },
  {
    code: 'STUDIO_SUBSCRIPTIONS',
    name: 'Phát hành ấn bản Studio định kỳ',
    description: 'Mỗi 5 phút rà các đăng ký ấn bản (Excel) đến hạn của người dùng Studio, dựng file và gửi thông báo tải về',
    handler: 'studio.subscription-dispatch',
    cron: '3,8,13,18,23,28,33,38,43,48,53,58 * * * *',
    payload: {},
    active: true,
  },
  {
    code: 'DON_TEP_QUA_HAN',
    name: 'Dọn tệp kết xuất quá hạn',
    description: 'Xoá tệp kết xuất và sao lưu cũ hơn số ngày lưu trữ (mặc định 30 ngày)',
    handler: 'storage.cleanup',
    cron: '0 2 * * *',
    payload: {},
    active: true,
  },
  {
    code: 'DON_PHIEN_DANG_NHAP',
    name: 'Dọn phiên đăng nhập',
    description: 'Thu hồi phiên của các tài khoản đã bị vô hiệu hoá',
    handler: 'session.cleanup',
    cron: '0 * * * *',
    payload: {},
    active: true,
  },
  {
    code: 'TONG_HOP_NHAT_KY',
    name: 'Tổng hợp nhật ký 24 giờ',
    description: 'Thống kê hoạt động theo phân hệ trong 24 giờ qua',
    handler: 'audit.digest',
    cron: '0 7 * * *',
    payload: {},
    active: true,
  },
  {
    code: 'LAM_NONG_BO_DEM',
    name: 'Làm nóng bộ đệm',
    description: 'Nạp sẵn danh mục khoa, vai trò vào bộ đệm mỗi sáng',
    handler: 'cache.warm',
    cron: '0 5 * * *',
    payload: {},
    active: true,
  },
];

/* --------------------------------------------------- Mẫu in mặc định: phiếu sửa HSBA */

export function defaultHsbaPrintDocument(): PrintDocument {
  const line = (id: string, x: number, y: number, w: number) => ({
    id,
    type: 'line',
    x,
    y,
    w,
    h: 0,
    style: { border: { bottom: { width: 0.2, style: 'solid' as const, color: '#000000' } } },
  });

  const field = (
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    path: string,
    opts: { label?: string; bold?: boolean; fontSize?: number; align?: 'left' | 'center' | 'right' } = {},
  ) => ({
    id,
    type: 'field',
    x,
    y,
    w,
    h,
    binding: { source: 'request', path, format: { type: 'text' as const, fallback: '' } },
    style: {
      fontFamily: 'Times New Roman',
      fontSize: opts.fontSize ?? 13,
      bold: opts.bold ?? false,
      align: opts.align ?? ('left' as const),
      verticalAlign: 'middle' as const,
      wrap: true,
    },
    text: opts.label ?? '',
    meta: { label: opts.label ?? '' },
  });

  const text = (
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    content: string,
    opts: { bold?: boolean; italic?: boolean; fontSize?: number; align?: 'left' | 'center' | 'right' } = {},
  ) => ({
    id,
    type: 'text',
    x,
    y,
    w,
    h,
    text: content,
    style: {
      fontFamily: 'Times New Roman',
      fontSize: opts.fontSize ?? 13,
      bold: opts.bold ?? false,
      italic: opts.italic ?? false,
      align: opts.align ?? ('left' as const),
      lineHeight: 1.35,
      wrap: true,
    },
  });

  return {
    paperSize: 'A4',
    orientation: 'portrait',
    margins: { top: 15, right: 20, bottom: 15, left: 25 },
    grid: { size: 5, show: true, snap: true },
    defaultStyle: { fontFamily: 'Times New Roman', fontSize: 13, lineHeight: 1.4 },
    variables: [
      { key: 'request.code', label: 'Mã phiếu', type: 'text', group: 'Phiếu' },
      { key: 'request.patientName', label: 'Tên người bệnh', type: 'text', group: 'Người bệnh' },
      { key: 'request.patientBirthYear', label: 'Năm sinh', type: 'text', group: 'Người bệnh' },
      { key: 'request.patientGender', label: 'Giới tính', type: 'text', group: 'Người bệnh' },
      { key: 'request.maKcb', label: 'Mã KCB', type: 'text', group: 'Người bệnh' },
      { key: 'request.maTheBhyt', label: 'Mã thẻ BHYT', type: 'text', group: 'Người bệnh' },
      { key: 'request.ngayVaoVien', label: 'Ngày vào viện', type: 'date', group: 'Người bệnh' },
      { key: 'request.ngayRaVien', label: 'Ngày ra viện', type: 'date', group: 'Người bệnh' },
      { key: 'request.requesterName', label: 'Người đề nghị', type: 'text', group: 'Người đề nghị' },
      { key: 'request.requesterTitle', label: 'Chức danh', type: 'text', group: 'Người đề nghị' },
      { key: 'request.departmentName', label: 'Khoa', type: 'text', group: 'Người đề nghị' },
      { key: 'request.reason', label: 'Lý do sai', type: 'text', group: 'Nội dung' },
      { key: 'request.content', label: 'Nội dung đề nghị', type: 'text', group: 'Nội dung' },
      { key: 'signature.DE_NGHI.fullName', label: 'Người đề nghị ký', type: 'text', group: 'Chữ ký' },
      { key: 'signature.KHTB.fullName', label: 'TB.KHTH ký', type: 'text', group: 'Chữ ký' },
      { key: 'signature.BAOHIEM.fullName', label: 'Tr.BPBH ký', type: 'text', group: 'Chữ ký' },
      { key: 'signature.TAICHINH.fullName', label: 'Tài chính ký', type: 'text', group: 'Chữ ký' },
    ],
    header: { height: 0, elements: [] },
    footer: {
      height: 12,
      elements: [
        {
          id: 'page-number',
          type: 'pageNumber',
          x: 120,
          y: -8,
          w: 60,
          h: 6,
          repeatOnEveryPage: true,
          anchor: 'footer',
          style: { fontSize: 10, align: 'right', italic: true },
          meta: { label: 'Trang {page}/{pages}' },
        },
      ],
    },
    pages: [
      {
        id: 'page-1',
        name: 'Trang chính',
        paperSize: 'A4',
        orientation: 'portrait',
        margins: { top: 15, right: 20, bottom: 15, left: 25 },
        elements: [
          // ---------- Tiêu đề
          text('h-hospital', 60, 12, 90, 7, 'BỆNH VIỆN QUÂN Y 4', { bold: true, fontSize: 12, align: 'center' }),
          text('h-dept', 60, 18, 90, 6, 'KHOA {request.departmentName}', { fontSize: 11, align: 'center' }),
          line('h-sep', 95, 25, 30),
          text('h-title', 30, 30, 150, 10, 'GIẤY ĐỀ NGHỊ SỬA HỒ SƠ BỆNH ÁN ĐIỆN TỬ', {
            bold: true,
            fontSize: 15,
            align: 'center',
          }),
          text('h-code', 30, 40, 150, 6, 'Số: {request.code}', { italic: true, align: 'center' }),

          // ---------- Người đề nghị
          text('l-requester', 25, 50, 90, 8, 'Họ và tên người đề nghị: {request.requesterName}', { fontSize: 13 }),
          text('l-title', 115, 50, 70, 8, 'Chức danh: {request.requesterTitle}', { fontSize: 13 }),
          text('l-dept', 25, 58, 160, 8, 'Khoa/Phòng: {request.departmentName}', { fontSize: 13 }),

          // ---------- Người bệnh
          text('sec-patient', 25, 70, 160, 7, 'I. THÔNG TIN NGƯỜI BỆNH', { bold: true, fontSize: 13 }),
          text('l-name', 25, 78, 80, 8, 'Họ và tên: {request.patientName}', { fontSize: 13 }),
          text('l-year', 105, 78, 40, 8, 'Năm sinh: {request.patientBirthYear}', { fontSize: 13 }),
          text('l-gender', 145, 78, 40, 8, 'Giới tính: {request.patientGender}', { fontSize: 13 }),
          text('l-makcb', 25, 86, 80, 8, 'Mã KCB: {request.maKcb}', { fontSize: 13 }),
          text('l-bhyt', 105, 86, 80, 8, 'Mã thẻ BHYT: {request.maTheBhyt}', { fontSize: 13 }),
          text('l-vv', 25, 94, 80, 8, 'Ngày vào viện: {request.ngayVaoVien}', { fontSize: 13 }),
          text('l-rv', 105, 94, 80, 8, 'Ngày ra viện: {request.ngayRaVien}', { fontSize: 13 }),

          // ---------- Nội dung đề nghị
          text('sec-content', 25, 106, 160, 7, 'II. NỘI DUNG ĐỀ NGHỊ SỬA', { bold: true, fontSize: 13 }),
          text('l-reason', 25, 114, 160, 12, '1. Lý do sai: {request.reason}', { fontSize: 13 }),
          text('l-content', 25, 128, 160, 40, '2. Nội dung cần sửa trong HSBA điện tử:\n{request.content}', {
            fontSize: 13,
          }),

          // ---------- Chữ ký
          text('sec-sign', 25, 175, 160, 7, 'III. XÁC NHẬN ĐIỆN TỬ', { bold: true, fontSize: 13 }),
          text('sig-1-title', 15, 185, 45, 6, 'NGƯỜI ĐỀ NGHỊ SỬA HSBA', { bold: true, fontSize: 10, align: 'center' }),
          text('sig-1-name', 15, 202, 45, 6, '{signature.DE_NGHI.fullName}', { fontSize: 11, align: 'center' }),
          text('sig-1-time', 15, 208, 45, 6, '{signature.DE_NGHI.signedAt}', { fontSize: 9, align: 'center' }),

          text('sig-2-title', 63, 185, 45, 6, 'DUYỆT/ TB.KHTH', { bold: true, fontSize: 10, align: 'center' }),
          text('sig-2-name', 63, 202, 45, 6, '{signature.KHTB.fullName}', { fontSize: 11, align: 'center' }),
          text('sig-2-time', 63, 208, 45, 6, '{signature.KHTB.signedAt}', { fontSize: 9, align: 'center' }),

          text('sig-3-title', 111, 185, 45, 6, 'TR.BPBH XÁC NHẬN', { bold: true, fontSize: 10, align: 'center' }),
          text('sig-3-name', 111, 202, 45, 6, '{signature.BAOHIEM.fullName}', { fontSize: 11, align: 'center' }),
          text('sig-3-time', 111, 208, 45, 6, '{signature.BAOHIEM.signedAt}', { fontSize: 9, align: 'center' }),

          text('sig-4-title', 159, 185, 45, 6, 'TC HỦY THANH TOÁN', { bold: true, fontSize: 10, align: 'center' }),
          text('sig-4-name', 159, 202, 45, 6, '{signature.TAICHINH.fullName}', { fontSize: 11, align: 'center' }),
          text('sig-4-time', 159, 208, 45, 6, '{signature.TAICHINH.signedAt}', { fontSize: 9, align: 'center' }),

          text('footer-date', 100, 220, 80, 6, 'Ngày {system.day} tháng {system.month} năm {system.year}', {
            italic: true,
            fontSize: 11,
            align: 'right',
          }),
        ],
      },
    ],
  };
}

/* ---------------------------------------------------------------- Cấu hình mặc định */

export function settingsSeed(): SettingItem[] {
  return defaultSettings();
}

export interface DepartmentSeed {
  code: string;
  name: string;
  shortName: string;
  kind: string;
  parentCode?: string;
  reportCode?: string;
  reportEnabled?: boolean;
}

/** Đơn vị mẫu — người dùng xoá/sửa thoải mái */
export const DEMO_DEPARTMENTS: DepartmentSeed[] = [
  { code: 'VIEN', name: 'Bệnh viện Quân y 4', shortName: 'BVQY4', kind: 'VIEN', reportEnabled: false },
  { code: 'KHOI_NOI', name: 'Khối Nội', shortName: 'K.Nội', kind: 'KHOI', parentCode: 'VIEN', reportEnabled: false },
  { code: 'KHOI_NGOAI', name: 'Khối Ngoại', shortName: 'K.Ngoại', kind: 'KHOI', parentCode: 'VIEN', reportEnabled: false },
  { code: 'KHTB', name: 'Khoa Kế hoạch tổng hợp', shortName: 'K.KHTH', kind: 'PHONG', parentCode: 'VIEN', reportEnabled: false },
  { code: 'KPK', name: 'Khoa Phẫu thuật - Gây mê hồi sức', shortName: 'K.PT-GMHS', kind: 'KHOA', parentCode: 'KHOI_NGOAI', reportCode: 'B4' },
  { code: 'KNGOAI', name: 'Khoa Ngoại tổng hợp', shortName: 'K.Ngoại', kind: 'KHOA', parentCode: 'KHOI_NGOAI', reportCode: 'B4' },
  { code: 'KNOI', name: 'Khoa Nội tổng hợp', shortName: 'K.Nội', kind: 'KHOA', parentCode: 'KHOI_NOI', reportCode: 'B4' },
  { code: 'KNHI', name: 'Khoa Nhi', shortName: 'K.Nhi', kind: 'KHOA', parentCode: 'KHOI_NOI', reportCode: 'B4' },
  { code: 'KSAN', name: 'Khoa Sản', shortName: 'K.Sản', kind: 'KHOA', parentCode: 'KHOI_NOI', reportCode: 'B4' },
  { code: 'KXN', name: 'Khoa Xét nghiệm', shortName: 'K.XN', kind: 'KHOA', parentCode: 'KHOI_NOI', reportCode: 'B5' },
  { code: 'KCDHA', name: 'Khoa Chẩn đoán hình ảnh', shortName: 'K.CĐHA', kind: 'KHOA', parentCode: 'KHOI_NOI', reportCode: 'B5' },
  { code: 'KDUOC', name: 'Khoa Dược', shortName: 'K.Dược', kind: 'KHOA', parentCode: 'VIEN', reportCode: 'B5' },
];

/** Mẫu báo cáo mẫu cho một khoa — minh hoạ cấu trúc động */
export const DEMO_REPORT_TEMPLATE = {
  code: 'BCCT',
  name: 'Báo cáo công tác chuyên môn',
  title: 'BÁO CÁO CÔNG TÁC CHUYÊN MÔN',
  subtitle: '',
  footerNote: '',
  defaultPeriod: 'week',
  columns: [
    { colKey: 'hs', label: 'HS', groupLabel: 'Tổng số', kind: 'INPUT' as const, format: 'integer', summaryKey: '', width: 60, sortOrder: 1 },
    { colKey: 'tq', label: 'TQ', groupLabel: 'Tổng số', kind: 'INPUT' as const, format: 'integer', width: 60, sortOrder: 2 },
    { colKey: 'te', label: 'TE', groupLabel: 'Tổng số', kind: 'INPUT' as const, format: 'integer', width: 60, sortOrder: 3 },
    { colKey: 'tong', label: 'Tổng', groupLabel: 'Tổng số', kind: 'CALC' as const, formula: 'hs+tq+te', format: 'integer', width: 70, sortOrder: 4 },
    { colKey: 'bhyt', label: 'BHYT', groupLabel: 'BHYT', kind: 'INPUT' as const, format: 'integer', width: 65, sortOrder: 5 },
    { colKey: 'vien_phi', label: 'Viện phí', groupLabel: 'BHYT', kind: 'INPUT' as const, format: 'integer', width: 70, sortOrder: 6 },
    { colKey: 'kham', label: 'Khám', groupLabel: 'Chỉ tiêu', kind: 'INPUT' as const, format: 'integer', summaryKey: 'kham', width: 65, sortOrder: 7 },
    { colKey: 'vao', label: 'Vào', groupLabel: 'Chỉ tiêu', kind: 'INPUT' as const, format: 'integer', summaryKey: 'vao', width: 65, sortOrder: 8 },
    { colKey: 'ra', label: 'Ra viện', groupLabel: 'Chỉ tiêu', kind: 'INPUT' as const, format: 'integer', summaryKey: 'ra', width: 70, sortOrder: 9 },
    { colKey: 'tu_vong', label: 'Tử vong', groupLabel: 'Chỉ tiêu', kind: 'INPUT' as const, format: 'integer', summaryKey: 'tu_vong', width: 70, sortOrder: 10 },
    { colKey: 'hien_con', label: 'Hiện còn', groupLabel: 'Chỉ tiêu', kind: 'INPUT' as const, format: 'integer', summaryKey: 'hien_con', width: 75, sortOrder: 11 },
  ],
  sections: [
    {
      title: 'I. Công tác khám bệnh, chữa bệnh',
      sortOrder: 1,
      rows: [
        { rowLabel: 'Khám bệnh', agg: 'SUM' as const, blockLabel: 'Ngoại trú', sortOrder: 1 },
        { rowLabel: 'Vào viện', agg: 'SUM' as const, blockLabel: 'Ngoại trú', sortOrder: 2 },
        { rowLabel: 'Ra viện', agg: 'SUM' as const, blockLabel: 'Ngoại trú', sortOrder: 3 },
        { rowLabel: 'Tử vong', agg: 'SUM' as const, blockLabel: '', sortOrder: 4 },
        { rowLabel: 'Hiện còn', agg: 'LAST' as const, blockLabel: '', sortOrder: 5 },
      ],
    },
    {
      title: 'II. Công tác chuyên môn khác',
      sortOrder: 2,
      rows: [
        { rowLabel: 'Phẫu thuật', agg: 'SUM' as const, blockLabel: '', sortOrder: 1 },
        { rowLabel: 'Thủ thuật', agg: 'SUM' as const, blockLabel: '', sortOrder: 2 },
        { rowLabel: 'Xét nghiệm', agg: 'SUM' as const, blockLabel: '', sortOrder: 3 },
        { rowLabel: 'Chẩn đoán hình ảnh', agg: 'SUM' as const, blockLabel: '', sortOrder: 4 },
      ],
    },
  ],
};

/** Chức danh mặc định — chỉ thêm khi danh mục còn trống (quản trị sửa/xoá tự do) */
export const DEFAULT_JOB_TITLES: { code: string; name: string }[] = [
  { code: 'BS', name: 'Bác sĩ' },
  { code: 'DD', name: 'Điều dưỡng' },
  { code: 'KTV', name: 'Kỹ thuật viên' },
  { code: 'DS', name: 'Dược sĩ' },
  { code: 'HS', name: 'Hộ sinh' },
  { code: 'KT', name: 'Kế toán' },
  { code: 'NV', name: 'Nhân viên' },
];

/* ============================ LỊCH TRỰC: DANH MỤC MẶC ĐỊNH ============================
 * Chỉ là giá trị khởi đầu — quản trị có thể sửa/tắt trong màn "Danh mục" của Lịch trực.
 * Ca đêm (D) để tắt sẵn; bật khi phòng khám có trực đêm. */
export const DEFAULT_DUTY_ROOMS: { code: string; name: string; sortOrder: number }[] = Array.from({ length: 15 }, (_, i) => ({
  code: `P${i + 1}`,
  name: `Phòng khám số ${i + 1}`,
  sortOrder: i + 1,
}));

export const DEFAULT_DUTY_SHIFTS: {
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  isNight: boolean;
  color: string;
  sortOrder: number;
  active: boolean;
}[] = [
  { code: 'S', name: 'Ca sáng', startTime: '07:00', endTime: '12:00', isNight: false, color: '#0F766E', sortOrder: 1, active: true },
  { code: 'C', name: 'Ca chiều', startTime: '12:00', endTime: '17:00', isNight: false, color: '#0369A1', sortOrder: 2, active: true },
  { code: 'CD', name: 'Cả ngày', startTime: '07:00', endTime: '17:00', isNight: false, color: '#15803D', sortOrder: 3, active: true },
  { code: 'D', name: 'Ca đêm', startTime: '17:00', endTime: '07:00', isNight: true, color: '#4338CA', sortOrder: 4, active: false },
];

export const DEFAULT_DUTY_ROLES: { code: string; name: string; requiredTitle: string; sortOrder: number }[] = [
  { code: 'BS', name: 'Bác sĩ trực', requiredTitle: 'Bác sĩ', sortOrder: 1 },
  { code: 'DD', name: 'Điều dưỡng trực', requiredTitle: 'Điều dưỡng', sortOrder: 2 },
];
