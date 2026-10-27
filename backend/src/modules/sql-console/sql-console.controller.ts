import { Body, Controller, Get, Post, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import type { Response } from 'express';
import { ClientInfo, CurrentUser } from '../../common/decorators';
import type { AccessContext, ClientMeta } from '../../common/types/access-context';
import { SqlConsoleService, type ExportFormat } from './sql-console.service';

class ReadSqlDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100_000)
  statement!: string;
}

class WriteSqlDto extends ReadSqlDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;

  @IsString()
  @MaxLength(32)
  confirm!: string;
}

class ExportSqlDto extends ReadSqlDto {
  @IsIn(['xlsx', 'csv', 'json'])
  format!: ExportFormat;
}

@ApiTags('SQL Console quản trị')
@ApiBearerAuth()
@Controller('admin/sql')
export class SqlConsoleController {
  constructor(private readonly service: SqlConsoleService) {}

  @Get('schema')
  @ApiOperation({ summary: 'Danh sách bảng/cột public cho SQL Console (ADMIN/SUPER_ADMIN)' })
  schema(@CurrentUser() user: AccessContext) {
    return this.service.schema(user);
  }

  @Post('query')
  @ApiOperation({ summary: 'Chạy SELECT, WITH hoặc EXPLAIN an toàn; xem trước tối đa 1.000 dòng' })
  query(@Body() dto: ReadSqlDto, @CurrentUser() user: AccessContext, @ClientInfo() meta: ClientMeta) {
    return this.service.query(user, dto.statement, meta);
  }

  @Post('execute')
  @ApiOperation({ summary: 'Chạy INSERT, UPDATE hoặc DELETE có xác nhận/lý do; UPDATE/DELETE bắt buộc WHERE' })
  execute(@Body() dto: WriteSqlDto, @CurrentUser() user: AccessContext, @ClientInfo() meta: ClientMeta) {
    return this.service.execute(user, dto.statement, dto.reason, dto.confirm, meta);
  }

  @Post('export')
  @ApiOperation({ summary: 'Xuất kết quả SELECT ra Excel, CSV hoặc JSON (tối đa 10.000 dòng)' })
  async export(
    @Body() dto: ExportSqlDto,
    @CurrentUser() user: AccessContext,
    @ClientInfo() meta: ClientMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.service.export(user, dto.statement, dto.format, meta);
    res.set({
      'Content-Type': file.mime,
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(file.buffer);
  }
}
