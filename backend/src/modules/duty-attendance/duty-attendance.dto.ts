import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

const COLUMN_KEY = /^[A-Z][A-Z0-9_]{0,31}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export class AttendanceMonthQueryDto {
  @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Tháng phải có dạng YYYY-MM' })
  month!: string;
  /** Tương thích liên kết cũ chỉ chọn một khoa. */
  @IsOptional() @Type(() => Number) @IsInt()
  departmentId?: number;
  /** Vai trò phạm vi Toàn viện có thể chọn một hay nhiều khoa; vai trò phạm vi khoa luôn bị ép về khoa được gán. */
  @IsOptional() @Transform(({ value }) => value === undefined ? undefined : (Array.isArray(value) ? value : [value]).map(Number)) @IsArray() @ArrayMaxSize(500) @IsInt({ each: true })
  departmentIds?: number[];
  /** Chỉ dùng khi xuất Excel: thêm dòng ghi chú theo ngày cho nhân viên có ghi chú. */
  @IsOptional() @Transform(({ value }) => value === true || value === 'true' || value === '1') @IsBoolean()
  includeDailyNotes?: boolean;
}
export class AttendanceEntryDto {
  @IsInt() userId!: number;
  @IsDateString() workDate!: string;
  /** Tương thích API cũ: một mã; gửi rỗng/null để xóa khi không truyền codes. */
  @IsOptional() @IsString() @MaxLength(16) code?: string | null;
  /** Danh sách mã ký hiệu của cùng một ngày; truyền [] để bỏ tất cả ký hiệu. */
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(16, { each: true }) codes?: string[];
  /** Ghi chú độc lập của nhân viên trong ngày; có thể tồn tại khi không có ký hiệu. */
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
export class SaveAttendanceEntriesDto {
  /** Vai trò phạm vi Toàn viện mới dùng trường này để chọn khoa cần chấm công. */
  @IsOptional() @Type(() => Number) @IsInt()
  departmentId?: number;
  @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => AttendanceEntryDto)
  entries!: AttendanceEntryDto[];
}
export class AttendanceManualValueDto {
  @IsInt() userId!: number;
  @IsInt() columnId!: number;
  /** Rỗng/null sẽ xóa giá trị tự nhập, công thức không bao giờ được ghi trực tiếp. */
  @IsOptional() @IsString() @MaxLength(200) value?: string | null;
}
export class SaveAttendanceManualValuesDto {
  @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Tháng phải có dạng YYYY-MM' }) month!: string;
  @IsOptional() @Type(() => Number) @IsInt() departmentId?: number;
  @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => AttendanceManualValueDto)
  values!: AttendanceManualValueDto[];
}
export class AttendanceCodeGroupDto {
  @IsString() @IsNotEmpty() @MaxLength(32) @Matches(COLUMN_KEY) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class AttendanceCodeDto {
  @IsString() @IsNotEmpty() @MaxLength(16) @Matches(/^[A-Za-z0-9_.-]+$/) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(32) group!: string;
  @IsOptional() @IsString() @Matches(HEX_COLOR) color?: string;
  /** Thuộc tính cũ, giữ nhận API để tương thích dữ liệu đã có. */
  @IsOptional() @IsBoolean() countsAsDuty?: boolean;
  /** Thuộc tính cũ, giữ nhận API để tương thích dữ liệu đã có. */
  @IsOptional() @IsBoolean() showSummary?: boolean;
  @IsOptional() @IsString() @Matches(/^\d+(?:[.,]\d+)?$/, { message: 'Giá trị đếm phải là số không âm, ví dụ 1 hoặc 0.5' }) countValue?: string;
  /** NONE | DUTY (trực) | REINFORCEMENT (tăng cường) | REST (nghỉ bù). */
  @IsOptional() @IsIn(['NONE', 'DUTY', 'REINFORCEMENT', 'REST']) calculationRole?: 'NONE' | 'DUTY' | 'REINFORCEMENT' | 'REST';
  /** Trừ countValue khỏi SYS_NGAY_CONG khi ký hiệu được nhập vào ngày làm việc. */
  @IsOptional() @IsBoolean() deductsWorkday?: boolean;
  /** Trường cũ, giữ để tương thích API: nghỉ bù nay trừ theo số lượng vào tổng ca Trực tích lũy. */
  @IsOptional() @IsIn(['ANY_DUTY', 'DUTY', 'REINFORCEMENT']) restSource?: 'ANY_DUTY' | 'DUTY' | 'REINFORCEMENT';
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class AttendanceSectionDto {
  @IsString() @IsNotEmpty() @MaxLength(32) @Matches(COLUMN_KEY) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  /** Chỉ CUSTOM được tạo mới từ giao diện. Loại hệ thống được tạo bởi migration. */
  @IsOptional() @IsIn(['ADMIN', 'DAYS', 'SYMBOLS', 'REPORT', 'CUSTOM']) kind?: 'ADMIN' | 'DAYS' | 'SYMBOLS' | 'REPORT' | 'CUSTOM';
  @IsOptional() @IsString() @Matches(HEX_COLOR) color?: string;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class AttendanceColumnDto {
  @Type(() => Number) @IsInt() sectionId!: number;
  /** Nhóm tiêu đề trực tiếp chứa cột; null/0 = ngay dưới phần. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) groupId?: number | null;
  @IsString() @IsNotEmpty() @MaxLength(32) @Matches(COLUMN_KEY) key!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsIn(['FORMULA', 'MANUAL']) columnType!: 'FORMULA' | 'MANUAL';
  @IsOptional() @IsIn(['NUMBER', 'TEXT']) dataType?: 'NUMBER' | 'TEXT';
  @IsOptional() @IsString() @MaxLength(500) formula?: string;
  @IsOptional() @IsString() @MaxLength(80) placeholder?: string;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
/** Nhóm tiêu đề cột nhiều tầng (chỉ thuộc phần Báo cáo/phần tự tạo). */
export class AttendanceColumnGroupDto {
  @Type(() => Number) @IsInt() sectionId!: number;
  /** Nhóm cha; null/0 = nhóm cấp 1 ngay dưới phần. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) parentId?: number | null;
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  /** Rỗng = nền nhạt mặc định. */
  @IsOptional() @IsString() @Matches(/^(#[0-9a-fA-F]{6})?$/) color?: string;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  /** Khi gửi: đúng danh sách cột thuộc trực tiếp nhóm này (cột bỏ chọn về ngay dưới phần). */
  @IsOptional() @IsArray() @ArrayMaxSize(500) @Type(() => Number) @IsInt({ each: true }) columnIds?: number[];
}
export class ColumnKeyReplacementDto {
  @IsString() @IsNotEmpty() @MaxLength(32) from!: string;
  @IsString() @MaxLength(32) to!: string;
}
export class DuplicateAttendanceColumnGroupDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) parentId?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ColumnKeyReplacementDto) replacements?: ColumnKeyReplacementDto[];
}
export class AttendanceValidationDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(500) expression!: string;
  @IsOptional() @IsString() @MaxLength(300) message?: string;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class AttendanceHolidayDto {
  @IsDateString() holidayDate!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class AttendanceWorkdayOverrideDto {
  @IsDateString() workDate!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
/** Ngày do thông báo từng năm quyết định thêm vào lịch nghỉ hoặc lịch làm bù. */
export class NationalHolidayPlanAdjustmentDto {
  @IsDateString() date!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/** Phương án năm để tạo dự thảo ngày lễ Nhà nước; chỉ áp dụng sau khi quản trị viên xác nhận. */
export class NationalHolidayPlanDto {
  @Type(() => Number) @IsInt() @Min(1900) @Max(2100) year!: number;
  /** Mốc ngày đầu đợt Tết so với mùng 1 âm lịch; phải đối chiếu quyết định hằng năm. */
  @Type(() => Number) @IsInt() @Min(-10) @Max(10) tetStartOffset!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(10) tetDayCount!: number;
  @IsIn(['BEFORE', 'AFTER']) nationalDayAdjacent!: 'BEFORE' | 'AFTER';
  @IsBoolean() compensateWeeklyRest!: boolean;
  /** Ngày nghỉ kéo dài/nghỉ bù được cơ quan có thẩm quyền công bố riêng cho năm. */
  @IsOptional() @IsArray() @ArrayMaxSize(31) @ValidateNested({ each: true }) @Type(() => NationalHolidayPlanAdjustmentDto)
  additionalRestDays?: NationalHolidayPlanAdjustmentDto[];
  /** Ngày làm bù, thường rơi vào cuối tuần, phải được tính như ngày làm việc. */
  @IsOptional() @IsArray() @ArrayMaxSize(31) @ValidateNested({ each: true }) @Type(() => NationalHolidayPlanAdjustmentDto)
  compensatoryWorkdays?: NationalHolidayPlanAdjustmentDto[];
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class NationalHolidayPlanQueryDto {
  @Type(() => Number) @IsInt() @Min(1900) @Max(2100) year!: number;
}
