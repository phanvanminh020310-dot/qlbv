import { IsDateString, IsInt, Matches, Min } from 'class-validator';

/** Thứ Hai mở đầu tuần cần xem/xuất, giúp các cột ngày cố định từ Thứ 2 đến Chủ nhật. */
export class StaffLearningWeekQueryDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/, { message: 'Tuần phải bắt đầu bằng ngày có dạng YYYY-MM-DD' })
  weekStart!: string;
}

/** Người được giao vai trò đăng ký chọn nhân viên thuộc khoa/phòng của mình và một ngày học. */
export class StaffLearningRegistrationDto {
  @IsInt({ message: 'Nhân viên không hợp lệ' })
  @Min(1, { message: 'Nhân viên không hợp lệ' })
  userId!: number;

  @IsDateString({}, { message: 'Ngày học không hợp lệ' })
  studyDate!: string;
}
