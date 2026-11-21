import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit, CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AccessContext } from '../../common/types/access-context';
import { StaffLearningRegistrationDto, StaffLearningRegistrationNoteDto, StaffLearningWeekQueryDto } from './staff-learning.dto';
import { StaffLearningService } from './staff-learning.service';

/**
 * Lịch học dùng bộ quyền độc lập: người được giao vai trò nhập lịch chỉ thao tác
 * nhân viên trong khoa/phòng được gán; điều phối KHTH chỉ xem/xuất toàn viện.
 */
@ApiTags('Lịch học cán bộ nhân viên')
@ApiBearerAuth()
@Controller('staff-learning')
export class StaffLearningController {
  constructor(private readonly service: StaffLearningService) {}

  @Get('week')
  @RequirePermissions('staff-learning.view')
  @ApiOperation({ summary: 'Bảng đăng ký lịch học theo tuần, nhóm cán bộ theo khoa/phòng' })
  week(@CurrentUser() user: AccessContext, @Query() q: StaffLearningWeekQueryDto) {
    return this.service.week(user, q);
  }

  @Post('registrations')
  @RequirePermissions('staff-learning.register')
  @Audit({ module: 'STAFF_LEARNING', action: 'CREATE', entity: 'staff_learning_registrations', description: 'Đăng ký lịch học cho nhân viên thuộc khoa/phòng được gán' })
  @ApiOperation({ summary: 'Đăng ký lịch học cho nhân viên thuộc phạm vi khoa/phòng được giao' })
  register(@CurrentUser() user: AccessContext, @Body() dto: StaffLearningRegistrationDto) {
    return this.service.register(user, dto);
  }

  @Put('registrations/:userId/:studyDate')
  @RequirePermissions('staff-learning.register')
  @Audit({ module: 'STAFF_LEARNING', action: 'UPDATE', entity: 'staff_learning_registrations', description: 'Cập nhật ghi chú lịch học cho nhân viên thuộc khoa/phòng được gán' })
  @ApiOperation({ summary: 'Cập nhật ghi chú cho lượt học thuộc phạm vi khoa/phòng được giao' })
  updateNote(@CurrentUser() user: AccessContext, @Param('userId', ParseIntPipe) userId: number, @Param('studyDate') studyDate: string, @Body() dto: StaffLearningRegistrationNoteDto) {
    return this.service.updateNote(user, userId, studyDate, dto);
  }

  @Delete('registrations/:userId/:studyDate')
  @RequirePermissions('staff-learning.register')
  @Audit({ module: 'STAFF_LEARNING', action: 'DELETE', entity: 'staff_learning_registrations', description: 'Gỡ lịch học của nhân viên thuộc khoa/phòng được gán' })
  @ApiOperation({ summary: 'Gỡ đăng ký lịch học của nhân viên thuộc phạm vi khoa/phòng được giao' })
  remove(@CurrentUser() user: AccessContext, @Param('userId', ParseIntPipe) userId: number, @Param('studyDate') studyDate: string) {
    return this.service.remove(user, userId, studyDate);
  }

  @Get('export')
  @RequirePermissions('staff-learning.export')
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
