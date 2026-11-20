import { IsDateString, Matches } from 'class-validator';

/** Thứ Hai mở đầu tuần cần xem/xuất, giúp mỗi cột ngày cố định từ Thứ 2 đến Thứ 6. */
export class StaffLearningWeekQueryDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/, { message: 'Tuần phải bắt đầu bằng ngày có dạng YYYY-MM-DD' })
  weekStart!: string;
}

/** Cán bộ chỉ đăng ký lịch học cho chính mình, một ngày làm việc tại một thời điểm. */
export class StaffLearningRegistrationDto {
  @IsDateString({}, { message: 'Ngày học không hợp lệ' })
  studyDate!: string;
}
