/**
 * Sổ đăng ký trường lọc nâng cao.
 *
 * Mỗi tài nguyên (nguồn danh sách) khai báo các trường có thể lọc kèm kiểu dữ liệu và
 * toán tử cho phép. Nhờ vậy giao diện tự dựng thanh lọc nâng cao từ API
 * (`GET /meta/filters[/:resource]`) — thêm trường lọc mới không phải sửa mã giao diện.
 *
 * LƯU Ý: danh sách này phải khớp với các nhánh xử lý bộ lọc trong service tương ứng.
 */
export interface FilterFieldSpec {
  /** Tên trường dùng trong chuỗi filters */
  field: string;
  label: string;
  /** text | number | date | datetime | bool | enum */
  type: 'text' | 'number' | 'date' | 'datetime' | 'bool' | 'enum';
  /** Toán tử mặc định khi người dùng thêm điều kiện */
  defaultOp?: string;
  /** Các toán tử cho phép */
  ops?: string[];
  /** Danh sách giá trị cho kiểu enum */
  options?: { value: string; label: string }[];
  /** Nguồn giá trị động (giao diện tự tải danh sách) */
  optionsSource?: 'departments' | 'roles' | 'users' | 'hsbaWorkflows' | 'patients';
  group?: string;
  hint?: string;
}

export interface ResourceFilterSpec {
  resource: string;
  label: string;
  /** Endpoint danh sách tương ứng */
  path: string;
  fields: FilterFieldSpec[];
}

const OPS_TEXT = ['like', 'eq', 'ne', 'isnull', 'notnull'];
const OPS_EXACT = ['eq', 'ne', 'isnull', 'notnull'];
const OPS_ENUM = ['eq', 'ne', 'in', 'nin'];
const OPS_NUM = ['gte', 'lte', 'gt', 'lt', 'eq', 'ne'];

const STATUS_OPTIONS = [
  { value: 'CHO_DE_NGHI', label: 'Chờ đề nghị' },
  { value: 'CHO_KHTB', label: 'Chờ Kế hoạch tổng hợp' },
  { value: 'CHO_TAICHINH', label: 'Chờ Tài chính' },
  { value: 'HOAN_TAT', label: 'Hoàn tất' },
  { value: 'TRA_LAI', label: 'Bị trả lại' },
  { value: 'DA_HUY', label: 'Đã huỷ' },
];

const PRIORITY_OPTIONS = [
  { value: 'LOW', label: 'Thấp' },
  { value: 'NORMAL', label: 'Bình thường' },
  { value: 'HIGH', label: 'Cao' },
  { value: 'URGENT', label: 'Khẩn' },
];

const RESOURCES: ResourceFilterSpec[] = [
  {
    resource: 'hsba',
    label: 'Phiếu đề nghị sửa HSBA',
    path: '/hsba/requests',
    fields: [
      {
        field: 'code',
        label: 'Số phiếu',
        type: 'text',
        defaultOp: 'like',
        ops: OPS_TEXT,
        group: 'Thông tin phiếu',
      },
      {
        field: 'patientName',
        label: 'Họ tên người bệnh',
        type: 'text',
        defaultOp: 'like',
        ops: OPS_TEXT,
        group: 'Người bệnh',
      },
      { field: 'maKcb', label: 'Mã KCB', type: 'text', defaultOp: 'like', ops: OPS_TEXT, group: 'Người bệnh' },
      { field: 'maTheBhyt', label: 'Mã thẻ BHYT', type: 'text', defaultOp: 'like', ops: OPS_TEXT, group: 'Người bệnh' },
      { field: 'patientGender', label: 'Giới tính', type: 'text', defaultOp: 'eq', ops: OPS_EXACT, group: 'Người bệnh' },
      {
        field: 'patientBirthYear',
        label: 'Năm sinh',
        type: 'number',
        defaultOp: 'gte',
        ops: OPS_NUM,
        group: 'Người bệnh',
      },
      { field: 'status', label: 'Trạng thái', type: 'enum', defaultOp: 'eq', ops: OPS_ENUM, options: STATUS_OPTIONS, group: 'Xử lý' },
      { field: 'priority', label: 'Mức ưu tiên', type: 'enum', defaultOp: 'eq', ops: OPS_ENUM, options: PRIORITY_OPTIONS, group: 'Xử lý' },
      {
        field: 'departmentId',
        label: 'Khoa đề nghị',
        type: 'number',
        defaultOp: 'eq',
        ops: OPS_EXACT,
        optionsSource: 'departments',
        group: 'Xử lý',
      },
      {
        field: 'workflowId',
        label: 'Quy trình ký',
        type: 'number',
        defaultOp: 'eq',
        ops: OPS_EXACT,
        optionsSource: 'hsbaWorkflows',
        group: 'Xử lý',
      },
      { field: 'pendingStepKey', label: 'Bước đang chờ', type: 'text', defaultOp: 'eq', ops: OPS_EXACT, group: 'Xử lý' },
      {
        field: 'returnCount',
        label: 'Số lần bị trả lại',
        type: 'number',
        defaultOp: 'gte',
        ops: OPS_NUM,
        group: 'Xử lý',
      },
      { field: 'amount', label: 'Số tiền', type: 'number', defaultOp: 'gte', ops: OPS_NUM, group: 'Xử lý', hint: 'Giá trị lưu dạng chuỗi, hệ thống tự tách số' },
      { field: 'doiTuong', label: 'Đối tượng thanh toán', type: 'text', defaultOp: 'like', ops: OPS_TEXT, group: 'Xử lý' },
      { field: 'createdBy', label: 'Người tạo (ID)', type: 'number', defaultOp: 'eq', ops: OPS_EXACT, optionsSource: 'users', group: 'Người tạo' },
      { field: 'requesterId', label: 'Người đề nghị (ID)', type: 'number', defaultOp: 'eq', ops: OPS_EXACT, optionsSource: 'users', group: 'Người tạo' },
    ],
  },
  {
    resource: 'report-entries',
    label: 'Nhật ký sửa số liệu báo cáo',
    path: '/reports/entries/history',
    fields: [
      { field: 'rowId', label: 'ID dòng', type: 'number', defaultOp: 'eq', ops: OPS_EXACT },
      { field: 'colKey', label: 'Mã cột', type: 'text', defaultOp: 'eq', ops: OPS_EXACT },
      {
        field: 'action',
        label: 'Hành động',
        type: 'enum',
        defaultOp: 'eq',
        ops: OPS_ENUM,
        options: [
          { value: 'CREATE', label: 'Thêm mới' },
          { value: 'UPDATE', label: 'Cập nhật' },
          { value: 'DELETE', label: 'Xoá' },
        ],
      },
      { field: 'userId', label: 'Người thao tác', type: 'number', defaultOp: 'eq', ops: OPS_EXACT, optionsSource: 'users' },
    ],
  },
  {
    resource: 'print-templates',
    label: 'Mẫu in',
    path: '/print/templates',
    fields: [
      { field: 'module', label: 'Phân hệ', type: 'text', defaultOp: 'eq', ops: OPS_EXACT },
      { field: 'docType', label: 'Loại chứng từ', type: 'text', defaultOp: 'eq', ops: OPS_EXACT },
      { field: 'paperSize', label: 'Khổ giấy', type: 'text', defaultOp: 'eq', ops: OPS_EXACT },
      { field: 'active', label: 'Đang ban hành', type: 'bool', defaultOp: 'eq', ops: ['eq'] },
      {
        field: 'departmentId',
        label: 'Khoa áp dụng',
        type: 'number',
        defaultOp: 'eq',
        ops: OPS_EXACT,
        optionsSource: 'departments',
      },
    ],
  },
  {
    resource: 'users',
    label: 'Người dùng',
    path: '/users',
    fields: [
      { field: 'manv', label: 'MANV', type: 'text', defaultOp: 'like', ops: OPS_TEXT },
      { field: 'username', label: 'Tên đăng nhập', type: 'text', defaultOp: 'like', ops: OPS_TEXT },
      { field: 'fullName', label: 'Họ tên', type: 'text', defaultOp: 'like', ops: OPS_TEXT },
      { field: 'title', label: 'Chức danh', type: 'text', defaultOp: 'like', ops: OPS_TEXT },
      { field: 'active', label: 'Đang hoạt động', type: 'bool', defaultOp: 'eq', ops: ['eq'] },
    ],
  },
  {
    resource: 'roles',
    label: 'Vai trò',
    path: '/roles',
    fields: [
      {
        field: 'dataScope',
        label: 'Phạm vi dữ liệu',
        type: 'enum',
        defaultOp: 'eq',
        ops: OPS_ENUM,
        options: [
          { value: 'OWN', label: 'Chỉ của mình' },
          { value: 'DEPT', label: 'Theo khoa' },
          { value: 'ALL', label: 'Toàn viện' },
        ],
      },
      { field: 'isSystem', label: 'Vai trò hệ thống', type: 'bool', defaultOp: 'eq', ops: ['eq'] },
      { field: 'active', label: 'Đang hoạt động', type: 'bool', defaultOp: 'eq', ops: ['eq'] },
    ],
  },
  {
    resource: 'departments',
    label: 'Khoa / Phòng',
    path: '/departments',
    fields: [
      { field: 'code', label: 'Mã khoa', type: 'text', defaultOp: 'like', ops: OPS_TEXT },
      { field: 'name', label: 'Tên khoa', type: 'text', defaultOp: 'like', ops: OPS_TEXT },
      {
        field: 'kind',
        label: 'Loại đơn vị',
        type: 'enum',
        defaultOp: 'eq',
        ops: OPS_ENUM,
        options: [
          { value: 'KHOA', label: 'Khoa' },
          { value: 'PHONG', label: 'Phòng' },
          { value: 'BAN', label: 'Ban' },
          { value: 'TRUNG_TAM', label: 'Trung tâm' },
        ],
      },
      { field: 'active', label: 'Đang hoạt động', type: 'bool', defaultOp: 'eq', ops: ['eq'] },
    ],
  },
  {
    resource: 'utilities',
    label: 'Tiện ích',
    path: '/utilities',
    fields: [
      {
        field: 'kind',
        label: 'Loại tiện ích',
        type: 'enum',
        defaultOp: 'eq',
        ops: OPS_ENUM,
        options: [
          { value: 'BUILTIN', label: 'Có sẵn' },
          { value: 'FORM', label: 'Biểu mẫu' },
          { value: 'REPORT', label: 'Báo cáo' },
          { value: 'LINK', label: 'Liên kết' },
          { value: 'IFRAME', label: 'Nhúng trang' },
        ],
      },
      {
        field: 'placement',
        label: 'Vị trí hiển thị',
        type: 'enum',
        defaultOp: 'eq',
        ops: OPS_ENUM,
        options: [
          { value: 'sidebar', label: 'Menu bên' },
          { value: 'dashboard', label: 'Bảng điều khiển' },
          { value: 'both', label: 'Cả hai' },
        ],
      },
      { field: 'active', label: 'Đang hoạt động', type: 'bool', defaultOp: 'eq', ops: ['eq'] },
    ],
  },
  {
    resource: 'audit',
    label: 'Nhật ký hệ thống',
    path: '/audit',
    fields: [
      {
        field: 'module',
        label: 'Phân hệ',
        type: 'text',
        defaultOp: 'eq',
        ops: OPS_EXACT,
        hint: 'AUTH, HSBA, REPORT, USER, ROLE, DEPARTMENT, PRINT, SYSTEM…',
      },
      {
        field: 'action',
        label: 'Hành động',
        type: 'text',
        defaultOp: 'eq',
        ops: OPS_EXACT,
        hint: 'CREATE, UPDATE, DELETE, LOGIN, LOGOUT, UNLOCK…',
      },
      { field: 'entity', label: 'Đối tượng', type: 'text', defaultOp: 'like', ops: OPS_TEXT },
      { field: 'username', label: 'Tài khoản', type: 'text', defaultOp: 'like', ops: OPS_TEXT },
      { field: 'userId', label: 'Người dùng (ID)', type: 'number', defaultOp: 'eq', ops: OPS_EXACT, optionsSource: 'users' },
    ],
  },
];

const BY_RESOURCE = new Map(RESOURCES.map((r) => [r.resource, r]));

export function listFilterResources(): ResourceFilterSpec[] {
  return RESOURCES;
}

export function getFilterSpec(resource: string): ResourceFilterSpec | undefined {
  return BY_RESOURCE.get(resource);
}

/** Toán tử hợp lệ theo kiểu dữ liệu — dùng để giao diện gợi ý */
export const OPERATOR_LABELS: Record<string, string> = {
  eq: 'bằng',
  ne: 'khác',
  gt: 'lớn hơn',
  gte: 'từ … trở lên',
  lt: 'nhỏ hơn',
  lte: 'từ … trở xuống',
  like: 'chứa',
  in: 'thuộc danh sách',
  nin: 'không thuộc danh sách',
  isnull: 'rỗng',
  notnull: 'có giá trị',
};
