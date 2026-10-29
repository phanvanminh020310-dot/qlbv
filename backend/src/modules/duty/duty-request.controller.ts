import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit, CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AccessContext } from '../../common/types/access-context';
import { OverrideDto, RequestCreateDto, RequestQueryDto, RequestRespondDto } from './duty.dto';
import { DutyRequestService } from './duty-request.service';

@ApiTags('Lịch bác sĩ khám bệnh')
@ApiBearerAuth()
@Controller('duty')
export class DutyRequestController {
  constructor(private readonly service: DutyRequestService) {}

  @Get('requests')
  @RequirePermissions(['duty.manage', 'duty.manage-all', 'duty.swap.approve', 'duty.exception.resolve'], 'any')
  @ApiOperation({ summary: 'Hộp yêu cầu đổi/nhường ca dành cho người xếp lịch, trong phạm vi được giao' })
  list(@CurrentUser() user: AccessContext, @Query() q: RequestQueryDto) {
    return this.service.list(user, q);
  }

  @Post('requests')
  @RequirePermissions('duty.register')
  @Audit({ module: 'DUTY', action: 'CREATE', entity: 'duty_request', description: 'Tạo yêu cầu nhường/đổi/ngoại lệ ca khám' })
  create(@CurrentUser() user: AccessContext, @Body() dto: RequestCreateDto) {
    return this.service.create(user, dto);
  }

  @Post('requests/:id/accept')
  @RequirePermissions('duty.register')
  @Audit({ module: 'DUTY', action: 'ACCEPT', entity: 'duty_request', description: 'Đồng ý nhận/đổi ca' })
  accept(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    return this.service.accept(user, id);
  }

  @Post('requests/:id/decline')
  @RequirePermissions('duty.register')
  @Audit({ module: 'DUTY', action: 'DECLINE', entity: 'duty_request', description: 'Từ chối nhận/đổi ca' })
  decline(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Body() dto: RequestRespondDto) {
    return this.service.decline(user, id, dto ?? {});
  }

  @Post('requests/:id/cancel')
  @RequirePermissions('duty.register')
  @Audit({ module: 'DUTY', action: 'CANCEL', entity: 'duty_request', description: 'Huỷ yêu cầu ca khám' })
  cancel(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    return this.service.cancel(user, id);
  }

  @Post('requests/:id/approve')
  @RequirePermissions(['duty.swap.approve', 'duty.exception.resolve'], 'any')
  @Audit({ module: 'DUTY', action: 'APPROVE', entity: 'duty_request', description: 'Duyệt yêu cầu ca khám' })
  approve(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Body() dto: RequestRespondDto) {
    return this.service.approve(user, id, dto ?? {});
  }

  @Post('requests/:id/reject')
  @RequirePermissions(['duty.swap.approve', 'duty.exception.resolve'], 'any')
  @Audit({ module: 'DUTY', action: 'REJECT', entity: 'duty_request', description: 'Từ chối yêu cầu ca khám' })
  reject(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Body() dto: RequestRespondDto) {
    return this.service.reject(user, id, dto ?? {});
  }

  @Post('exceptions/override')
  @RequirePermissions('duty.exception.resolve')
  @Audit({ module: 'DUTY', action: 'OVERRIDE', entity: 'duty_assignment', description: 'Điều chỉnh bác sĩ khám trực tiếp (ngoại lệ, có lý do)' })
  @ApiOperation({ summary: 'KHTH đổi bác sĩ khám trực tiếp, kể cả sau khi chốt (bắt buộc lý do)' })
  override(@CurrentUser() user: AccessContext, @Body() dto: OverrideDto) {
    return this.service.override(user, dto);
  }
}
