import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Audit, RequirePermissions } from '../../common/decorators';
import { CatalogQueryDto, ClosedDayDto, RoleDto, RoomDto, ShiftDto, UpdateClosedDayDto, UpdateRoleDto, UpdateRoomDto, UpdateShiftDto } from './duty.dto';
import { DutyCatalogService } from './duty-catalog.service';

@ApiTags('Danh mục lịch khám')
@ApiBearerAuth()
@Controller('duty')
export class DutyCatalogController {
  constructor(private readonly service: DutyCatalogService) {}

  /* Phòng khám */
  @Get('rooms')
  @RequirePermissions('duty.view')
  listRooms(@Query() q: CatalogQueryDto) {
    return this.service.listRooms(q);
  }

  @Get('rooms/options')
  @RequirePermissions('duty.view')
  roomOptions() {
    return this.service.roomOptions();
  }

  @Post('rooms')
  @RequirePermissions('duty.catalog.manage')
  @Audit({ module: 'DUTY', action: 'CREATE', entity: 'duty_room', description: 'Thêm phòng khám' })
  createRoom(@Body() dto: RoomDto) {
    return this.service.createRoom(dto);
  }

  @Put('rooms/:id')
  @RequirePermissions('duty.catalog.manage')
  @Audit({ module: 'DUTY', action: 'UPDATE', entity: 'duty_room', description: 'Sửa phòng khám' })
  updateRoom(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoomDto) {
    return this.service.updateRoom(id, dto);
  }

  @Delete('rooms/:id')
  @RequirePermissions('duty.catalog.manage')
  @Audit({ module: 'DUTY', action: 'DELETE', entity: 'duty_room', description: 'Xoá phòng khám' })
  removeRoom(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeRoom(id);
  }

  /* Ca khám */
  @Get('shifts')
  @RequirePermissions('duty.view')
  listShifts(@Query() q: CatalogQueryDto) {
    return this.service.listShifts(q);
  }

  @Get('shifts/options')
  @RequirePermissions('duty.view')
  shiftOptions() {
    return this.service.shiftOptions();
  }

  @Post('shifts')
  @RequirePermissions('duty.catalog.manage')
  @Audit({ module: 'DUTY', action: 'CREATE', entity: 'duty_shift', description: 'Thêm ca khám' })
  createShift(@Body() dto: ShiftDto) {
    return this.service.createShift(dto);
  }

  @Put('shifts/:id')
  @RequirePermissions('duty.catalog.manage')
  @Audit({ module: 'DUTY', action: 'UPDATE', entity: 'duty_shift', description: 'Sửa ca khám' })
  updateShift(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateShiftDto) {
    return this.service.updateShift(id, dto);
  }

  @Delete('shifts/:id')
  @RequirePermissions('duty.catalog.manage')
  @Audit({ module: 'DUTY', action: 'DELETE', entity: 'duty_shift', description: 'Xoá ca khám' })
  removeShift(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeShift(id);
  }

  /* Vai trò khám */
  @Get('roles')
  @RequirePermissions('duty.view')
  listRoles(@Query() q: CatalogQueryDto) {
    return this.service.listRoles(q);
  }

  @Get('roles/options')
  @RequirePermissions('duty.view')
  roleOptions() {
    return this.service.roleOptions();
  }

  @Post('roles')
  @RequirePermissions('duty.catalog.manage')
  @Audit({ module: 'DUTY', action: 'CREATE', entity: 'duty_role', description: 'Thêm vai trò khám' })
  createRole(@Body() dto: RoleDto) {
    return this.service.createRole(dto);
  }

  @Put('roles/:id')
  @RequirePermissions('duty.catalog.manage')
  @Audit({ module: 'DUTY', action: 'UPDATE', entity: 'duty_role', description: 'Sửa vai trò khám' })
  updateRole(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoleDto) {
    return this.service.updateRole(id, dto);
  }

  @Delete('roles/:id')
  @RequirePermissions('duty.catalog.manage')
  @Audit({ module: 'DUTY', action: 'DELETE', entity: 'duty_role', description: 'Xoá vai trò khám' })
  removeRole(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeRole(id);
  }

  /* Ngày nghỉ */
  @Get('closed-days')
  @RequirePermissions('duty.view')
  listClosedDays(@Query() q: CatalogQueryDto) {
    return this.service.listClosedDays(q);
  }

  @Post('closed-days')
  @RequirePermissions('duty.catalog.manage')
  @Audit({ module: 'DUTY', action: 'CREATE', entity: 'duty_closed_day', description: 'Thêm ngày nghỉ (không sinh ca khám)' })
  createClosedDay(@Body() dto: ClosedDayDto) {
    return this.service.createClosedDay(dto);
  }

  @Put('closed-days/:id')
  @RequirePermissions('duty.catalog.manage')
  @Audit({ module: 'DUTY', action: 'UPDATE', entity: 'duty_closed_day', description: 'Sửa ngày nghỉ' })
  updateClosedDay(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateClosedDayDto) {
    return this.service.updateClosedDay(id, dto);
  }

  @Delete('closed-days/:id')
  @RequirePermissions('duty.catalog.manage')
  @Audit({ module: 'DUTY', action: 'DELETE', entity: 'duty_closed_day', description: 'Xoá ngày nghỉ' })
  removeClosedDay(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeClosedDay(id);
  }
}
