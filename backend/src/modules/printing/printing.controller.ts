import {
  Body,
  Controller,
  StreamableFile,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Audit, ClientInfo, CurrentUser, RequirePermissions } from '../../common/decorators';
import { AdvancedQueryDto } from '../../common/dto/query.dto';
import type { AccessContext, ClientMeta } from '../../common/types/access-context';
import type { PrintDocument } from '../../db/schema/printing';
import { PrintingService } from './printing.service';
import { AUTO_PARAMS, PRINT_SQL_PERMISSION, PrintSqlService, buildSqlExport, normalizeSqlSource } from './print-sql-source';
import {
  DEFAULT_FONT_FAMILY,
  FONT_VARIANTS,
  deleteCustomFont,
  fontRegistry,
  saveCustomFont,
  type FontVariant,
} from '../../infra/rendering/font-registry';

interface RenderBody {
  data?: Record<string, unknown>;
  rows?: Record<string, unknown>[];
  /** Thiết kế trực tiếp (trình thiết kế gửi lên để xem trước) */
  document?: PrintDocument;
  /** Giá trị tham số cho nguồn dữ liệu SQL của mẫu */
  params?: Record<string, unknown>;
}

@ApiTags('Thiết kế bản in')
@ApiBearerAuth()
@Controller('print')
export class PrintingController {
  constructor(
    private readonly service: PrintingService,
    private readonly sqlSource: PrintSqlService,
  ) {}

  /* -------------------------------------------------------------- Mẫu in */

  @Get('templates')
  @RequirePermissions('print.template.view')
  @ApiOperation({ summary: 'Danh sách mẫu in' })
  list(@Query() query: AdvancedQueryDto) {
    return this.service.list(query);
  }

  @Get('templates/:id')
  @RequirePermissions('print.template.view')
  @ApiOperation({ summary: 'Chi tiết mẫu in (kèm toàn bộ thiết kế JSON)' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Get('templates/:id/versions')
  @RequirePermissions('print.template.view')
  @ApiOperation({ summary: 'Lịch sử phiên bản thiết kế' })
  versions(@Param('id', ParseIntPipe) id: number) {
    return this.service.versions(id);
  }

  @Post('templates')
  @RequirePermissions('print.template.create')
  @Audit({ module: 'PRINT', action: 'CREATE', entity: 'print_template', description: 'Thêm mẫu in' })
  @ApiOperation({ summary: 'Tạo mẫu in mới' })
  create(@Body() body: Record<string, unknown>, @CurrentUser() user: AccessContext) {
    return this.service.create(body as never, user);
  }

  @Put('templates/:id')
  @RequirePermissions('print.template.update')
  @Audit({ module: 'PRINT', action: 'UPDATE', entity: 'print_template', description: 'Sửa thiết kế mẫu in' })
  @ApiOperation({ summary: 'Cập nhật thiết kế (tự tăng phiên bản)' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AccessContext,
  ) {
    return this.service.update(id, body as never, user);
  }

  @Post('templates/:id/duplicate')
  @RequirePermissions('print.template.create')
  @ApiOperation({ summary: 'Sao chép mẫu in' })
  duplicate(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { code: string; name?: string },
    @CurrentUser() user: AccessContext,
  ) {
    return this.service.duplicate(id, body.code, body.name, user);
  }

  @Post('templates/:id/restore/:version')
  @RequirePermissions('print.template.update')
  @ApiOperation({ summary: 'Khôi phục thiết kế về phiên bản cũ' })
  restore(
    @Param('id', ParseIntPipe) id: number,
    @Param('version', ParseIntPipe) version: number,
    @CurrentUser() user: AccessContext,
  ) {
    return this.service.restore(id, version, user);
  }

  @Patch('templates/:id/publish')
  @RequirePermissions('print.template.publish')
  @ApiOperation({ summary: 'Ban hành / ngừng sử dụng mẫu in' })
  publish(@Param('id', ParseIntPipe) id: number, @Body() body: { active: boolean }) {
    return this.service.setActive(id, body.active);
  }

  @Delete('templates/:id')
  @RequirePermissions('print.template.delete')
  @Audit({ module: 'PRINT', action: 'DELETE', entity: 'print_template', description: 'Xoá mẫu in' })
  @ApiOperation({ summary: 'Xoá mẫu in' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  /* ------------------------------------------------------------ Font chữ */

  @Get('fonts')
  @RequirePermissions('print.template.view')
  @ApiOperation({ summary: 'Danh sách font dùng cho bản in (mặc định Times New Roman)' })
  fonts() {
    return { default: DEFAULT_FONT_FAMILY, families: fontRegistry.families() };
  }

  /** Tệp font đúng như PDF sẽ nhúng — trình thiết kế nạp vào để hiển thị giống hệt bản in */
  @Get('fonts/file')
  @RequirePermissions('print.template.view')
  @ApiOperation({ summary: 'Tải tệp font (family, variant=regular|bold|italic|boldItalic)' })
  fontFile(
    @Query('family') family: string,
    @Query('variant') variant: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = (FONT_VARIANTS as string[]).includes(variant) ? (variant as FontVariant) : 'regular';
    const entry = fontRegistry.resolve(family || DEFAULT_FONT_FAMILY, v);
    res.set({
      'Content-Type': /\.otf$/i.test(entry.file) ? 'font/otf' : 'font/ttf',
      'Cache-Control': 'private, max-age=3600',
      'X-Font-Source': entry.source,
      'X-Font-Family': encodeURIComponent(entry.family),
    });
    return new StreamableFile(fontRegistry.bytes(entry));
  }

  /**
   * Tải font lên (vd times.ttf, timesbd.ttf, timesi.ttf, timesbi.ttf của Windows) —
   * gửi nội dung tệp thô (application/octet-stream), tên tệp ở ?name=
   */
  @Post('fonts')
  @RequirePermissions('print.template.update')
  @Audit({ module: 'PRINT', action: 'UPLOAD', entity: 'print_font', description: 'Tải font bản in lên' })
  @ApiOperation({ summary: 'Tải tệp font TTF/OTF lên — tự nhận diện họ font và kiểu chữ' })
  async uploadFont(@Req() req: Request, @Query('name') name: string) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > 30 * 1024 * 1024) throw new BadRequestException('Tệp font quá lớn (tối đa 30 MB)');
      chunks.push(chunk);
    }
    if (!size) throw new BadRequestException('Chưa chọn tệp font');
    if (name && !/\.(ttf|otf)$/i.test(name)) {
      throw new BadRequestException('Chỉ nhận tệp font .ttf hoặc .otf');
    }
    return saveCustomFont(Buffer.concat(chunks), String(name ?? 'font.ttf'));
  }

  @Delete('fonts')
  @RequirePermissions('print.template.update')
  @Audit({ module: 'PRINT', action: 'DELETE', entity: 'print_font', description: 'Xoá font bản in đã tải lên' })
  @ApiOperation({ summary: 'Xoá font đã tải lên (quay về font tương thích nhúng sẵn)' })
  removeFont(@Query('family') family: string, @Query('variant') variant?: string) {
    const v = variant && (FONT_VARIANTS as string[]).includes(variant) ? (variant as FontVariant) : undefined;
    return deleteCustomFont(family, v);
  }

  /* ------------------------------------------------------------- Kết xuất */

  @Post('preview')
  @RequirePermissions('print.render.view')
  @ApiOperation({ summary: 'Xem trước bản in từ thiết kế đang chỉnh (trả về PDF)' })
  async preview(
    @Body() body: RenderBody,
    @CurrentUser() user: AccessContext,
    @ClientInfo() client: ClientMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const document = body.document;
    if (!document) return { error: 'Thiếu thiết kế bản in (document)' };
    // SQL trong thiết kế chưa lưu chỉ chạy cho người có quyền soạn nguồn dữ liệu SQL
    const sqlContext = this.sqlSource.canAuthor(user) ? { user, params: body.params, meta: client } : undefined;
    const resolved = await this.service.resolveSqlData(document, body.data ?? {}, body.rows ?? [], sqlContext, null);
    const result = await this.service.renderRaw(document, resolved.data, resolved.rows);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="xem-truoc.pdf"',
      'X-Print-Pages': String(result.pages),
    });
    return new StreamableFile(result.buffer);
  }

  @Post('templates/:id/render')
  @RequirePermissions('print.render.export')
  @ApiOperation({ summary: 'Kết xuất mẫu in ra PDF với dữ liệu truyền vào' })
  async render(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: RenderBody,
    @Query('download') download: string | undefined,
    @CurrentUser() user: AccessContext,
    @ClientInfo() client: ClientMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { template, result } = await this.service.renderTemplate(
      id,
      body.data ?? {},
      body.rows ?? [],
      { user, params: body.params, meta: client },
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download === '1' ? 'attachment' : 'inline'}; filename="${encodeURIComponent(template.code)}.pdf"`,
      'X-Print-Pages': String(result.pages),
    });
    return new StreamableFile(result.buffer);
  }

  /* ------------------------------------------------------ Nguồn dữ liệu SQL */

  @Post('sql/test')
  @RequirePermissions(PRINT_SQL_PERMISSION)
  @ApiOperation({ summary: 'Chạy thử nguồn dữ liệu SQL của mẫu in (tối đa 100 dòng mỗi truy vấn)' })
  async testSql(
    @Body() body: { sqlSource?: unknown; params?: Record<string, unknown> },
    @CurrentUser() user: AccessContext,
    @ClientInfo() client: ClientMeta,
  ) {
    const source = normalizeSqlSource(body.sqlSource);
    if (!source) throw new BadRequestException('Chưa có truy vấn nào');
    const out = await this.sqlSource.run(user, source, body.params ?? {}, { maxRows: 100, meta: client, purpose: 'test' });
    return {
      // Kèm câu SQL đã chuẩn hoá (truy vấn chọn bảng: SQL do máy chủ sinh) để người soạn xem/chuyển sang viết SQL
      queries: out.queries.map((q) => ({ ...q, sql: source.queries.find((x) => x.key === q.key)?.sql ?? '', rows: out.data.ds[q.key] ?? [] })),
      params: out.data.params,
    };
  }

  @Post('sql/export')
  @RequirePermissions(PRINT_SQL_PERMISSION)
  @ApiOperation({ summary: 'Xuất Excel (mỗi truy vấn một sheet) hoặc CSV dữ liệu nguồn SQL (tối đa 5.000 dòng mỗi truy vấn)' })
  async exportSql(
    @Body() body: { sqlSource?: unknown; params?: Record<string, unknown>; format?: string; queryKey?: string },
    @CurrentUser() user: AccessContext,
    @ClientInfo() client: ClientMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const source = normalizeSqlSource(body.sqlSource);
    if (!source) throw new BadRequestException('Chưa có truy vấn nào');
    const format = body.format === 'csv' ? 'csv' : 'xlsx';
    const out = await this.sqlSource.run(user, source, body.params ?? {}, { meta: client, purpose: 'export' });
    const file = await buildSqlExport(out, format, typeof body.queryKey === 'string' ? body.queryKey : undefined);
    res.set({
      'Content-Type': file.mime,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(file.fileName)}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    });
    return new StreamableFile(file.buffer);
  }

  @Get('sql/catalog')
  @RequirePermissions(PRINT_SQL_PERMISSION)
  @ApiOperation({ summary: 'Danh mục view/bảng gợi ý khi soạn SQL cho mẫu in' })
  sqlCatalog() {
    return this.service.sqlCatalog().then((items) => ({ items, autoParams: AUTO_PARAMS }));
  }

  @Get('modules')
  @RequirePermissions('print.template.view')
  @ApiOperation({ summary: 'Danh mục phân hệ + loại chứng từ đã dùng (mã phân hệ là chuỗi tự do, phân hệ mới tự xuất hiện)' })
  modules() {
    return this.service.modules().then((items) => ({ items }));
  }

  @Post('fields')
  @RequirePermissions('print.template.view')
  @ApiOperation({ summary: 'Trường dữ liệu của mẫu theo nguồn SQL/chọn bảng (tên cột, kiểu, nhãn tiếng Việt) — không đọc dữ liệu' })
  fields(@Body() body: { templateId?: number | null; sqlSource?: unknown }, @CurrentUser() user: AccessContext) {
    return this.service.fields(user, body ?? {});
  }

  @Get('available')
  @RequirePermissions('print.render.view')
  @ApiOperation({ summary: 'Mẫu in tự lấy dữ liệu (nguồn SQL) dùng được — lọc theo phân hệ' })
  available(@Query('module') module: string | undefined, @CurrentUser() user: AccessContext) {
    return this.service.available(user, module || null).then((items) => ({ items }));
  }

  /** Mẫu in mặc định theo loại chứng từ — dùng cho các nút "In" ở phân hệ khác */
  @Get('resolve/:docType')
  @RequirePermissions('print.render.view')
  @ApiOperation({ summary: 'Tìm mẫu in đang áp dụng theo loại chứng từ' })
  async resolve(@Param('docType') docType: string, @Query('departmentId') departmentId?: string) {
    const found = await this.service.resolveFor(
      docType,
      departmentId ? Number(departmentId) : null,
    );
    if (!found) return { found: false, docType };
    const source = (() => {
      try {
        return normalizeSqlSource((found.document as { sqlSource?: unknown }).sqlSource);
      } catch {
        return null;
      }
    })();
    return {
      found: true,
      params: source?.params ?? [],
      id: found.id,
      code: found.code,
      name: found.name,
      paperSize: found.paperSize,
      orientation: found.orientation,
      version: found.version,
    };
  }
}
