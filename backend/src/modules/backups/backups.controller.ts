import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Audit, ClientInfo, CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AccessContext, ClientMeta } from '../../common/types/access-context';
import { BackupsService } from './backups.service';

@ApiTags('Sao lưu & phục hồi')
@ApiBearerAuth()
@Controller('backups')
export class BackupsController {
  constructor(private readonly service: BackupsService) {}

  @Get()
  @RequirePermissions('backup.view')
  @ApiOperation({ summary: 'Danh sách tệp sao lưu trong thư mục sao lưu' })
  list() {
    return this.service.list();
  }

  @Post()
  @RequirePermissions('backup.create')
  @ApiOperation({ summary: 'Sao lưu ngay (ghi vào lịch sử chạy của tác vụ db.backup)' })
  create(@CurrentUser() user: AccessContext) {
    return this.service.create(user, 'thu-cong');
  }

  @Post('cleanup')
  @RequirePermissions('backup.create')
  @Audit({ module: 'BACKUP', action: 'CLEANUP', entity: 'backup_retention', description: 'Áp dụng chính sách giữ bộ sao lưu' })
  @ApiOperation({ summary: 'Dọn bộ backup cũ/tệp backup dở dang theo chính sách Sao lưu & lưu trữ' })
  cleanup(@CurrentUser() user: AccessContext) {
    return this.service.cleanup(user);
  }

  /**
   * Tải lên một tệp sao lưu: gửi nội dung tệp làm thân yêu cầu thô
   * (Content-Type: application/octet-stream), tên tệp gốc ở tham số ?name=
   */
  @Post('upload')
  @RequirePermissions('backup.restore')
  @ApiOperation({ summary: 'Tải lên tệp sao lưu (.json.gz) từ máy tính' })
  upload(@Req() req: Request, @Query('name') name: string, @CurrentUser() user: AccessContext) {
    return this.service.upload(req, name, user);
  }

  @Get(':name')
  @RequirePermissions('backup.view')
  @ApiOperation({ summary: 'Chi tiết một bản sao lưu (số dòng từng bảng, có phục hồi được không)' })
  detail(@Param('name') name: string) {
    return this.service.detail(name);
  }

  @Get(':name/storage/download')
  @RequirePermissions('backup.view')
  @ApiOperation({ summary: 'Tải gói tệp lưu trữ đi kèm bản sao lưu (HSBA, ảnh khuôn mặt, phông tải lên)' })
  downloadStorage(@Param('name') name: string, @Res({ passthrough: true }) res: Response) {
    const f = this.service.downloadStorage(name);
    res.set({
      'Content-Type': 'application/gzip',
      'Content-Length': String(f.size),
      'Content-Disposition': `attachment; filename="${encodeURIComponent(f.fileName)}"`,
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(f.stream);
  }

  @Get(':name/download')
  @RequirePermissions('backup.view')
  @ApiOperation({ summary: 'Tải phần CSDL của bản sao lưu về máy' })
  download(@Param('name') name: string, @Res({ passthrough: true }) res: Response) {
    const f = this.service.download(name);
    res.set({
      'Content-Type': 'application/gzip',
      'Content-Length': String(f.size),
      'Content-Disposition': `attachment; filename="${encodeURIComponent(f.fileName)}"`,
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(f.stream);
  }

  @Delete(':name')
  @RequirePermissions('backup.create')
  @ApiOperation({ summary: 'Xoá một tệp sao lưu' })
  remove(@Param('name') name: string, @CurrentUser() user: AccessContext) {
    return this.service.remove(name, user);
  }

  @Post(':name/restore')
  @RequirePermissions('backup.restore')
  @ApiOperation({ summary: 'Phục hồi toàn bộ dữ liệu từ bản sao lưu (tự tạo bản an toàn trước)' })
  restore(
    @Param('name') name: string,
    @Body() body: { confirm?: string },
    @CurrentUser() user: AccessContext,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.service.restore(name, body?.confirm ?? '', user, client);
  }
}
