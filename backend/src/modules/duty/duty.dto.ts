import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AdvancedQueryDto, toBoolean } from '../../common/dto/query.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndef = ({ value }: { value: unknown }) => (value === '' || value === null ? undefined : value);
const toIntOrUndef = ({ value }: { value: unknown }) =>
  value === '' || value === null || value === undefined ? undefined : Number(value);

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

export const ABSENCE_REASONS = ['PHEP_NAM', 'OM_DAU', 'HOC_TAP', 'CONG_TAC', 'KHAC'] as const;

/* ------------------------------------------------------------------ Danh mục */

export class RoomDto {
  @ApiProperty({ example: 'P1' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập mã phòng khám' })
  @MaxLength(16)
  @Matches(/^[A-Za-z0-9_.-]+$/, { message: 'Mã phòng chỉ gồm chữ, số, dấu chấm, gạch ngang, gạch dưới' })
  code!: string;

  @ApiProperty({ example: 'Phòng khám số 1' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập tên phòng khám' })
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? null : Number(value)))
  @IsInt()
  departmentId?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toIntOrUndef)
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
export class UpdateRoomDto extends PartialType(RoomDto) {}

export class ShiftDto {
  @ApiProperty({ example: 'S' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập mã ca' })
  @MaxLength(16)
  @Matches(/^[A-Za-z0-9_.-]+$/, { message: 'Mã ca chỉ gồm chữ, số, dấu chấm, gạch ngang, gạch dưới' })
  code!: string;

  @ApiProperty({ example: 'Ca sáng' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập tên ca' })
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: '07:00' })
  @Transform(trim)
  @Matches(HHMM, { message: 'Giờ bắt đầu phải dạng HH:MM' })
  startTime!: string;

  @ApiProperty({ example: '12:00' })
  @Transform(trim)
  @Matches(HHMM, { message: 'Giờ kết thúc phải dạng HH:MM' })
  endTime!: string;

  @ApiPropertyOptional({ description: 'Bỏ trống → hệ thống tự nhận diện theo khung 22:00–06:00' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isNight?: boolean;

  @ApiPropertyOptional({ example: '#0ea5e9' })
  @IsOptional()
  @Matches(HEX, { message: 'Màu phải dạng #RRGGBB' })
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toIntOrUndef)
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
export class UpdateShiftDto extends PartialType(ShiftDto) {}

export class RoleDto {
  @ApiProperty({ example: 'BS' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập mã vai trò trực' })
  @MaxLength(16)
  @Matches(/^[A-Za-z0-9_.-]+$/, { message: 'Mã vai trò chỉ gồm chữ, số, dấu chấm, gạch ngang, gạch dưới' })
  code!: string;

  @ApiProperty({ example: 'Bác sĩ trực' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập tên vai trò trực' })
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ description: 'Chức danh bắt buộc (khớp danh mục chức danh). Bỏ trống = không yêu cầu' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  requiredTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toIntOrUndef)
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
export class UpdateRoleDto extends PartialType(RoleDto) {}

export class ClosedDayDto {
  @ApiProperty({ example: '2026-09-02' })
  @Matches(YMD, { message: 'Ngày phải dạng YYYY-MM-DD' })
  date!: string;

  @ApiProperty({ example: 'Quốc khánh' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập tên ngày nghỉ' })
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
export class UpdateClosedDayDto extends PartialType(ClosedDayDto) {}

export class CatalogQueryDto extends AdvancedQueryDto {}

/* ------------------------------------------------------------------ Kỳ lịch */

export class RulesDto {
  @IsOptional() @Transform(toIntOrUndef) @IsInt() @Min(0) @Max(10) maxShiftsPerDay?: number;
  @IsOptional() @Transform(toIntOrUndef) @IsInt() @Min(0) @Max(500) maxShiftsPerPeriod?: number;
  @IsOptional() @Transform(toIntOrUndef) @IsInt() @Min(0) @Max(500) maxNightShiftsPerPeriod?: number;
  @IsOptional() @Transform(toIntOrUndef) @Min(0) @Max(24) maxHoursPerDay?: number;
  @IsOptional() @Transform(toIntOrUndef) @Min(0) @Max(168) maxHoursPerWeek?: number;
  @IsOptional() @Transform(toIntOrUndef) @Min(0) @Max(72) minRestHours?: number;
  @IsOptional() @IsIn(['CHO_PHEP', 'CANH_BAO', 'CHAN']) crossDeptPolicy?: 'CHO_PHEP' | 'CANH_BAO' | 'CHAN';
  @IsOptional() @IsBoolean() allowSelfRegister?: boolean;
  @IsOptional() @IsBoolean() swapNeedsApproval?: boolean;
  @IsOptional() @IsBoolean() requireFullBeforePublish?: boolean;
}

export class PeriodDto {
  @ApiProperty({ example: 'Tuần 5/10 – 11/10/2026' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập tên kỳ lịch' })
  @MaxLength(160)
  name!: string;

  @ApiProperty({ example: '2026-10-05' })
  @Matches(YMD, { message: 'Ngày bắt đầu phải dạng YYYY-MM-DD' })
  startDate!: string;

  @ApiProperty({ example: '2026-10-11' })
  @Matches(YMD, { message: 'Ngày kết thúc phải dạng YYYY-MM-DD' })
  endDate!: string;

  @ApiProperty({ description: 'Thời điểm chốt lịch (ISO 8601, ví dụ 2026-10-01T17:00:00+07:00)' })
  @IsDateString({}, { message: 'Thời điểm chốt không hợp lệ' })
  lockAt!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(emptyToUndef)
  @IsDateString({}, { message: 'Thời điểm mở đăng ký không hợp lệ' })
  registrationOpensAt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ type: RulesDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RulesDto)
  rules?: RulesDto;

  @ApiPropertyOptional({ description: 'Tự động sinh các ô trực từ danh mục đang mở' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  autoGenerateSlots?: boolean;

  @ApiPropertyOptional({ description: 'Sao chép ô trực từ kỳ trước (mã kỳ ID)' })
  @IsOptional()
  @Transform(toIntOrUndef)
  @IsInt()
  copyFromPeriodId?: number;

  @ApiPropertyOptional({ description: 'Sao chép cả phân công nhân viên từ kỳ trước' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  copyAssignments?: boolean;
}
export class UpdatePeriodDto extends PartialType(PeriodDto) {}

export class PeriodQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(YMD)
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(YMD)
  to?: string;

  @ApiPropertyOptional({ description: 'Lọc theo năm (ví dụ: 2026)' })
  @IsOptional()
  @Transform(toIntOrUndef)
  @IsInt()
  year?: number;

  @ApiPropertyOptional({ description: 'Lọc theo tháng (1–12)' })
  @IsOptional()
  @Transform(toIntOrUndef)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @ApiPropertyOptional({ description: 'Lọc theo trạng thái: NHAP, CONG_BO, DA_CHOT, CURRENT' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Tìm kiếm theo tên kỳ lịch' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class ClonePeriodDto {
  @ApiPropertyOptional({ example: '2026-10-19', description: 'Ngày bắt đầu kỳ mới (mặc định Thứ Hai tuần kế tiếp)' })
  @IsOptional()
  @Matches(YMD)
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-10-25', description: 'Ngày kết thúc kỳ mới (mặc định Chủ Nhật)' })
  @IsOptional()
  @Matches(YMD)
  endDate?: string;

  @ApiPropertyOptional({ description: 'Tên kỳ mới (để trống sẽ tự sinh theo chuẩn ISO)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ description: 'Sao chép cả danh sách phân công nhân viên' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  copyAssignments?: boolean;
}

export class PublishDto {
  @ApiPropertyOptional({ description: 'Bỏ qua kiểm tra ô còn thiếu người (ghi nhận trong nhật ký)' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  force?: boolean;
}

export class UnlockDto {
  @ApiProperty({ example: 'Bổ sung bác sĩ thay ca đột xuất' })
  @Transform(trim)
  @IsString()
  @MinLength(5, { message: 'Vui lòng nêu lý do mở chốt (tối thiểu 5 ký tự)' })
  reason!: string;

  @ApiProperty({ description: 'Mốc chốt mới (phải ở tương lai)' })
  @IsDateString({}, { message: 'Mốc chốt mới không hợp lệ' })
  lockAt!: string;
}

export class GenerateSlotsDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Chọn ít nhất một phòng khám' })
  @ArrayMaxSize(60)
  @IsInt({ each: true })
  roomIds!: number[];

  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Chọn ít nhất một ca trực' })
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  shiftIds!: number[];

  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Chọn ít nhất một vai trò trực' })
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  roleIds!: number[];

  @ApiProperty({ description: '1 = Thứ 2 … 6 = Thứ 7, 7 = Chủ nhật', type: [Number] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Chọn ít nhất một thứ trong tuần' })
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  weekdays!: number[];

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Transform(toIntOrUndef)
  @IsInt()
  @Min(1)
  @Max(20)
  requiredCount?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  skipClosedDays?: boolean;
}

export class SlotDto {
  @ApiProperty({ example: '2026-10-06' })
  @Matches(YMD, { message: 'Ngày trực phải dạng YYYY-MM-DD' })
  dutyDate!: string;

  @ApiProperty()
  @Transform(toIntOrUndef)
  @IsInt()
  roomId!: number;

  @ApiProperty()
  @Transform(toIntOrUndef)
  @IsInt()
  shiftId!: number;

  @ApiProperty()
  @Transform(toIntOrUndef)
  @IsInt()
  roleId!: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Transform(toIntOrUndef)
  @IsInt()
  @Min(1)
  @Max(20)
  requiredCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateSlotDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toIntOrUndef)
  @IsInt()
  @Min(1)
  @Max(20)
  requiredCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ForceDto {
  @ApiPropertyOptional({ description: 'Gỡ/xoá cả khi ô đang có người trực (ghi nhận nhật ký)' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  force?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AssignDto {
  @ApiProperty()
  @Transform(toIntOrUndef)
  @IsInt()
  userId!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ description: 'Bỏ qua ràng buộc (chỉ điều phối toàn viện) — bắt buộc ghi lý do' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  force?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class OverrideDto {
  @ApiProperty()
  @Transform(toIntOrUndef)
  @IsInt()
  slotId!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toIntOrUndef)
  @IsInt()
  removeUserId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toIntOrUndef)
  @IsInt()
  addUserId?: number;

  @ApiProperty({ example: 'BS Nguyễn Văn A nghỉ ốm đột xuất, KHTH chỉ định BS B trực thay' })
  @Transform(trim)
  @IsString()
  @MinLength(10, { message: 'Vui lòng ghi lý do đổi trực (tối thiểu 10 ký tự)' })
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({ description: 'Bỏ qua ràng buộc khi thay người' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  force?: boolean;
}

/* ------------------------------------------------------------------ Nghỉ phép */

export class AbsenceDto {
  @ApiPropertyOptional({ description: 'Bỏ trống = chính bạn' })
  @IsOptional()
  @Transform(toIntOrUndef)
  @IsInt()
  userId?: number;

  @ApiProperty({ example: '2026-10-06' })
  @Matches(YMD, { message: 'Ngày bắt đầu phải dạng YYYY-MM-DD' })
  startDate!: string;

  @ApiProperty({ example: '2026-10-08' })
  @Matches(YMD, { message: 'Ngày kết thúc phải dạng YYYY-MM-DD' })
  endDate!: string;

  @ApiProperty({ enum: ABSENCE_REASONS })
  @IsIn(ABSENCE_REASONS as unknown as string[], { message: 'Lý do nghỉ không hợp lệ' })
  reason!: (typeof ABSENCE_REASONS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AbsenceQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(YMD)
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(YMD)
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toIntOrUndef)
  @IsInt()
  userId?: number;
}

export class AbsenceReplacementDto {
  @IsInt() @Min(1) slotId!: number;
  @IsInt() @Min(1) assignmentId!: number;
  @IsInt() @Min(1) replacementUserId!: number;
}

export class AbsenceReviewDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => AbsenceReplacementDto)
  replacements?: AbsenceReplacementDto[];
}

/* ------------------------------------------------------------------ Yêu cầu đổi trực */

export class RequestCreateDto {
  @ApiProperty({ enum: ['NHUONG', 'DOI', 'NGOAI_LE'] })
  @IsIn(['NHUONG', 'DOI', 'NGOAI_LE'], { message: 'Loại yêu cầu không hợp lệ' })
  type!: 'NHUONG' | 'DOI' | 'NGOAI_LE';

  @ApiProperty({ description: 'Ca của bạn (NHUONG/DOI) hoặc ca cần xử lý (NGOAI_LE)' })
  @Transform(toIntOrUndef)
  @IsInt()
  slotId!: number;

  @ApiPropertyOptional({ description: 'NHUONG: người nhận · DOI: người đổi ca · NGOAI_LE: người cần thay' })
  @IsOptional()
  @Transform(toIntOrUndef)
  @IsInt()
  targetUserId?: number;

  @ApiPropertyOptional({ description: 'DOI: ca của người đổi' })
  @IsOptional()
  @Transform(toIntOrUndef)
  @IsInt()
  targetSlotId?: number;

  @ApiPropertyOptional({ description: 'NGOAI_LE: người thay đề xuất' })
  @IsOptional()
  @Transform(toIntOrUndef)
  @IsInt()
  replacementUserId?: number;

  @ApiProperty({ example: 'Con ốm, cần nghỉ buổi chiều' })
  @Transform(trim)
  @IsString()
  @MinLength(5, { message: 'Vui lòng nêu lý do (tối thiểu 5 ký tự)' })
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  urgent?: boolean;
}

export class RequestRespondDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ description: 'Duyệt ngoại lệ: chỉ định người thay' })
  @IsOptional()
  @Transform(toIntOrUndef)
  @IsInt()
  replacementUserId?: number;

  @ApiPropertyOptional({ description: 'Duyệt ngoại lệ: bỏ qua ràng buộc khi thay người (điều phối toàn viện)' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  force?: boolean;
}

export class RequestQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'incoming', 'approval', 'all'] })
  @IsOptional()
  @IsIn(['mine', 'incoming', 'approval', 'all'])
  box?: 'mine' | 'incoming' | 'approval' | 'all';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toIntOrUndef)
  @IsInt()
  periodId?: number;
}

export class CandidateQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

export class DeletePeriodDto {
  @ApiPropertyOptional({ example: 'Nhập sai khoảng ngày, sẽ lập lại kỳ mới' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300, { message: 'Lý do tối đa 300 ký tự' })
  reason?: string;

  @ApiPropertyOptional({ description: 'Gõ lại đúng tên kỳ lịch để xác nhận (tuỳ chọn)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  confirmName?: string;
}
