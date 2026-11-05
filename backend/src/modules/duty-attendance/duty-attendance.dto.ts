import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';

export class AttendanceMonthQueryDto {
  @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Tháng phải có dạng YYYY-MM' })
  month!: string;
}
export class AttendanceEntryDto {
  @IsInt() userId!: number;
  @IsDateString() workDate!: string;
  /** null hoặc rỗng: xóa ô chấm công */
  @IsOptional() @IsString() @MaxLength(16) code?: string | null;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
export class SaveAttendanceEntriesDto {
  @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => AttendanceEntryDto)
  entries!: AttendanceEntryDto[];
}
export class AttendanceCodeDto {
  @IsString() @IsNotEmpty() @MaxLength(16) @Matches(/^[A-Za-z0-9_.-]+$/) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(32) group!: string;
  @IsOptional() @IsString() @Matches(/^#[0-9a-fA-F]{6}$/) color?: string;
  @IsOptional() @IsBoolean() countsAsDuty?: boolean;
  @IsOptional() @IsBoolean() showSummary?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class AttendanceHolidayDto {
  @IsDateString() holidayDate!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
