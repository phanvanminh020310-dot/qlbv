import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';

const COLUMN_KEY = /^[A-Z][A-Z0-9_]{0,31}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export class AttendanceMonthQueryDto {
  @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Tháng phải có dạng YYYY-MM' })
  month!: string;
  /** Vai trò phạm vi Toàn viện có thể chọn khoa khác; vai trò phạm vi khoa luôn bị ép về khoa được gán. */
  @IsOptional() @Type(() => Number) @IsInt()
  departmentId?: number;
}
export class AttendanceEntryDto {
  @IsInt() userId!: number;
  @IsDateString() workDate!: string;
  /** null hoặc rỗng: xóa ô chấm công */
  @IsOptional() @IsString() @MaxLength(16) code?: string | null;
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
  @IsString() @IsNotEmpty() @MaxLength(32) @Matches(COLUMN_KEY) key!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsIn(['FORMULA', 'MANUAL']) columnType!: 'FORMULA' | 'MANUAL';
  @IsOptional() @IsIn(['NUMBER', 'TEXT']) dataType?: 'NUMBER' | 'TEXT';
  @IsOptional() @IsString() @MaxLength(500) formula?: string;
  @IsOptional() @IsString() @MaxLength(80) placeholder?: string;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
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
