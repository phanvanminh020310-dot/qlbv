import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit, CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AccessContext } from '../../common/types/access-context';
import {
  AbsenceDto,
  AbsenceQueryDto,
  AssignDto,
  CandidateQueryDto,
  ClonePeriodDto,
  ForceDto,
  GenerateSlotsDto,
  PeriodDto,
  PeriodQueryDto,
  PublishDto,
  SlotDto,
  DeletePeriodDto,
  UnlockDto,
  UpdatePeriodDto,
  UpdateSlotDto,
} from './duty.dto';
import { DutyService } from './duty.service';

const MANAGE_ANY = ['duty.manage', 'duty.manage-all'];

@ApiTags('Lịch bác sĩ khám bệnh')
@ApiBearerAuth()
@Controller('duty')
export class DutyController {
  constructor(private readonly service: DutyService) {}

  /* ---------------------------------------------------------------- Của tôi & nghỉ phép */

  @Get('me')
  @RequirePermissions('duty.view')
  @ApiOperation({ summary: 'Lịch khám của tôi: ca đã xếp, nghỉ phép, kỳ đang mở' })
  me(@CurrentUser() user: AccessContext) {
    return this.service.me(user);
  }

  @Get('staff')
  @RequirePermissions('duty.register')
  @ApiOperation({ summary: 'Danh bạ nhân viên để chọn người nhận ca (tên, chức danh, khoa)' })
  staff(@Query() q: CandidateQueryDto) {
    return this.service.staff(q.q);
  }

  @Get('live-monitor')
  @RequirePermissions(MANAGE_ANY, 'any')
  @ApiOperation({ summary: 'Theo dõi thời gian thực bác sĩ đã xác thực vào các ca đang diễn ra' })
  liveMonitor(@CurrentUser() user: AccessContext) {
    return this.service.liveMonitor(user);
  }

  @Get('absences')
  @RequirePermissions('duty.view')
  @ApiOperation({ summary: 'Danh sách nghỉ phép (người thường chỉ thấy của mình)' })
  listAbsences(@CurrentUser() user: AccessContext, @Query() q: AbsenceQueryDto) {
    return this.service.listAbsences(user, q);
  }

  @Post('absences')
  @RequirePermissions(['duty.register', 'duty.manage', 'duty.manage-all'], 'any')
  @Audit({ module: 'DUTY', action: 'CREATE', entity: 'duty_absence_request', description: 'Gửi nghỉ/bận chờ quản lý duyệt và bố trí người thay' })
  @ApiOperation({ summary: 'Gửi yêu cầu nghỉ/bận; giữ nguyên lịch đến khi quản lý duyệt và bố trí người thay' })
  createAbsence(@CurrentUser() user: AccessContext, @Body() dto: AbsenceDto) {
    return this.service.createAbsence(user, dto);
  }

  @Delete('absences/:id')
  @RequirePermissions(['duty.manage', 'duty.manage-all'], 'any')
  @Audit({ module: 'DUTY', action: 'DELETE', entity: 'duty_absence', description: 'Xoá ghi nhận nghỉ phép' })
  deleteAbsence(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    return this.service.deleteAbsence(user, id);
  }

  /* ---------------------------------------------------------------- Kỳ lịch */

  @Get('periods')
  @RequirePermissions('duty.view')
  @ApiOperation({ summary: 'Danh sách kỳ lịch (bản nháp chỉ người quản lý thấy)' })
  listPeriods(@CurrentUser() user: AccessContext, @Query() q: PeriodQueryDto) {
    return this.service.listPeriods(user, q);
  }

  @Get('periods/suggest-next')
  @RequirePermissions('duty.view')
  @ApiOperation({ summary: 'Gợi ý thông số tạo tuần tiếp theo (tự động tính tuần ISO, ngày, mốc chốt)' })
  suggestNextPeriod() {
    return this.service.suggestNextPeriod();
  }

  @Post('periods')
  @RequirePermissions('duty.period.manage')
  @Audit({ module: 'DUTY', action: 'CREATE', entity: 'duty_period', description: 'Tạo kỳ lịch khám' })
  createPeriod(@CurrentUser() user: AccessContext, @Body() dto: PeriodDto) {
    return this.service.createPeriod(user, dto);
  }

  @Post('periods/:id/clone')
  @RequirePermissions('duty.period.manage')
  @Audit({ module: 'DUTY', action: 'CREATE', entity: 'duty_period', description: 'Nhân bản kỳ lịch sang tuần mới' })
  @ApiOperation({ summary: 'Sao chép cấu trúc ca khám (và phân công) sang tuần tiếp theo' })
  clonePeriod(
    @CurrentUser() user: AccessContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ClonePeriodDto,
  ) {
    return this.service.clonePeriod(user, id, dto);
  }

  @Get('periods/:id')
  @RequirePermissions('duty.view')
  getPeriod(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    return this.service.getPeriodView(user, id);
  }

  @Put('periods/:id')
  @RequirePermissions('duty.period.manage')
  @Audit({ module: 'DUTY', action: 'UPDATE', entity: 'duty_period', description: 'Sửa kỳ lịch khám' })
  updatePeriod(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePeriodDto) {
    return this.service.updatePeriod(user, id, dto);
  }

  @Post('periods/:id/delete')
  @RequirePermissions('duty.period.manage')
  @Audit({ module: 'DUTY', action: 'DELETE', entity: 'duty_period', description: 'Xoá cả kỳ lịch (có lý do, gõ lại tên kỳ)' })
  deletePeriod(
    @CurrentUser() user: AccessContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeletePeriodDto,
  ) {
    return this.service.deletePeriod(user, id, dto);
  }

  @Post('periods/:id/publish')
  @RequirePermissions('duty.period.manage')
  @Audit({ module: 'DUTY', action: 'PUBLISH', entity: 'duty_period', description: 'Công bố lịch khám' })
  @ApiOperation({ summary: 'Công bố kỳ lịch và thông báo bác sĩ khám' })
  publish(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Body() dto: PublishDto) {
    return this.service.publishPeriod(user, id, !!dto?.force);
  }

  @Post('periods/:id/lock')
  @RequirePermissions('duty.period.manage')
  @Audit({ module: 'DUTY', action: 'LOCK', entity: 'duty_period', description: 'Chốt lịch khám' })
  lock(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    return this.service.lockPeriod(user, id);
  }

  @Post('periods/:id/unlock')
  @RequirePermissions('duty.period.manage')
  @Audit({ module: 'DUTY', action: 'UNLOCK', entity: 'duty_period', description: 'Mở chốt lịch khám (có lý do)' })
  unlock(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Body() dto: UnlockDto) {
    return this.service.unlockPeriod(user, id, dto);
  }

  @Get('periods/:id/grid')
  @RequirePermissions('duty.view')
  @ApiOperation({ summary: 'Dữ liệu lưới lịch của một kỳ (phòng × ngày × ca)' })
  grid(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    return this.service.grid(user, id);
  }

  @Get('periods/:id/my-options')
  @RequirePermissions('duty.register')
  @ApiOperation({ summary: 'Các ca tôi có thể đăng ký, kèm lý do nếu không được' })
  myOptions(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    return this.service.myOptions(user, id);
  }

  @Get('periods/:id/summary')
  @RequirePermissions('duty.view')
  @ApiOperation({ summary: 'Tổng hợp giờ khám theo người (kèm độ chênh lệch công bằng)' })
  summary(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    return this.service.summary(user, id);
  }

  @Get('periods/:id/logs')
  @RequirePermissions('duty.view')
  @ApiOperation({ summary: 'Nhật ký thay đổi lịch (người quản lý)' })
  logs(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    return this.service.logs(user, id);
  }

  @Get('periods/:id/export')
  @RequirePermissions('duty.export')
  @Audit({ module: 'DUTY', action: 'EXPORT', entity: 'duty_period', description: 'Xuất lịch khám ra Excel' })
  async exportPeriod(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    const { buffer, fileName } = await this.service.exportWorkbook(user, id);
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${encodeURIComponent(fileName)}"`,
      length: buffer.length,
    });
  }

  /* ---------------------------------------------------------------- Ca khám & phân công */

  @Post('periods/:id/slots/generate')
  @RequirePermissions(MANAGE_ANY, 'any')
  @Audit({ module: 'DUTY', action: 'CREATE', entity: 'duty_slot', description: 'Sinh hàng loạt ca khám' })
  generateSlots(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Body() dto: GenerateSlotsDto) {
    return this.service.generateSlots(user, id, dto);
  }

  @Post('periods/:id/slots')
  @RequirePermissions(MANAGE_ANY, 'any')
  @Audit({ module: 'DUTY', action: 'CREATE', entity: 'duty_slot', description: 'Thêm ca khám' })
  createSlot(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Body() dto: SlotDto) {
    return this.service.createSlot(user, id, dto);
  }

  @Put('slots/:id')
  @RequirePermissions(MANAGE_ANY, 'any')
  @Audit({ module: 'DUTY', action: 'UPDATE', entity: 'duty_slot', description: 'Sửa ca khám' })
  updateSlot(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSlotDto) {
    return this.service.updateSlot(user, id, dto);
  }

  @Post('slots/:id/delete')
  @RequirePermissions(MANAGE_ANY, 'any')
  @Audit({ module: 'DUTY', action: 'DELETE', entity: 'duty_slot', description: 'Xoá ca khám' })
  @ApiOperation({ summary: 'Xoá ca khám (ca có bác sĩ đã xếp cần lý do)' })
  deleteSlot(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Body() dto: ForceDto) {
    return this.service.deleteSlot(user, id, dto ?? {});
  }

  @Get('slots/:id/candidates')
  @RequirePermissions(MANAGE_ANY, 'any')
  @ApiOperation({ summary: 'Ứng viên cho ca khám, kèm kết quả kiểm tra ràng buộc' })
  candidates(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Query() q: CandidateQueryDto) {
    return this.service.candidates(user, id, q.q);
  }

  @Post('slots/:id/assignments')
  @RequirePermissions(MANAGE_ANY, 'any')
  @Audit({ module: 'DUTY', action: 'ASSIGN', entity: 'duty_assignment', description: 'Xếp bác sĩ khám' })
  assign(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Body() dto: AssignDto) {
    return this.service.assign(user, id, dto);
  }

  @Post('assignments/:id/remove')
  @RequirePermissions(MANAGE_ANY, 'any')
  @Audit({ module: 'DUTY', action: 'UNASSIGN', entity: 'duty_assignment', description: 'Gỡ bác sĩ khám khỏi ca' })
  unassign(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Body() dto: ForceDto) {
    return this.service.unassign(user, id, dto?.reason);
  }

  @Post('slots/:id/register')
  @RequirePermissions('duty.register')
  @Audit({ module: 'DUTY', action: 'REGISTER', entity: 'duty_assignment', description: 'Tự đăng ký ca khám' })
  selfRegister(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    return this.service.selfRegister(user, id);
  }

  @Post('slots/:id/unregister')
  @RequirePermissions('duty.register')
  @Audit({ module: 'DUTY', action: 'UNREGISTER', entity: 'duty_assignment', description: 'Huỷ đăng ký ca khám' })
  selfUnregister(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    return this.service.selfUnregister(user, id);
  }
}
