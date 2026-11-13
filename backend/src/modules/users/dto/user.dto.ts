import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { AdvancedQueryDto, toBoolean } from '../../../common/dto/query.dto';

/**
 * Ô để trống trên form gửi lên chuỗi rỗng "" — coi như KHÔNG nhập (IsOptional chỉ bỏ qua
 * null/undefined, nên trước đây "" bị IsEmail/MinLength báo lỗi và không lưu được).
 */
const emptyToUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const v = value.trim();
  return v === '' ? undefined : v;
};
/** Ô chọn khoa để trống → bỏ khoa (null) */
const emptyToNull = ({ value }: { value: unknown }) =>
  value === '' || value === 0 || value === '0' || (typeof value === 'number' && Number.isNaN(value)) ? null : value;
/** Cắt khoảng trắng; giữ nguyên "" để khi sửa có thể xoá giá trị cũ */
const trimString = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Chỉ kiểm tra định dạng khi có nhập */
const hasValue = (v: unknown) => v !== undefined && v !== null && v !== '';

export class CreateUserDto {
  @ApiProperty({ example: 'bs.nguyenvan.a' })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập tên đăng nhập' })
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._-]+$/, { message: 'Tên đăng nhập chỉ gồm chữ, số, dấu chấm, gạch ngang, gạch dưới' })
  username!: string;

  @ApiProperty({ example: 'bsng', description: 'Mã nhân viên liên thông; phải nhập khi thêm người dùng mới.' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập MANV' })
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._-]+$/, { message: 'MANV chỉ gồm chữ, số, dấu chấm, gạch ngang hoặc gạch dưới' })
  manv!: string;

  @ApiProperty({ example: 'Nguyễn Văn A' })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập họ tên' })
  @MaxLength(128)
  fullName!: string;

  @ApiPropertyOptional({ description: 'Mật khẩu (bỏ trống sẽ dùng mật khẩu mặc định; độ dài tối thiểu theo cấu hình hệ thống)' })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Vui lòng nhập mật khẩu' })
  password?: string;

  @ApiPropertyOptional({ example: 'Bác sĩ', description: 'Chức danh chuyên môn; dùng để xét điều kiện xếp lịch khám.' })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  title?: string;

  /** Tương thích API/tệp cũ: tên chức vụ sẽ được đưa vào danh mục và liên kết chuẩn. */
  @ApiPropertyOptional({ example: 'Chủ nhiệm khoa', description: 'Tên chức vụ quản lý/kiêm nhiệm theo API cũ; ưu tiên managementPositionIds cho API mới.' })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(512)
  managementPosition?: string;

  @ApiPropertyOptional({ example: [1, 2], description: 'Danh sách chức vụ quản lý/kiêm nhiệm từ danh mục; một người có thể kiêm nhiều chức vụ.' })
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  managementPositionIds?: number[];

  @ApiPropertyOptional({ description: 'Không bắt buộc' })
  @Transform(trimString)
  @ValidateIf((o: { email?: unknown }) => hasValue(o.email))
  @IsEmail({}, { message: 'Thư điện tử không hợp lệ (ví dụ đúng: ten@benhvien.vn) — có thể để trống' })
  email?: string;

  @ApiPropertyOptional({ description: 'Không bắt buộc' })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(32, { message: 'Số điện thoại tối đa 32 ký tự' })
  phone?: string;

  @ApiPropertyOptional({ description: 'Khoa công tác chính' })
  @Transform(emptyToNull)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  departmentId?: number | null;

  /** Ngày bắt đầu làm việc tại khoa mới khi chuyển khoa; chỉ dùng khi khoa công tác thay đổi. */
  @ApiPropertyOptional({ description: 'Ngày hiệu lực chuyển khoa, định dạng YYYY-MM-DD' })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsDateString()
  departmentEffectiveFrom?: string;

  @ApiPropertyOptional({ description: 'Danh sách mã vai trò', example: ['NHAP_LIEU'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roleCodes?: string[];

  @ApiPropertyOptional({ description: 'Các khoa được phép truy cập thêm' })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  departmentScopeIds?: number[];

  @ApiPropertyOptional({ description: 'Bắt buộc đổi mật khẩu lần đăng nhập tới' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  mustChangePassword?: boolean;

  @ApiPropertyOptional({ description: 'Không bắt buộc' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;
}

export class UpdateUserDto extends PartialType(CreateUserDto) {}

export class UserQueryDto extends AdvancedQueryDto {
  @ApiPropertyOptional({ description: 'Lọc theo khoa' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  departmentId?: number;

  @ApiPropertyOptional({ description: 'Lọc theo mã vai trò' })
  @IsOptional()
  @IsString()
  roleCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;
}

export class ResetPasswordDto {
  @ApiPropertyOptional({ description: 'Mật khẩu mới (bỏ trống = mặc định "1"; độ dài tối thiểu theo cấu hình hệ thống)' })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Vui lòng nhập mật khẩu mới' })
  newPassword?: string;

  @ApiPropertyOptional({ description: 'Bắt buộc người dùng đổi mật khẩu sau khi đăng nhập' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  forceChange?: boolean;
}

export class SetRolesDto {
  @ApiProperty({ description: 'Danh sách mã vai trò', example: ['NHAP_LIEU', 'KHTB'] })
  @IsArray()
  @IsString({ each: true })
  roleCodes!: string[];

  @ApiPropertyOptional({ description: 'Thay thế toàn bộ (true) hay chỉ thêm (false)', default: true })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  replace?: boolean;
}

export class SetDepartmentScopesDto {
  @ApiProperty({ description: 'Danh sách id khoa được phép truy cập' })
  @IsArray()
  @IsInt({ each: true })
  departmentIds!: number[];
}

export class ImportUsersDto {
  @ApiProperty({ description: 'Dữ liệu người dùng nhập từ Excel/JSON' })
  @IsArray()
  rows!: Record<string, unknown>[];

  @ApiPropertyOptional({ description: 'Ghi đè nếu tên đăng nhập đã tồn tại' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  overwrite?: boolean;

  @ApiPropertyOptional({ description: 'Chạy thử, không ghi vào CSDL' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({ description: 'Tự thêm chức danh chưa có vào danh mục' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  addTitles?: boolean;
}
