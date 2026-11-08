import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit, CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AccessContext } from '../../common/types/access-context';
import { AttendanceCodeDto, AttendanceHolidayDto, AttendanceMonthQueryDto, SaveAttendanceEntriesDto } from './duty-attendance.dto';
import { DutyAttendanceService } from './duty-attendance.service';

@ApiTags('Bảng chấm công trực và chấm công khác')
@ApiBearerAuth()
@Controller('duty-attendance')
export class DutyAttendanceController {
  constructor(private readonly service: DutyAttendanceService) {}

  @Get('departments') @RequirePermissions('duty-attendance.view')
  @ApiOperation({ summary: 'Khoa/phòng được phép xem bảng chấm công; vai trò phạm vi Toàn viện được chọn mọi khoa' })
  departments(@CurrentUser() user: AccessContext) { return this.service.availableDepartments(user); }

  @Get('month') @RequirePermissions('duty-attendance.view')
  @ApiOperation({ summary: 'Bảng chấm công tháng; vai trò phạm vi Toàn viện có thể chọn khoa' })
  month(@CurrentUser() user: AccessContext, @Query() q: AttendanceMonthQueryDto) { return this.service.month(user, q); }

  @Put('entries') @RequirePermissions('duty-attendance.update')
  @Audit({ module: 'DUTY_ATTENDANCE', action: 'UPDATE', entity: 'duty_attendance_entries', description: 'Cập nhật chấm công trực và chấm công khác trong khoa được gán' })
  save(@CurrentUser() user: AccessContext, @Body() dto: SaveAttendanceEntriesDto) { return this.service.save(user, dto); }

  @Get('export/:format') @RequirePermissions('duty-attendance.export')
  @Audit({ module: 'DUTY_ATTENDANCE', action: 'EXPORT', entity: 'duty_attendance_entries', description: 'Xuất bảng chấm công tháng' })
  async export(@CurrentUser() user: AccessContext, @Param('format') format: string, @Query() q: AttendanceMonthQueryDto) {
    const result = format === 'xlsx' ? await this.service.exportExcel(user, q.month, q.departmentId) : format === 'docx' ? await this.service.exportWord(user, q.month, q.departmentId) : format === 'pdf' ? await this.service.exportPdf(user, q.month, q.departmentId) : null;
    if (!result) throw new Error('Định dạng xuất không hỗ trợ');
    return new StreamableFile(result.buffer, { type: result.mime, disposition: `attachment; filename="${encodeURIComponent(result.fileName)}"`, length: result.buffer.length });
  }

  @Get('codes') @RequirePermissions('duty-attendance.view') codes() { return this.service.codes(); }
  @Post('codes') @RequirePermissions('duty-attendance.catalog.manage') createCode(@Body() dto: AttendanceCodeDto) { return this.service.createCode(dto); }
  @Put('codes/:id') @RequirePermissions('duty-attendance.catalog.manage')
  @Audit({ module: 'DUTY_ATTENDANCE', action: 'UPDATE', entity: 'duty_attendance_codes', description: 'Sửa ký hiệu chấm công' })
  updateCode(@Param('id', ParseIntPipe) id: number, @Body() dto: AttendanceCodeDto) { return this.service.updateCode(id, dto); }
  @Delete('codes/:id') @RequirePermissions('duty-attendance.catalog.manage')
  @Audit({ module: 'DUTY_ATTENDANCE', action: 'DELETE', entity: 'duty_attendance_codes', description: 'Xóa ký hiệu chấm công chưa phát sinh dữ liệu' })
  deleteCode(@Param('id', ParseIntPipe) id: number) { return this.service.deleteCode(id); }
  @Get('holidays') @RequirePermissions('duty-attendance.view') holidays(@Query() q: AttendanceMonthQueryDto) { return this.service.holidays(q); }
  @Post('holidays') @RequirePermissions('duty-attendance.catalog.manage') saveHoliday(@CurrentUser() user: AccessContext, @Body() dto: AttendanceHolidayDto) { return this.service.saveHoliday(user, dto); }
  @Delete('holidays/:id') @RequirePermissions('duty-attendance.catalog.manage') deleteHoliday(@Param('id', ParseIntPipe) id: number) { return this.service.deleteHoliday(id); }
}
