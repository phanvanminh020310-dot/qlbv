import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AdvancedQueryDto, toBoolean } from '../../common/dto/query.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateManagementPositionDto {
  @ApiProperty({ example: 'CNK' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập mã chức vụ' })
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9_.-]+$/, { message: 'Mã chức vụ chỉ gồm chữ, số, dấu chấm, gạch ngang, gạch dưới' })
  code!: string;

  @ApiProperty({ example: 'Chủ nhiệm khoa' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập tên chức vụ' })
  @MaxLength(128)
  name!: string;

  @ApiPropertyOptional({ description: 'Thứ tự ưu tiên/hiển thị; bỏ trống tự xếp cuối.' })
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : Number(value)))
  @IsInt({ message: 'Thứ tự phải là số nguyên' })
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateManagementPositionDto extends PartialType(CreateManagementPositionDto) {}

export class ManagementPositionQueryDto extends AdvancedQueryDto {}
