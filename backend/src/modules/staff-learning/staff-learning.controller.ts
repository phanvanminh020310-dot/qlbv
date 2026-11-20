import { Body, Controller, Delete, Get, Param, Post, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit, CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AccessContext } from '../../common/types/access-context';
import { StaffLearningRegistrationDto, StaffLearningWeekQueryDto } from './staff-learning.dto';
import { StaffLearningService } from './staff-learning.service';

/**
 * Lịch học là luồng tự đăng ký của cán bộ. Dùng duty.view đã có để mọi tài khoản
 * được phép xem lịch khám cũng thấy được lịch học trong phạm vi khoa của mình.
 */
@ApiTags('Lịch học cán bộ nhân viên')
@ApiBearerAuth()
@Controller('staff-learning')
export class StaffLearningController {
  constructor(private readonly service: StaffLearningService) {}

  @Get('week')
  @RequirePermissions('duty.view')
  @ApiOperation({ summary: 'Bảng đăng ký lịch học theo tuần, nhóm cán bộ theo khoa/phòng' })
  week(@CurrentUser() user: AccessContext, @Query() q: StaffLearningWeekQueryDto) {
    return this.service.week(user, q);
  }

  @Post('registrations')
  @RequirePermissions('duty.view')
  @Audit({ module: 'STAFF_LEARNING', action: 'CREATE', entity: 'staff_learning_registrations', description: 'Cán bộ tự đăng ký lịch học theo ngày' })
  @ApiOperation({ summary: 'Tự đăng ký lịch học cho chính tài khoản đang đăng nhập' })
  register(@CurrentUser() user: AccessContext, @Body() dto: StaffLearningRegistrationDto) {
    return this.service.register(user, dto);
  }

  @Delete('registrations/:studyDate')
  @RequirePermissions('duty.view')
  @Audit({ module: 'STAFF_LEARNING', action: 'DELETE', entity: 'staff_learning_registrations', description: 'Cán bộ gỡ đăng ký lịch học của mình' })
  @ApiOperation({ summary: 'Gỡ đăng ký lịch học của chính tài khoản đang đăng nhập' })
  remove(@CurrentUser() user: AccessContext, @Param('studyDate') studyDate: string) {
    return this.service.remove(user, studyDate);
  }

  @Get('export')
  @RequirePermissions('duty.view')
  @Audit({ module: 'STAFF_LEARNING', action: 'EXPORT', entity: 'staff_learning_registrations', description: 'Xuất Excel lịch học cán bộ nhân viên theo tuần' })
  @ApiOperation({ summary: 'Xuất Excel lịch học theo khoa/phòng và các ngày trong tuần' })
  async exportExcel(@CurrentUser() user: AccessContext, @Query() q: StaffLearningWeekQueryDto) {
    const { buffer, fileName } = await this.service.exportExcel(user, q);
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${encodeURIComponent(fileName)}"`,
      length: buffer.length,
    });
  }
}
