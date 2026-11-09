import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit, CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AccessContext } from '../../common/types/access-context';
import {
  AttendanceCodeDto,
  AttendanceCodeGroupDto,
  AttendanceColumnDto,
  AttendanceHolidayDto,
  AttendanceMonthQueryDto,
  AttendanceSectionDto,
  AttendanceValidationDto,
  SaveAttendanceEntriesDto,
  SaveAttendanceManualValuesDto,
} from './duty-attendance.dto';
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
  @Audit({ module: 'DUTY_ATTENDANCE', action: 'UPDATE', entity: 'duty_attendance_entries', description: 'Cập nhật ký hiệu chấm công theo ngày' })
  save(@CurrentUser() user: AccessContext, @Body() dto: SaveAttendanceEntriesDto) { return this.service.save(user, dto); }

  @Put('manual-values') @RequirePermissions('duty-attendance.update')
  @Audit({ module: 'DUTY_ATTENDANCE', action: 'UPDATE', entity: 'duty_attendance_manual_values', description: 'Cập nhật số liệu tự nhập của bảng chấm công tháng' })
  saveManualValues(@CurrentUser() user: AccessContext, @Body() dto: SaveAttendanceManualValuesDto) { return this.service.saveManualValues(user, dto); }

  @Get('export/:format') @RequirePermissions('duty-attendance.export')
  @Audit({ module: 'DUTY_ATTENDANCE', action: 'EXPORT', entity: 'duty_attendance_entries', description: 'Xuất bảng chấm công tháng' })
  async export(@CurrentUser() user: AccessContext, @Param('format') format: string, @Query() q: AttendanceMonthQueryDto) {
    const result = format === 'xlsx' ? await this.service.exportExcel(user, q.month, q.departmentId) : format === 'docx' ? await this.service.exportWord(user, q.month, q.departmentId) : format === 'pdf' ? await this.service.exportPdf(user, q.month, q.departmentId) : null;
    if (!result) throw new Error('Định dạng xuất không hỗ trợ');
    return new StreamableFile(result.buffer, { type: result.mime, disposition: `attachment; filename="${encodeURIComponent(result.fileName)}"`, length: result.buffer.length });
  }

  @Get('code-groups') @RequirePermissions('duty-attendance.catalog.manage') codeGroups() { return this.service.codeGroups(); }
  @Post('code-groups') @RequirePermissions('duty-attendance.catalog.manage') createCodeGroup(@Body() dto: AttendanceCodeGroupDto) { return this.service.createCodeGroup(dto); }
  @Put('code-groups/:id') @RequirePermissions('duty-attendance.catalog.manage') @Audit({ module: 'DUTY_ATTENDANCE', action: 'UPDATE', entity: 'duty_attendance_code_groups', description: 'Sửa nhóm ký hiệu chấm công' })
  updateCodeGroup(@Param('id', ParseIntPipe) id: number, @Body() dto: AttendanceCodeGroupDto) { return this.service.updateCodeGroup(id, dto); }
  @Delete('code-groups/:id') @RequirePermissions('duty-attendance.catalog.manage') @Audit({ module: 'DUTY_ATTENDANCE', action: 'DELETE', entity: 'duty_attendance_code_groups', description: 'Xóa nhóm ký hiệu chưa được sử dụng' })
  deleteCodeGroup(@Param('id', ParseIntPipe) id: number) { return this.service.deleteCodeGroup(id); }

  @Get('codes') @RequirePermissions('duty-attendance.view') codes() { return this.service.codes(); }
  @Post('codes') @RequirePermissions('duty-attendance.catalog.manage') createCode(@Body() dto: AttendanceCodeDto) { return this.service.createCode(dto); }
  @Put('codes/:id') @RequirePermissions('duty-attendance.catalog.manage') @Audit({ module: 'DUTY_ATTENDANCE', action: 'UPDATE', entity: 'duty_attendance_codes', description: 'Sửa ký hiệu chấm công' })
  updateCode(@Param('id', ParseIntPipe) id: number, @Body() dto: AttendanceCodeDto) { return this.service.updateCode(id, dto); }
  @Delete('codes/:id') @RequirePermissions('duty-attendance.catalog.manage') @Audit({ module: 'DUTY_ATTENDANCE', action: 'DELETE', entity: 'duty_attendance_codes', description: 'Xóa ký hiệu chấm công chưa phát sinh dữ liệu' })
  deleteCode(@Param('id', ParseIntPipe) id: number) { return this.service.deleteCode(id); }

  @Get('layout') @RequirePermissions('duty-attendance.catalog.manage') layout() { return this.service.layout(); }
  @Post('sections') @RequirePermissions('duty-attendance.catalog.manage') createSection(@Body() dto: AttendanceSectionDto) { return this.service.createSection(dto); }
  @Put('sections/:id') @RequirePermissions('duty-attendance.catalog.manage') @Audit({ module: 'DUTY_ATTENDANCE', action: 'UPDATE', entity: 'duty_attendance_sections', description: 'Sửa phần hiển thị bảng chấm công' })
  updateSection(@Param('id', ParseIntPipe) id: number, @Body() dto: AttendanceSectionDto) { return this.service.updateSection(id, dto); }
  @Delete('sections/:id') @RequirePermissions('duty-attendance.catalog.manage') @Audit({ module: 'DUTY_ATTENDANCE', action: 'DELETE', entity: 'duty_attendance_sections', description: 'Xóa phần tự khai báo của bảng chấm công' })
  deleteSection(@Param('id', ParseIntPipe) id: number) { return this.service.deleteSection(id); }

  @Post('columns') @RequirePermissions('duty-attendance.catalog.manage') createColumn(@Body() dto: AttendanceColumnDto) { return this.service.createColumn(dto); }
  @Put('columns/:id') @RequirePermissions('duty-attendance.catalog.manage') @Audit({ module: 'DUTY_ATTENDANCE', action: 'UPDATE', entity: 'duty_attendance_columns', description: 'Sửa cột báo cáo bảng chấm công' })
  updateColumn(@Param('id', ParseIntPipe) id: number, @Body() dto: AttendanceColumnDto) { return this.service.updateColumn(id, dto); }
  @Delete('columns/:id') @RequirePermissions('duty-attendance.catalog.manage') @Audit({ module: 'DUTY_ATTENDANCE', action: 'DELETE', entity: 'duty_attendance_columns', description: 'Xóa cột tự khai báo khi chưa có số liệu lịch sử' })
  deleteColumn(@Param('id', ParseIntPipe) id: number) { return this.service.deleteColumn(id); }

  @Post('validations') @RequirePermissions('duty-attendance.catalog.manage') createValidation(@Body() dto: AttendanceValidationDto) { return this.service.createValidation(dto); }
  @Put('validations/:id') @RequirePermissions('duty-attendance.catalog.manage') @Audit({ module: 'DUTY_ATTENDANCE', action: 'UPDATE', entity: 'duty_attendance_validations', description: 'Sửa ràng buộc cột tự nhập bảng chấm công' })
  updateValidation(@Param('id', ParseIntPipe) id: number, @Body() dto: AttendanceValidationDto) { return this.service.updateValidation(id, dto); }
  @Delete('validations/:id') @RequirePermissions('duty-attendance.catalog.manage') @Audit({ module: 'DUTY_ATTENDANCE', action: 'DELETE', entity: 'duty_attendance_validations', description: 'Xóa ràng buộc cột tự nhập bảng chấm công' })
  deleteValidation(@Param('id', ParseIntPipe) id: number) { return this.service.deleteValidation(id); }

  @Get('holidays') @RequirePermissions('duty-attendance.view') holidays(@Query() q: AttendanceMonthQueryDto) { return this.service.holidays(q); }
  @Post('holidays') @RequirePermissions('duty-attendance.catalog.manage') saveHoliday(@CurrentUser() user: AccessContext, @Body() dto: AttendanceHolidayDto) { return this.service.saveHoliday(user, dto); }
  @Delete('holidays/:id') @RequirePermissions('duty-attendance.catalog.manage') deleteHoliday(@Param('id', ParseIntPipe) id: number) { return this.service.deleteHoliday(id); }
}
