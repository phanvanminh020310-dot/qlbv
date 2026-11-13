import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit, RequirePermissions } from '../../common/decorators';
import { CreateManagementPositionDto, ManagementPositionQueryDto, UpdateManagementPositionDto } from './management-positions.dto';
import { ManagementPositionsService } from './management-positions.service';

@ApiTags('Danh mục chức vụ')
@ApiBearerAuth()
@Controller('management-positions')
export class ManagementPositionsController {
  constructor(private readonly service: ManagementPositionsService) {}

  @Get()
  @RequirePermissions('management_position.view')
  @ApiOperation({ summary: 'Danh sách chức vụ quản lý/kiêm nhiệm' })
  list(@Query() query: ManagementPositionQueryDto) {
    return this.service.list(query);
  }

  @Get('options')
  @ApiOperation({ summary: 'Danh sách chức vụ đang dùng cho ô chọn nhiều' })
  options() {
    return this.service.options();
  }

  @Get(':id')
  @RequirePermissions('management_position.view')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('management_position.create')
  @Audit({ module: 'ADMIN', action: 'CREATE', entity: 'management_position', description: 'Thêm chức vụ' })
  create(@Body() dto: CreateManagementPositionDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @RequirePermissions('management_position.update')
  @Audit({ module: 'ADMIN', action: 'UPDATE', entity: 'management_position', description: 'Sửa chức vụ' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateManagementPositionDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('management_position.delete')
  @Audit({ module: 'ADMIN', action: 'DELETE', entity: 'management_position', description: 'Xoá chức vụ' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
