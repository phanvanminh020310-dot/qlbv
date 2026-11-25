import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PROJECT_STATUSES, TASK_PRIORITIES } from '../../db/schema/tasks';
import { TASK_ACTIONS } from './task-workflow';

const YMD = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;

/** Một tệp gửi dạng base64 (ảnh, PDF, Word, Excel, PowerPoint, văn bản…). */
export class TaskFileDto {
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(127)
  mimeType?: string;

  @IsString()
  contentBase64!: string;
}

export class TaskRecurrenceDto {
  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY'], { message: 'Chu kỳ lặp không hợp lệ' })
  freq!: 'DAILY' | 'WEEKLY' | 'MONTHLY';

  @IsInt()
  @Min(1)
  @Max(365)
  interval!: number;

  @IsOptional()
  @Matches(YMD, { message: 'Ngày kết thúc lặp phải dạng YYYY-MM-DD' })
  until?: string | null;
}

export class CreateTaskDto {
  @IsString()
  @MinLength(2, { message: 'Tiêu đề công việc tối thiểu 2 ký tự' })
  @MaxLength(300, { message: 'Tiêu đề công việc tối đa 300 ký tự' })
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string;

  /** Giao cho một người */
  @IsOptional()
  @IsInt()
  assigneeId?: number | null;

  /** Giao cùng lúc cho nhiều người — mỗi người một công việc riêng */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  assigneeIds?: number[];

  @IsOptional()
  @IsInt()
  reviewerId?: number | null;

  @IsOptional()
  @IsInt()
  departmentId?: number | null;

  @IsOptional()
  @IsInt()
  projectId?: number | null;

  @IsOptional()
  @IsInt()
  parentId?: number | null;

  @IsOptional()
  @IsIn(TASK_PRIORITIES as unknown as string[])
  priority?: (typeof TASK_PRIORITIES)[number];

  @IsOptional()
  @Matches(YMD, { message: 'Ngày bắt đầu phải dạng YYYY-MM-DD' })
  startDate?: string | null;

  /** ISO datetime hạn chót */
  @IsOptional()
  @IsString()
  dueAt?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  estimateHours?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  labels?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  checklist?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  watcherIds?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  dependsOnIds?: number[];

  @IsOptional()
  @ValidateNested()
  @Type(() => TaskRecurrenceDto)
  recurrence?: TaskRecurrenceDto | null;

  @IsOptional()
  @IsInt()
  templateId?: number | null;

  /** Lưu nháp, chưa giao */
  @IsOptional()
  @IsBoolean()
  draft?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => TaskFileDto)
  files?: TaskFileDto[];
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string;

  @IsOptional()
  @IsInt()
  assigneeId?: number | null;

  @IsOptional()
  @IsInt()
  reviewerId?: number | null;

  @IsOptional()
  @IsInt()
  projectId?: number | null;

  @IsOptional()
  @IsIn(TASK_PRIORITIES as unknown as string[])
  priority?: (typeof TASK_PRIORITIES)[number];

  @IsOptional()
  @Matches(YMD)
  startDate?: string | null;

  @IsOptional()
  @IsString()
  dueAt?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  estimateHours?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  labels?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => TaskRecurrenceDto)
  recurrence?: TaskRecurrenceDto | null;
}

export class TransitionTaskDto {
  @IsIn(TASK_ACTIONS as unknown as string[], { message: 'Thao tác không hợp lệ' })
  action!: (typeof TASK_ACTIONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;

  /** Nội dung kết quả khi gửi duyệt */
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  resultContent?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => TaskFileDto)
  files?: TaskFileDto[];
}

export class TaskCommentDto {
  @IsString()
  @MaxLength(5000, { message: 'Tin nhắn tối đa 5000 ký tự' })
  content!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => TaskFileDto)
  files?: TaskFileDto[];
}

export class TaskAttachmentsDto {
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => TaskFileDto)
  files!: TaskFileDto[];
}

export class TaskWorklogDto {
  @Matches(YMD, { message: 'Ngày làm việc phải dạng YYYY-MM-DD' })
  workDate!: string;

  @IsNumber()
  @Min(0)
  @Max(24, { message: 'Số giờ trong một ngày tối đa 24' })
  hours!: number;

  @IsString()
  @MinLength(1, { message: 'Nhập nội dung đã làm' })
  @MaxLength(5000)
  content!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;
}

export class ChecklistItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  content!: string;
}

export class UpdateChecklistItemDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  content?: string;

  @IsOptional()
  @IsBoolean()
  done?: boolean;
}

export class TaskIdsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  ids!: number[];
}

export class TaskTemplateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string;

  @IsOptional()
  @IsIn(TASK_PRIORITIES as unknown as string[])
  priority?: (typeof TASK_PRIORITIES)[number];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  estimateHours?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  dueDays?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  checklist?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  labels?: string[];

  @IsOptional()
  @IsInt()
  departmentId?: number | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ProjectMemberDto {
  @IsInt()
  userId!: number;

  @IsOptional()
  @IsIn(['MANAGER', 'MEMBER', 'VIEWER'])
  role?: 'MANAGER' | 'MEMBER' | 'VIEWER';
}

export class CreateProjectDto {
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string;

  @IsOptional()
  @IsInt()
  departmentId?: number | null;

  @IsOptional()
  @IsInt()
  ownerId?: number | null;

  @IsOptional()
  @IsIn(PROJECT_STATUSES as unknown as string[])
  status?: (typeof PROJECT_STATUSES)[number];

  @IsOptional()
  @IsIn(TASK_PRIORITIES as unknown as string[])
  priority?: (typeof TASK_PRIORITIES)[number];

  @IsOptional()
  @Matches(YMD)
  startDate?: string | null;

  @IsOptional()
  @Matches(YMD)
  dueDate?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  color?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ProjectMemberDto)
  members?: ProjectMemberDto[];
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string;

  @IsOptional()
  @IsInt()
  ownerId?: number | null;

  @IsOptional()
  @IsIn(PROJECT_STATUSES as unknown as string[])
  status?: (typeof PROJECT_STATUSES)[number];

  @IsOptional()
  @IsIn(TASK_PRIORITIES as unknown as string[])
  priority?: (typeof TASK_PRIORITIES)[number];

  @IsOptional()
  @Matches(YMD)
  startDate?: string | null;

  @IsOptional()
  @Matches(YMD)
  dueDate?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  color?: string;

  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class ProjectMembersDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ProjectMemberDto)
  members!: ProjectMemberDto[];
}

/** Tham số báo cáo — nhận chuỗi từ query string. */
export class TaskReportQueryDto {
  @IsOptional()
  @Matches(YMD)
  from?: string;

  @IsOptional()
  @Matches(YMD)
  to?: string;

  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  granularity?: 'day' | 'week' | 'month';

  @IsOptional()
  @Matches(/^\d+$/)
  departmentId?: string;

  @IsOptional()
  @Matches(/^\d+$/)
  projectId?: string;

  @IsOptional()
  @Matches(/^\d+$/)
  assigneeId?: string;

  @IsOptional()
  @IsIn(['xlsx', 'csv', 'docx', 'json'])
  format?: 'xlsx' | 'csv' | 'docx' | 'json';
}
