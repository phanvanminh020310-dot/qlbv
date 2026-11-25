/**
 * Phân hệ THIẾT KẾ BẢN IN.
 *
 * Mẫu in là dữ liệu JSON (mm) → có thể tạo/sửa/khoa bản in tuỳ ý từ giao diện,
 * không cần sửa mã nguồn. Mỗi lần sửa tạo một phiên bản (`print_template_versions`)
 * để khôi phục lại thiết kế cũ.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrintSqlService, normalizeSqlSource } from './print-sql-source';
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { printTemplateVersions, printTemplates } from '../../db/schema';
import type { PrintDocument } from '../../db/schema/printing';
import type { PrintModule } from '../../db/schema/types';
import { buildPage, type AdvancedQueryDto, type Paginated, parseFilters } from '../../common/dto/query.dto';
import { renderPrintDocument, type RenderContext } from '../../infra/rendering/pdf-renderer';
import { pushFilters, type FilterTarget } from '../../common/filters/apply-filter';

import type { AccessContext, ClientMeta } from '../../common/types/access-context';

export interface PrintTemplateInput {
  code: string;
  name: string;
  description?: string;
  module?: PrintModule;
  docType?: string;
  paperSize?: string;
  orientation?: 'portrait' | 'landscape';
  document: PrintDocument;
  thumbnail?: string;
  isDefault?: boolean;
  departmentId?: number | null;
  active?: boolean;
  /** Ghi chú phiên bản khi lưu */
  versionNote?: string;
}

/** Trường lọc nâng cao của danh sách mẫu in. */
const PRINT_FILTERS: Record<string, FilterTarget> = {
  module: { expr: printTemplates.module, type: 'text' },
  docType: { expr: printTemplates.docType, type: 'text' },
  paperSize: { expr: printTemplates.paperSize, type: 'text' },
  active: { expr: printTemplates.active, type: 'bool' },
  departmentId: { expr: printTemplates.departmentId, type: 'number' },
};

@Injectable()
export class PrintingService {
  constructor(
    private readonly db: DbService,
    @Optional() private readonly sqlSource?: PrintSqlService,
  ) {}

  /* --------------------------------------------------------------- Mẫu in */

  async list(query: AdvancedQueryDto): Promise<Paginated<Record<string, unknown>>> {
    const where: SQL[] = [];
    if (query.q?.trim()) {
      const like = `%${query.q.trim()}%`;
      where.push(
        or(
          ilike(printTemplates.name, like),
          ilike(printTemplates.code, like),
          ilike(printTemplates.docType, like),
          ilike(printTemplates.description, like),
        ) as SQL,
      );
    }
    if (query.activeOnly) where.push(eq(printTemplates.active, true));
    pushFilters(where, parseFilters(query.filters), PRINT_FILTERS);
    const condition = where.length ? and(...where) : undefined;

    const [countRow] = await this.db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(printTemplates)
      .where(condition);

    const rows = await this.db.db
      .select({
        id: printTemplates.id,
        code: printTemplates.code,
        name: printTemplates.name,
        description: printTemplates.description,
        module: printTemplates.module,
        docType: printTemplates.docType,
        paperSize: printTemplates.paperSize,
        orientation: printTemplates.orientation,
        thumbnail: printTemplates.thumbnail,
        version: printTemplates.version,
        isDefault: printTemplates.isDefault,
        departmentId: printTemplates.departmentId,
        active: printTemplates.active,
        createdAt: printTemplates.createdAt,
        updatedAt: printTemplates.updatedAt,
      })
      .from(printTemplates)
      .where(condition)
      .orderBy(asc(printTemplates.module), asc(printTemplates.name))
      .limit(query.limit)
      .offset(query.offset);

    return buildPage(rows, countRow?.total ?? 0, query.page, query.limit);
  }

  async findOne(id: number) {
    const [row] = await this.db.db.select().from(printTemplates).where(eq(printTemplates.id, id));
    if (!row) throw new NotFoundException('Không tìm thấy mẫu in');
    return row;
  }

  async findByCode(code: string) {
    const [row] = await this.db.db
      .select()
      .from(printTemplates)
      .where(and(eq(printTemplates.code, code), eq(printTemplates.active, true)));
    return row ?? null;
  }

  /** Lấy mẫu in đang dùng cho một nghiệp vụ: ưu tiên mẫu riêng của khoa → mẫu mặc định */
  async resolveFor(docType: string, departmentId?: number | null) {
    if (departmentId) {
      const [deptTemplate] = await this.db.db
        .select()
        .from(printTemplates)
        .where(
          and(
            eq(printTemplates.docType, docType),
            eq(printTemplates.departmentId, departmentId),
            eq(printTemplates.active, true),
          ),
        )
        .orderBy(desc(printTemplates.version))
        .limit(1);
      if (deptTemplate) return deptTemplate;
    }
    const [defaultTemplate] = await this.db.db
      .select()
      .from(printTemplates)
      .where(
        and(
          eq(printTemplates.docType, docType),
          eq(printTemplates.active, true),
          or(isNull(printTemplates.departmentId), eq(printTemplates.isDefault, true)) as SQL,
        ),
      )
      .orderBy(desc(printTemplates.isDefault), desc(printTemplates.version))
      .limit(1);
    return defaultTemplate ?? null;
  }

  async create(dto: PrintTemplateInput, user?: AccessContext, opts: { copiedFrom?: PrintDocument } = {}) {
    // Nhân bản giữ nguyên SQL đã được người có quyền soạn — chỉ chặn khi SQL khác bản gốc
    if (user && this.sqlSource) this.sqlSource.assertCanSave(user, dto.document, opts.copiedFrom);
    const [dup] = await this.db.db
      .select({ id: printTemplates.id })
      .from(printTemplates)
      .where(eq(printTemplates.code, dto.code));
    if (dup) throw new ConflictException(`Mã mẫu in "${dto.code}" đã tồn tại`);

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(printTemplates)
        .values({
          code: dto.code,
          name: dto.name,
          description: dto.description ?? '',
          module: dto.module ?? 'GENERIC',
          docType: dto.docType ?? '',
          paperSize: dto.paperSize ?? 'A4',
          orientation: dto.orientation ?? 'portrait',
          document: dto.document,
          thumbnail: dto.thumbnail ?? '',
          isDefault: dto.isDefault ?? false,
          departmentId: dto.departmentId ?? null,
          active: dto.active ?? true,
          createdBy: user?.id ?? null,
        })
        .returning();

      await tx.insert(printTemplateVersions).values({
        templateId: row.id,
        version: 1,
        document: row.document,
        note: dto.versionNote ?? 'Khởi tạo',
        createdBy: user?.id ?? null,
      });

      if (dto.isDefault && row.docType) {
        await tx
          .update(printTemplates)
          .set({ isDefault: false })
          .where(and(eq(printTemplates.docType, row.docType), sql`${printTemplates.id} <> ${row.id}`));
      }
      return row;
    });
  }

  /** Cập nhật thiết kế — tự động tăng phiên bản và lưu lại bản cũ */
  async update(id: number, dto: Partial<PrintTemplateInput>, user?: AccessContext) {
    const current = await this.findOne(id);
    if (user && this.sqlSource && dto.document !== undefined) this.sqlSource.assertCanSave(user, dto.document, current.document);
    const documentChanged =
      dto.document !== undefined &&
      JSON.stringify(dto.document) !== JSON.stringify(current.document);
    const nextVersion = documentChanged ? current.version + 1 : current.version;

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(printTemplates)
        .set({
          code: dto.code ?? current.code,
          name: dto.name ?? current.name,
          description: dto.description ?? current.description,
          module: dto.module ?? current.module,
          docType: dto.docType ?? current.docType,
          paperSize: dto.paperSize ?? current.paperSize,
          orientation: (dto.orientation ?? current.orientation) as 'portrait' | 'landscape',
          document: dto.document ?? current.document,
          thumbnail: dto.thumbnail ?? current.thumbnail,
          isDefault: dto.isDefault ?? current.isDefault,
          departmentId: dto.departmentId === undefined ? current.departmentId : dto.departmentId,
          active: dto.active ?? current.active,
          version: nextVersion,
          updatedAt: new Date(),
        })
        .where(eq(printTemplates.id, id))
        .returning();

      if (documentChanged) {
        await tx.insert(printTemplateVersions).values({
          templateId: id,
          version: nextVersion,
          document: dto.document as PrintDocument,
          note: dto.versionNote ?? `Cập nhật lên phiên bản ${nextVersion}`,
          createdBy: user?.id ?? null,
        });
        await tx
          .delete(printTemplateVersions)
          .where(
            and(
              eq(printTemplateVersions.templateId, id),
              sql`${printTemplateVersions.version} < ${nextVersion - 20}`,
            ),
          );
      }
      if (row.isDefault && row.docType) {
        await tx
          .update(printTemplates)
          .set({ isDefault: false })
          .where(and(eq(printTemplates.docType, row.docType), sql`${printTemplates.id} <> ${id}`));
      }
      return row;
    });
  }

  async remove(id: number): Promise<{ deleted: boolean }> {
    const row = await this.findOne(id);
    if (row.isDefault) {
      throw new BadRequestException('Không thể xoá mẫu in mặc định — hãy đặt mẫu khác làm mặc định trước');
    }
    await this.db.db.delete(printTemplates).where(eq(printTemplates.id, id));
    return { deleted: true };
  }

  /** Nhân bản mẫu in (kèm tuỳ chọn đổi mã/tên) */
  async duplicate(id: number, newCode: string, newName?: string, user?: AccessContext) {
    const src = await this.findOne(id);
    return this.create(
      {
        code: newCode,
        name: newName ?? `${src.name} (bản sao)`,
        description: src.description,
        module: src.module,
        docType: src.docType,
        paperSize: src.paperSize,
        orientation: src.orientation as 'portrait' | 'landscape',
        document: src.document,
        departmentId: src.departmentId,
        isDefault: false,
        versionNote: `Sao chép từ ${src.code} v${src.version}`,
      },
      user,
      { copiedFrom: src.document },
    );
  }

  /** Danh sách phiên bản để khôi phục */
  async versions(id: number) {
    await this.findOne(id);
    return this.db.db
      .select({
        id: printTemplateVersions.id,
        version: printTemplateVersions.version,
        note: printTemplateVersions.note,
        createdBy: printTemplateVersions.createdBy,
        createdAt: printTemplateVersions.createdAt,
      })
      .from(printTemplateVersions)
      .where(eq(printTemplateVersions.templateId, id))
      .orderBy(desc(printTemplateVersions.version));
  }

  /** Khôi phục về một phiên bản cũ (tạo phiên bản mới từ bản cũ) */
  async restore(id: number, version: number, user?: AccessContext) {
    const [snapshot] = await this.db.db
      .select()
      .from(printTemplateVersions)
      .where(and(eq(printTemplateVersions.templateId, id), eq(printTemplateVersions.version, version)));
    if (!snapshot) throw new NotFoundException(`Không tìm thấy phiên bản ${version}`);
    return this.update(
      id,
      { document: snapshot.document, versionNote: `Khôi phục từ phiên bản ${version}` },
      user,
    );
  }

  /** Ban hành / ngừng sử dụng */
  async setActive(id: number, active: boolean) {
    await this.findOne(id);
    const [row] = await this.db.db
      .update(printTemplates)
      .set({ active, updatedAt: new Date() })
      .where(eq(printTemplates.id, id))
      .returning();
    return row;
  }

  /* --------------------------------------------------------------- Kết xuất */

  /** Render từ dữ liệu thô — dùng cho trình thiết kế (xem trước) */
  async renderRaw(
    document: PrintDocument,
    data: Record<string, unknown> = {},
    rows: Record<string, unknown>[] = [],
  ) {
    const result = await renderPrintDocument(document, { data, rows });
    return result;
  }

  /** Render theo mẫu in đã lưu */
  async renderTemplate(
    idOrCode: number | string,
    data: Record<string, unknown>,
    rows: Record<string, unknown>[] = [],
    sqlContext?: { user: AccessContext; params?: Record<string, unknown>; meta?: ClientMeta },
  ) {
    const template =
      typeof idOrCode === 'number'
        ? await this.findOne(idOrCode)
        : await this.findByCode(String(idOrCode));
    if (!template) throw new NotFoundException('Không tìm thấy mẫu in đang hoạt động');
    const resolved = await this.resolveSqlData(template.document, data, rows, sqlContext, template.id);
    return {
      template,
      result: await renderPrintDocument(template.document, {
        data: resolved.data,
        rows: resolved.rows,
        fileName: template.name,
      }),
    };
  }

  /** View/bảng (không nhạy cảm) cùng cột — gợi ý cho trình soạn SQL mẫu in. Ưu tiên view tiếng Việt v_*. */
  async sqlCatalog(): Promise<Array<{ name: string; kind: string; columns: Array<{ name: string; type: string }> }>> {
    const res = await this.db.db.execute(sql`
      select c.table_name as name, t.table_type as kind, json_agg(json_build_object('name', c.column_name, 'type', c.data_type) order by c.ordinal_position) as columns
        from information_schema.columns c
        join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
       where c.table_schema = 'public'
         and c.table_name not in ('user_biometrics', 'integration_keys', 'settings', 'login_logs', '_qlbs_migrations', 'user_sessions', 'refresh_tokens')
         and c.column_name not in ('password_hash', 'two_factor_secret', 'key_hash', 'secret_hash', 'telegram_chat_id', 'token_hash')
       group by c.table_name, t.table_type
       order by (t.table_type = 'VIEW') desc, c.table_name`);
    const rows = ((res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[])) as Array<{ name: string; kind: string; columns: Array<{ name: string; type: string }> }>;
    return rows.map((r) => ({ name: r.name, kind: r.kind === 'VIEW' ? 'view' : 'table', columns: r.columns }));
  }

  /**
   * Chạy nguồn dữ liệu SQL (nếu mẫu khai báo) rồi trộn vào dữ liệu in.
   * Dữ liệu do phân hệ gửi lên được giữ nguyên; `ds`, `one`, `params` lấy từ máy chủ.
   */
  async resolveSqlData(
    document: PrintDocument,
    data: Record<string, unknown>,
    rows: Record<string, unknown>[],
    sqlContext: { user: AccessContext; params?: Record<string, unknown>; meta?: ClientMeta } | undefined,
    templateId: number | null,
  ): Promise<{ data: Record<string, unknown>; rows: Record<string, unknown>[] }> {
    const source = normalizeSqlSource((document as { sqlSource?: unknown }).sqlSource);
    if (!source || !sqlContext || !this.sqlSource) return { data, rows };
    const out = await this.sqlSource.run(sqlContext.user, source, sqlContext.params ?? {}, { meta: sqlContext.meta, templateId });
    return { data: { ...data, ...out.data }, rows: rows.length ? rows : out.rows };
  }
}
