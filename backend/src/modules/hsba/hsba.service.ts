/**
 * Phân hệ HỒ SƠ BỆNH ÁN — Giấy đề nghị sửa HSBA điện tử.
 *
 * Điểm cốt lõi: quy trình ký KHÔNG set cứng 3 bước. Mọi bước nằm trong
 * `hsba_workflows.steps` (JSON) nên quản trị có thể thêm/bớt/đổi thứ tự bước,
 * đổi vai trò được ký, bật/tắt quyền trả lại… ngay trên giao diện.
 *
 * Trạng thái phiếu luôn suy ra từ bước đang chờ: CHO_<KEY_BƯỚC>.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import {
  departments,
  hsbaAttachments,
  hsbaComments,
  hsbaLogs,
  hsbaRequests,
  hsbaSignatures,
  hsbaWorkflows,
  users,
  type WorkflowStep,
} from '../../db/schema';
import { REQUEST_STATUS_LABELS } from '../../db/schema/types';
import { signPermissionOf } from './sign-permissions';
import { buildPage, type AdvancedQueryDto, type Paginated, parseFilters } from '../../common/dto/query.dto';
import { pushFilters, type FilterTarget } from '../../common/filters/apply-filter';
import type { AccessContext, ClientMeta } from '../../common/types/access-context';
import { PrintingService } from '../printing/printing.service';
import { CacheService } from '../../infra/cache/cache.service';
import { QueueService } from '../../infra/queue/queue.service';
import { RealtimeService } from '../realtime/realtime.service';
import { formatVN } from '../../common/utils/date.util';
import { config } from '../../config/env';
import type {
  CreateAttachmentDto,
  CreateCommentDto,
  CreateRequestDto,
  CreateWorkflowDto,
  DuplicatesQueryDto,
  RequestQueryDto,
  UpdateRequestDto,
  UpdateWorkflowDto,
} from './dto/hsba.dto';

/* ------------------------------------------------------------------ Tiện ích */

const SEARCH_FIELDS = [
  'patientName',
  'maKcb',
  'maTheBhyt',
  'code',
  'requesterName',
  'departmentName',
  'patientCode',
] as const;

/** Biểu thức số cho cột số tiền (lưu dạng chuỗi) — dùng chung cho lọc và sắp xếp */
const AMOUNT_NUMERIC = sql`coalesce(nullif(regexp_replace(${hsbaRequests.amount}, '[^0-9.-]', '', 'g'), ''), '0')::numeric`;

/**
 * Trường lọc nâng cao của danh sách phiếu (khớp với sổ đăng ký trường lọc ở
 * `common/filters/filter-registry.ts` — thêm trường mới thì khai báo ở cả hai nơi).
 */
const HSBA_FILTERS: Record<string, FilterTarget> = {
  code: { expr: hsbaRequests.code, type: 'text' },
  patientName: { expr: hsbaRequests.patientName, type: 'text' },
  maKcb: { expr: hsbaRequests.maKcb, type: 'text' },
  maTheBhyt: { expr: hsbaRequests.maTheBhyt, type: 'text' },
  patientGender: { expr: hsbaRequests.patientGender, type: 'text' },
  patientBirthYear: { expr: sql`nullif(${hsbaRequests.patientBirthYear}, '')::int`, type: 'number' },
  status: { expr: hsbaRequests.status, type: 'enum' },
  priority: { expr: hsbaRequests.priority, type: 'enum' },
  departmentId: { expr: hsbaRequests.departmentId, type: 'number' },
  workflowId: { expr: hsbaRequests.workflowId, type: 'number' },
  pendingStepKey: { expr: hsbaRequests.pendingStepKey, type: 'text' },
  returnCount: { expr: hsbaRequests.returnCount, type: 'number' },
  amount: { expr: AMOUNT_NUMERIC, type: 'number' },
  doiTuong: { expr: hsbaRequests.doiTuong, type: 'text' },
  createdBy: { expr: hsbaRequests.createdBy, type: 'number' },
  requesterId: { expr: hsbaRequests.requesterId, type: 'number' },
};

function makeCode(prefix: string, id: number): string {
  return `${prefix}-${String(id).padStart(4, '0')}`;
}

/** Bỏ dấu tiếng Việt để so khớp tìm kiếm */
export function normalizeVN(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

/** Ghép các trường cần tra cứu thành một chuỗi không dấu, viết thường. */
export function buildSearchText(row: {
  code?: string | null;
  patientName?: string | null;
  patientCode?: string | null;
  requesterName?: string | null;
  departmentName?: string | null;
  maKcb?: string | null;
  maTheBhyt?: string | null;
  content?: string | null;
  reason?: string | null;
}): string {
  return normalizeVN(
    [
      row.code,
      row.patientName,
      row.patientCode,
      row.requesterName,
      row.departmentName,
      row.maKcb,
      row.maTheBhyt,
      row.content,
      row.reason,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

/** SLA hiển thị (giờ): quá mức này phiếu được gắn cờ QUÁ HẠN theo mức ưu tiên. */
const OVERDUE_HOURS_BY_PRIORITY: Record<string, number> = {
  URGENT: 8,
  HIGH: 24,
  NORMAL: 48,
  LOW: 96,
};

/** Kiểu tệp đính kèm được chấp nhận — minh chứng HSBA thực tế chỉ cần nhóm này. */
const ATTACHMENT_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

/** Giới hạn một tệp (đã giải mã). Tổng kích thước thân request do cấu hình JSON kiểm soát. */
const ATTACHMENT_MAX_BYTES = 12 * 1024 * 1024;

@Injectable()
export class HsbaService {
  private readonly logger = new Logger(HsbaService.name);

  constructor(
    private readonly db: DbService,
    private readonly cache: CacheService,
    private readonly printing: PrintingService,
    private readonly queue: QueueService,
    private readonly realtime: RealtimeService,
  ) {}

  /* ==================================================================== KÝ */

  /**
   * Trạng thái tương ứng với bước đang chờ.
   * Bước đầu tiên → CHO_<KEY>, các bước sau giữ nguyên quy ước cũ (CHO_KHTB, CHO_TC)
   * bằng cách dùng chính khoá bước.
   */
  private statusForStep(step: WorkflowStep | undefined, index: number): string {
    if (!step) return 'HOAN_TAT';
    if (index === 0) return `CHO_${step.key}`;
    return `CHO_${step.key}`;
  }

  /** Người dùng hiện tại có được ký ở bước này không? */
  private canSign(step: WorkflowStep, request: Record<string, unknown>, user: AccessContext): boolean {
    if (user.isSuperAdmin) return true;
    switch (step.kind) {
      case 'requester':
        return request['requesterId'] === user.id || request['createdBy'] === user.id;
      case 'creator':
        return request['createdBy'] === user.id;
      case 'dept_head': {
        const deptId = request['departmentId'];
        return (
          user.departmentId === deptId &&
          (user.roles.includes('TRUONG_KHOA') || user.permissions.includes('hsba.request.sign-khtb'))
        );
      }
      case 'role':
      default: {
        const codes = step.roleCodes ?? [];
        if (codes.some((c) => user.roles.includes(c))) return true;
        // Cho phép nếu có quyền tương ứng với bước (linh hoạt khi không dùng vai trò)
        return user.permissions.includes(signPermissionOf(step.key));
      }
    }
  }

  /** Tìm bước đang chờ của phiếu kèm thông tin quy trình */
  private async resolveWorkflow(
    request: { workflowId: number | null; departmentId: number | null },
  ): Promise<{ workflow: typeof hsbaWorkflows.$inferSelect | null; steps: WorkflowStep[] }> {
    let workflow: typeof hsbaWorkflows.$inferSelect | undefined;
    if (request.workflowId) {
      [workflow] = await this.db.db
        .select()
        .from(hsbaWorkflows)
        .where(eq(hsbaWorkflows.id, request.workflowId));
    }
    if (!workflow) {
      // Quy trình riêng của khoa → quy trình mặc định → quy trình bất kỳ
      const candidates = await this.db.db
        .select()
        .from(hsbaWorkflows)
        .where(eq(hsbaWorkflows.active, true))
        .orderBy(desc(hsbaWorkflows.isDefault), asc(hsbaWorkflows.id));
      workflow =
        candidates.find((w) => request.departmentId && w.departmentId === request.departmentId) ??
        candidates.find((w) => w.isDefault) ??
        candidates[0];
    }
    const steps = (workflow?.steps ?? []).slice().sort(() => 0);
    return { workflow: workflow ?? null, steps };
  }

  /** Mã băm xác thực nội dung đã ký — đổi nội dung là phát hiện được ngay */
  private contentHash(req: Record<string, unknown>, stepKey: string): string {
    const payload = JSON.stringify({
      code: req['code'],
      patientName: req['patientName'],
      maKcb: req['maKcb'],
      maTheBhyt: req['maTheBhyt'],
      reason: req['reason'],
      content: req['content'],
      amount: req['amount'],
      stepKey,
    });
    return createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 32);
  }

  private async writeLog(
    requestId: number,
    user: AccessContext | null,
    action: string,
    detail: string,
    fromStatus: string,
    toStatus: string,
    client?: ClientMeta,
  ): Promise<void> {
    await this.db.db.insert(hsbaLogs).values({
      requestId,
      userId: user?.id ?? null,
      username: user?.username ?? 'system',
      fullName: user?.fullName ?? 'Hệ thống',
      action,
      detail,
      fromStatus,
      toStatus,
      ip: client?.ip ?? '',
    });
  }

  private async invalidateStats(): Promise<void> {
    await this.cache.delByPrefix('hsba:');
    // GĐ3: đẩy sự kiện realtime — trang danh sách/dashboard tự tải lại (số liệu
    // chi tiết vẫn qua API đã áp phạm vi, sự kiện chỉ mang tính "đánh thức")
    this.realtime.publish({ topic: 'hsba', type: 'changed', permission: 'hsba.request.view' });
  }

  /* ============================================================== QUY TRÌNH */

  async listWorkflows(query: AdvancedQueryDto): Promise<Paginated<Record<string, unknown>>> {
    const where: SQL[] = [];
    if (query.q?.trim()) {
      const like = `%${query.q.trim()}%`;
      where.push(
        or(
          ilike(hsbaWorkflows.name, like),
          ilike(hsbaWorkflows.code, like),
          ilike(hsbaWorkflows.description, like),
        ) as SQL,
      );
    }
    if (query.activeOnly) where.push(eq(hsbaWorkflows.active, true));
    const condition = where.length ? and(...where) : undefined;

    const [countRow] = await this.db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(hsbaWorkflows)
      .where(condition);

    const rows = await this.db.db
      .select()
      .from(hsbaWorkflows)
      .where(condition)
      .orderBy(desc(hsbaWorkflows.isDefault), asc(hsbaWorkflows.name))
      .limit(query.limit)
      .offset(query.offset);

    return buildPage(rows, countRow?.total ?? 0, query.page, query.limit);
  }

  async findWorkflow(id: number) {
    const [row] = await this.db.db.select().from(hsbaWorkflows).where(eq(hsbaWorkflows.id, id));
    if (!row) throw new NotFoundException('Không tìm thấy quy trình ký');
    return row;
  }

  async createWorkflow(dto: CreateWorkflowDto) {
    if (!dto.steps?.length) {
      throw new BadRequestException('Quy trình phải có ít nhất một bước ký');
    }
    const keys = dto.steps.map((s) => s.key.toUpperCase());
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException('Khoá bước ký không được trùng nhau');
    }
    const [dup] = await this.db.db
      .select({ id: hsbaWorkflows.id })
      .from(hsbaWorkflows)
      .where(eq(hsbaWorkflows.code, dto.code));
    if (dup) throw new ConflictException(`Mã quy trình "${dto.code}" đã tồn tại`);

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(hsbaWorkflows)
        .values({
          code: dto.code,
          name: dto.name,
          description: dto.description ?? '',
          steps: dto.steps.map((s) => ({ ...s, key: s.key.toUpperCase() })),
          isDefault: dto.isDefault ?? false,
          departmentId: dto.departmentId ?? null,
          active: dto.active ?? true,
        })
        .returning();
      if (row.isDefault) {
        await tx
          .update(hsbaWorkflows)
          .set({ isDefault: false })
          .where(sql`${hsbaWorkflows.id} <> ${row.id}`);
      }
      await this.invalidateStats();
      return row;
    });
  }

  async updateWorkflow(id: number, dto: UpdateWorkflowDto) {
    await this.findWorkflow(id);
    if (dto.steps) {
      const keys = dto.steps.map((s) => s.key.toUpperCase());
      if (new Set(keys).size !== keys.length) {
        throw new BadRequestException('Khoá bước ký không được trùng nhau');
      }
    }
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(hsbaWorkflows)
        .set({
          code: dto.code,
          name: dto.name,
          description: dto.description,
          steps: dto.steps ? dto.steps.map((s) => ({ ...s, key: s.key.toUpperCase() })) : undefined,
          isDefault: dto.isDefault,
          departmentId: dto.departmentId === undefined ? undefined : dto.departmentId,
          active: dto.active,
          updatedAt: new Date(),
        })
        .where(eq(hsbaWorkflows.id, id))
        .returning();

      if (row.isDefault) {
        await tx
          .update(hsbaWorkflows)
          .set({ isDefault: false })
          .where(sql`${hsbaWorkflows.id} <> ${id}`);
      }
      await this.invalidateStats();
      return row;
    });
  }

  async removeWorkflow(id: number) {
    const wf = await this.findWorkflow(id);
    const [used] = await this.db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(hsbaRequests)
      .where(and(eq(hsbaRequests.workflowId, id), isNull(hsbaRequests.deletedAt)));
    if ((used?.total ?? 0) > 0) {
      throw new BadRequestException(
        `Quy trình đang được ${used.total} phiếu sử dụng — hãy chuyển sang quy trình khác trước khi xoá`,
      );
    }
    void wf;
    await this.db.db.delete(hsbaWorkflows).where(eq(hsbaWorkflows.id, id));
    await this.invalidateStats();
    return { deleted: true };
  }

  /* ================================================================ PHIẾU */

  /**
   * Điều kiện cho một bước ký: người dùng hiện tại có được ký bước này không.
   * Trả về null nghĩa là không bao giờ được ký.
   */
  private signCondition(step: WorkflowStep, user: AccessContext): SQL | null {
    if (user.isSuperAdmin) return sql`true`;
    switch (step.kind) {
      case 'requester':
        return or(eq(hsbaRequests.requesterId, user.id), eq(hsbaRequests.createdBy, user.id)) as SQL;
      case 'creator':
        return eq(hsbaRequests.createdBy, user.id);
      case 'dept_head': {
        const isHead =
          user.roles.includes('TRUONG_KHOA') || user.permissions.includes('hsba.request.sign-khtb');
        if (!isHead) return null;
        const deptIds = user.departmentIds.length
          ? user.departmentIds
          : user.departmentId
            ? [user.departmentId]
            : [];
        return deptIds.length ? (inArray(hsbaRequests.departmentId, deptIds) as SQL) : null;
      }
      case 'role':
      default: {
        const codes = step.roleCodes ?? [];
        if (codes.some((c) => user.roles.includes(c))) return sql`true`;
        if (user.permissions.includes(`hsba.request.sign-${step.key.toLowerCase()}`)) return sql`true`;
        return null;
      }
    }
  }

  /**
   * Điều kiện SQL cho các phiếu đang chờ chính người dùng xử lý.
   * Duyệt mọi quy trình đang bật vì mỗi khoa có thể dùng quy trình riêng.
   */
  async myTurnCondition(user: AccessContext): Promise<SQL | null> {
    const cached = await this.cache.get<Record<string, string[]>>('hsba:workflow-steps');
    let workflows: { steps: WorkflowStep[] }[];
    if (cached) {
      workflows = Object.values(cached).map((steps) => ({ steps: steps as unknown as WorkflowStep[] }));
    } else {
      const rows = await this.db.db
        .select({ id: hsbaWorkflows.id, steps: hsbaWorkflows.steps })
        .from(hsbaWorkflows)
        .where(eq(hsbaWorkflows.active, true));
      workflows = rows.map((r) => ({ steps: (r.steps ?? []) as WorkflowStep[] }));
      await this.cache.set(
        'hsba:workflow-steps',
        Object.fromEntries(rows.map((r) => [String(r.id), r.steps ?? []])),
        120,
      );
    }

    const conditions: SQL[] = [];
    for (const workflow of workflows) {
      for (const step of workflow.steps) {
        const who = this.signCondition(step, user);
        if (!who) continue;
        // Phiếu mới ở trạng thái CHO_<bước>; phiếu bị trả lại mang trạng thái TRA_LAI
        const pending = sql`(${hsbaRequests.status} = ${`CHO_${step.key}`} or ${hsbaRequests.status} = 'TRA_LAI') and ${hsbaRequests.pendingStepKey} = ${step.key}`;
        conditions.push(sql`(${pending}) and (${who})` as SQL);
      }
    }
    if (conditions.length === 0) return null;
    return or(...conditions) as SQL;
  }

  buildSearchCondition(query: RequestQueryDto, user: AccessContext, extra: SQL[] = []): SQL[] {
    const where: SQL[] = [...extra];
    if (!query.includeDeleted) where.push(isNull(hsbaRequests.deletedAt));

    if (query.q?.trim()) {
      const kw = query.q.trim();
      const like = `%${kw}%`;
      // Chuỗi tìm kiếm đã bỏ dấu → gõ có dấu hay không dấu đều khớp
      const loose = `%${normalizeVN(kw)}%`;
      where.push(
        or(
          sql`${hsbaRequests.searchText} like ${loose}`,
          ilike(hsbaRequests.maKcb, like),
          ilike(hsbaRequests.maTheBhyt, like),
          ilike(hsbaRequests.code, like),
          ilike(hsbaRequests.patientCode, like),
        ) as SQL,
      );
    }

    if (query.status) {
      const statuses = query.status.split('|').map((s) => s.trim()).filter(Boolean);
      where.push(statuses.length > 1 ? inArray(hsbaRequests.status, statuses) : eq(hsbaRequests.status, statuses[0] ?? query.status));
    }
    if (query.departmentId) where.push(eq(hsbaRequests.departmentId, query.departmentId));
    if (query.mine) {
      where.push(or(eq(hsbaRequests.createdBy, user.id), eq(hsbaRequests.requesterId, user.id)) as SQL);
    }

    // Phạm vi dữ liệu theo vai trò
    if (!user.isSuperAdmin && user.dataScope !== 'ALL') {
      if (user.dataScope === 'DEPT' && user.departmentIds.length > 0) {
        where.push(
          or(
            inArray(hsbaRequests.departmentId, user.departmentIds),
            eq(hsbaRequests.createdBy, user.id),
            eq(hsbaRequests.requesterId, user.id),
          ) as SQL,
        );
      } else if (user.dataScope === 'OWN') {
        where.push(
          or(eq(hsbaRequests.createdBy, user.id), eq(hsbaRequests.requesterId, user.id)) as SQL,
        );
      }
    } else if (!user.permissions.includes('hsba.request.view-all') && !user.isSuperAdmin) {
      where.push(
        or(eq(hsbaRequests.createdBy, user.id), eq(hsbaRequests.requesterId, user.id)) as SQL,
      );
    }

    // Khoảng ngày
    if (query.dateFrom || query.dateTo) {
      const field = query.dateField ?? 'createdAt';
      const column =
        field === 'updatedAt'
          ? hsbaRequests.updatedAt
          : field === 'ngayVaoVien'
            ? hsbaRequests.ngayVaoVien
            : hsbaRequests.createdAt;
      if (query.dateFrom) where.push(sql`${column} >= ${query.dateFrom}::timestamptz`);
      if (query.dateTo) where.push(sql`${column} < (${query.dateTo}::date + interval '1 day')`);
    }

    // Bộ lọc nâng cao field:op:value — khai báo trường ở HSBA_FILTERS, toán tử do pushFilters lo
    pushFilters(where, parseFilters(query.filters), HSBA_FILTERS);

    return where;
  }

  async list(query: RequestQueryDto, user: AccessContext): Promise<Paginated<Record<string, unknown>>> {
    const extra: SQL[] = [];
    if (query.myTurn) {
      const condition = await this.myTurnCondition(user);
      // Không có bước nào thuộc về người dùng → danh sách rỗng
      if (!condition) return buildPage<Record<string, unknown>>([], 0, query.page, query.pageSize);
      extra.push(condition);
    }

    const where = this.buildSearchCondition(query, user, extra);
    const condition = where.length ? and(...where) : undefined;

    const [countRow] = await this.db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(hsbaRequests)
      .where(condition);

    /** Biểu thức số tiền (cột lưu dạng chuỗi nên phải đổi sang số khi sắp xếp) */
    const amountExpr = sql`coalesce(nullif(regexp_replace(${hsbaRequests.amount}, '[^0-9.-]', '', 'g'), ''), '0')::numeric`;

    const sortColumn = (() => {
      switch (query.sortBy) {
        case 'patientName':
          return hsbaRequests.patientName;
        case 'code':
          return hsbaRequests.code;
        case 'status':
          return hsbaRequests.status;
        case 'updatedAt':
          return hsbaRequests.updatedAt;
        case 'ngayVaoVien':
          return hsbaRequests.ngayVaoVien;
        case 'amount':
          return amountExpr;
        case 'returnCount':
          return hsbaRequests.returnCount;
        default:
          return hsbaRequests.createdAt;
      }
    })();

    const rows = await this.db.db
      .select({
        id: hsbaRequests.id,
        code: hsbaRequests.code,
        status: hsbaRequests.status,
        pendingStepKey: hsbaRequests.pendingStepKey,
        currentStep: hsbaRequests.currentStep,
        workflowId: hsbaRequests.workflowId,
        patientName: hsbaRequests.patientName,
        patientBirthYear: hsbaRequests.patientBirthYear,
        patientGender: hsbaRequests.patientGender,
        patientCode: hsbaRequests.patientCode,
        maKcb: hsbaRequests.maKcb,
        maTheBhyt: hsbaRequests.maTheBhyt,
        doiTuong: hsbaRequests.doiTuong,
        ngayVaoVien: hsbaRequests.ngayVaoVien,
        ngayRaVien: hsbaRequests.ngayRaVien,
        requesterId: hsbaRequests.requesterId,
        requesterName: hsbaRequests.requesterName,
        requesterTitle: hsbaRequests.requesterTitle,
        departmentId: hsbaRequests.departmentId,
        departmentName: hsbaRequests.departmentName,
        reason: hsbaRequests.reason,
        content: hsbaRequests.content,
        amount: hsbaRequests.amount,
        priority: hsbaRequests.priority,
        returnCount: hsbaRequests.returnCount,
        returnReason: hsbaRequests.returnReason,
        createdBy: hsbaRequests.createdBy,
        completedAt: hsbaRequests.completedAt,
        createdAt: hsbaRequests.createdAt,
        updatedAt: hsbaRequests.updatedAt,
      })
      .from(hsbaRequests)
      .where(condition)
      .orderBy(query.sortDir === 'asc' ? asc(sortColumn) : desc(sortColumn))
      .limit(query.limit)
      .offset(query.offset);

    // Kèm thông tin chữ ký đã có
    const ids = rows.map((r) => r.id);
    const signatures = ids.length
      ? await this.db.db
          .select({
            requestId: hsbaSignatures.requestId,
            stepKey: hsbaSignatures.stepKey,
            fullName: hsbaSignatures.fullName,
            title: hsbaSignatures.title,
            signedAt: hsbaSignatures.signedAt,
          })
          .from(hsbaSignatures)
          .where(inArray(hsbaSignatures.requestId, ids))
      : [];
    const byRequest = new Map<number, typeof signatures>();
    for (const s of signatures) {
      const list = byRequest.get(s.requestId) ?? [];
      list.push(s);
      byRequest.set(s.requestId, list);
    }

    // Nạp đúng mỗi quy trình đang dùng trong trang để tính canSign cho từng dòng
    // (điều này cho phép danh sách hiển thị ô KÝ NHANH và bulk-sign đúng với từng quy trình riêng).
    const wfIds = [...new Set(rows.map((r) => r.workflowId).filter((x): x is number => typeof x === 'number'))];
    const wfRows = wfIds.length
      ? await this.db.db.select().from(hsbaWorkflows).where(inArray(hsbaWorkflows.id, wfIds))
      : [];
    const stepsByWf = new Map(wfRows.map((w) => [w.id, (w.steps ?? []) as WorkflowStep[]]));

    const now = Date.now();
    const items = rows.map((r) => {
      const steps = r.workflowId ? stepsByWf.get(r.workflowId) : undefined;
      const pending = steps?.[r.currentStep];
      // Cột "Đang chờ" ở list ưu tiên tên bước của chính quy trình phiếu đang dùng —
      // mới nhìn là biết phiếu đang ở tay ai, không phải mã kỹ thuật DE_NGHI/KHTB/TC.
      const waitingName = pending?.name ?? (r as { pendingStepName?: string | null }).pendingStepName ?? null;
      const waitingHours = Math.max(0, Math.floor((now - new Date(r.updatedAt).getTime()) / 3_600_000));
      return {
        ...r,
        statusLabel: REQUEST_STATUS_LABELS[r.status as keyof typeof REQUEST_STATUS_LABELS] ?? r.status,
        signatures: byRequest.get(r.id) ?? [],
        pendingStepName: waitingName,
        canSign: !!pending && this.canSign(pending, r, user),
        waitingHours,
        overdue: ['HOAN_TAT', 'DA_HUY'].includes(r.status) ? false : waitingHours > (OVERDUE_HOURS_BY_PRIORITY[r.priority] ?? OVERDUE_HOURS_BY_PRIORITY.NORMAL),
      };
    });

    return buildPage(items, countRow?.total ?? 0, query.page, query.limit);
  }

  /** Phiếu đang chờ chính người dùng hiện tại xử lý */
  /** Phiếu đang chờ chính tôi xử lý — dùng chung điều kiện với bộ lọc myTurn của danh sách. */
  async myTurn(user: AccessContext, query: RequestQueryDto): Promise<Paginated<Record<string, unknown>>> {
    // Giữ nguyên đối tượng DTO (không trải sang đối tượng mới) rồi bật cờ myTurn
    query.myTurn = true;
    return this.list(query, user);
  }

  /**
   * Các phiếu ĐANG MỞ (chưa hoàn tất, chưa huỷ) trùng mã KCB hoặc mã thẻ BHYT —
   * dùng cho cảnh báo trùng lúc tạo phiếu và ô tra cứu trùng trên giao diện.
   */
  async findOpenDuplicates(query: DuplicatesQueryDto) {
    const clauses: SQL[] = [isNull(hsbaRequests.deletedAt), sql`${hsbaRequests.status} NOT IN ('HOAN_TAT', 'DA_HUY')`];
    const key = (query.maKcb ?? '').trim();
    const the = (query.maTheBhyt ?? '').trim();
    if (!key && !the) return [];
    const keys: SQL[] = [];
    if (key) keys.push(sql`upper(${hsbaRequests.maKcb}) = ${key.toUpperCase()}`);
    if (the) keys.push(sql`upper(${hsbaRequests.maTheBhyt}) = ${the.toUpperCase()}`);
    clauses.push(or(...keys)!);
    if (query.excludeId) clauses.push(sql`${hsbaRequests.id} <> ${query.excludeId}`);

    return this.db.db
      .select({
        id: hsbaRequests.id,
        code: hsbaRequests.code,
        status: hsbaRequests.status,
        patientName: hsbaRequests.patientName,
        maKcb: hsbaRequests.maKcb,
        maTheBhyt: hsbaRequests.maTheBhyt,
        requesterName: hsbaRequests.requesterName,
        departmentName: hsbaRequests.departmentName,
        createdAt: hsbaRequests.createdAt,
      })
      .from(hsbaRequests)
      .where(and(...clauses))
      .orderBy(desc(hsbaRequests.createdAt))
      .limit(5);
  }

  /* =============================================================== BÌNH LUẬN */

  async listComments(id: number, user: AccessContext) {
    await this.findOne(id, user); // kiểm tra quyền xem phiếu
    const rows = await this.db.db
      .select()
      .from(hsbaComments)
      .where(and(eq(hsbaComments.requestId, id), isNull(hsbaComments.deletedAt)))
      .orderBy(asc(hsbaComments.createdAt));
    const canModerate = user.isSuperAdmin || user.permissions.includes('hsba.request.delete');
    return rows.map((c) => ({ ...c, canDelete: canModerate || c.userId === user.id }));
  }

  async addComment(id: number, dto: CreateCommentDto, user: AccessContext, client?: ClientMeta) {
    const request = await this.findOne(id, user);
    const content = dto.content.trim();
    if (!content) throw new BadRequestException('Nội dung trao đổi không được để trống');

    const [row] = await this.db.db
      .insert(hsbaComments)
      .values({
        requestId: id,
        userId: user.id,
        username: user.username,
        fullName: user.fullName,
        content,
      })
      .returning();

    await this.writeLog(id, user, 'COMMENT', 'Thêm trao đổi', request.status, request.status, client);

    // Báo cho các bên liên quan: người tạo, người đề nghị, người ký gần nhất — trừ chính người viết
    const notifyIds = new Set<number>();
    if (request.createdBy !== user.id) notifyIds.add(request.createdBy);
    if (request.requesterId && request.requesterId !== user.id) notifyIds.add(request.requesterId);
    try {
      void this.queue.enqueue('hsba.notifyComment', {
        requestId: id,
        code: request.code,
        commenter: user.fullName,
        userIds: [...notifyIds],
      });
    } catch {
      /* hàng đợi không khả dụng không chặn bài bình luận */
    }
    return { ...row, canDelete: true };
  }

  async removeComment(id: number, commentId: number, user: AccessContext) {
    const [comment] = await this.db.db
      .select()
      .from(hsbaComments)
      .where(and(eq(hsbaComments.id, commentId), eq(hsbaComments.requestId, id), isNull(hsbaComments.deletedAt)))
      .limit(1);
    if (!comment) throw new NotFoundException('Không tìm thấy trao đổi');
    const canModerate = user.isSuperAdmin || user.permissions.includes('hsba.request.delete');
    if (comment.userId !== user.id && !canModerate) {
      throw new ForbiddenException('Chỉ tác giả hoặc người quản trị phiếu mới xoá được trao đổi');
    }
    await this.db.db
      .update(hsbaComments)
      .set({ deletedAt: new Date() })
      .where(eq(hsbaComments.id, commentId));
    return { ok: true };
  }

  /* ========================================================= TỆP ĐÍNH KÈM */

  async listAttachments(id: number, user: AccessContext) {
    await this.findOne(id, user);
    const rows = await this.db.db
      .select()
      .from(hsbaAttachments)
      .where(and(eq(hsbaAttachments.requestId, id), isNull(hsbaAttachments.deletedAt)))
      .orderBy(asc(hsbaAttachments.createdAt));
    const canModerate = user.isSuperAdmin || user.permissions.includes('hsba.request.delete');
    return rows.map((a) => ({ ...a, storagePath: undefined, canDelete: canModerate || a.uploadedBy === user.id }));
  }

  async uploadAttachment(id: number, dto: CreateAttachmentDto, user: AccessContext, client?: ClientMeta) {
    const request = await this.findOne(id, user);
    if (['HOAN_TAT', 'DA_HUY'].includes(request.status)) {
      throw new BadRequestException('Phiếu đã kết thúc — không đính kèm thêm được');
    }
    const mime = (dto.mimeType ?? '').toLowerCase().trim();
    if (!mime || !ATTACHMENT_MIME[mime]) {
      throw new BadRequestException(`Kiểu tệp "${mime || 'không rõ'}" không được phép (chỉ ảnh, PDF, Word, Excel)`);
    }
    const fileName = path.basename(dto.fileName.trim() || `tep${ATTACHMENT_MIME[mime]}`);
    let buffer: Buffer;
    try {
      buffer = Buffer.from(dto.contentBase64, 'base64');
    } catch {
      throw new BadRequestException('Nội dung tệp không hợp lệ');
    }
    if (buffer.length === 0) throw new BadRequestException('Tệp rỗng');
    if (buffer.length > ATTACHMENT_MAX_BYTES) {
      throw new BadRequestException(`Tệp vượt ${ATTACHMENT_MAX_BYTES / (1024 * 1024)}MB`);
    }
    // Kiểm chữ ký đầu tệp với ảnh/PDF — chống đổi đuôi tệp mã độc
    const head = buffer.subarray(0, 4).toString('hex');
    const magicOk =
      (mime.startsWith('image/png') && head === '89504e47') ||
      (mime === 'image/jpeg' && head.startsWith('ffd8')) ||
      (mime === 'application/pdf' && buffer.subarray(0, 4).toString() === '%PDF') ||
      !['image/png', 'image/jpeg', 'application/pdf'].includes(mime);
    if (!magicOk) throw new BadRequestException('Nội dung tệp không khớp với kiểu tệp khai báo');

    const relPath = path.join('hsba', String(id), `${randomUUID()}${ATTACHMENT_MIME[mime]}`);
    const absPath = path.join(config.storage.dir, relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    // Chỉ công bố tệp HSBA sau khi ghi xong: backup chạy đồng thời sẽ thấy tệp cũ
    // hoặc tệp hoàn chỉnh, không bao giờ archive một PDF/Word đang ghi dở.
    const temporaryPath = `${absPath}.qlbs-write-${randomUUID()}.partial`;
    try {
      await fs.writeFile(temporaryPath, buffer, { mode: 0o600 });
      await fs.rename(temporaryPath, absPath);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }

    const [row] = await this.db.db
      .insert(hsbaAttachments)
      .values({
        requestId: id,
        fileName,
        mimeType: mime,
        sizeBytes: buffer.length,
        storagePath: relPath,
        note: dto.note?.trim() ?? '',
        uploadedBy: user.id,
        username: user.username,
        fullName: user.fullName,
      })
      .returning();

    await this.writeLog(id, user, 'ATTACHMENT', `Đính kèm tệp "${fileName}"`, request.status, request.status, client);
    return { ...row, storagePath: undefined, canDelete: true };
  }

  /** Trả về lối vật lý + metadata để controller stream về trình duyệt. */
  async readAttachment(id: number, attachmentId: number, user: AccessContext) {
    await this.findOne(id, user);
    const [row] = await this.db.db
      .select()
      .from(hsbaAttachments)
      .where(and(eq(hsbaAttachments.id, attachmentId), eq(hsbaAttachments.requestId, id), isNull(hsbaAttachments.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Không tìm thấy tệp đính kèm');
    const absPath = path.join(config.storage.dir, row.storagePath);
    // chặn chắc chắn mọi khả năng lọt ra ngoài thư mục gốc lưu trữ
    if (!path.resolve(absPath).startsWith(path.resolve(config.storage.dir))) {
      throw new ForbiddenException('Đường dẫn tệp không hợp lệ');
    }
    return { row: { ...row, storagePath: undefined }, absPath };
  }

  async removeAttachment(id: number, attachmentId: number, user: AccessContext, client?: ClientMeta) {
    const { row, absPath } = await this.readAttachment(id, attachmentId, user);
    const canModerate = user.isSuperAdmin || user.permissions.includes('hsba.request.delete');
    if (row.uploadedBy !== user.id && !canModerate) {
      throw new ForbiddenException('Chỉ người đăng tệp hoặc người quản trị phiếu mới xoá được');
    }
    await this.db.db
      .update(hsbaAttachments)
      .set({ deletedAt: new Date() })
      .where(eq(hsbaAttachments.id, attachmentId));
    await fs.unlink(absPath).catch(() => undefined);
    const request = await this.findOne(id, user);
    await this.writeLog(id, user, 'ATTACHMENT_DELETE', `Xoá tệp "${row.fileName}"`, request.status, request.status, client);
    return { ok: true };
  }

  async findOne(id: number, user?: AccessContext) {
    const [row] = await this.db.db.select().from(hsbaRequests).where(eq(hsbaRequests.id, id));
    if (!row) throw new NotFoundException('Không tìm thấy phiếu đề nghị');
    if (user && !this.canView(row, user)) {
      throw new ForbiddenException('Bạn không có quyền xem phiếu này');
    }

    const [signatures, logs] = await Promise.all([
      this.db.db
        .select()
        .from(hsbaSignatures)
        .where(eq(hsbaSignatures.requestId, id))
        .orderBy(asc(hsbaSignatures.signedAt)),
      this.db.db
        .select()
        .from(hsbaLogs)
        .where(eq(hsbaLogs.requestId, id))
        .orderBy(asc(hsbaLogs.createdAt)),
    ]);

    const { workflow, steps } = await this.resolveWorkflow(row);
    const current = steps[row.currentStep];
    const signatureByStep = new Map(signatures.map((s) => [s.stepKey, s]));

    // Kiểm tra tính toàn vẹn: nội dung hiện tại có khớp với mã băm lúc ký?
    const integrity = signatures.map((s) => ({
      stepKey: s.stepKey,
      valid: s.contentHash === '' || s.contentHash === this.contentHash(row, s.stepKey),
    }));

    return {
      ...row,
      statusLabel: REQUEST_STATUS_LABELS[row.status as keyof typeof REQUEST_STATUS_LABELS] ?? row.status,
      workflow,
      signatures,
      logs,
      integrity,
      timeline: steps.map((step, index) => {
        const sig = signatureByStep.get(step.key);
        return {
          index,
          key: step.key,
          name: step.name,
          title: step.title,
          kind: step.kind,
          roleCodes: step.roleCodes ?? [],
          allowReturn: step.allowReturn ?? false,
          requireNote: step.requireNote ?? false,
          state: sig ? 'SIGNED' : index === row.currentStep && row.status !== 'HOAN_TAT' ? 'PENDING' : index < row.currentStep ? 'SKIPPED' : 'WAITING',
          canSignCurrent: !!current && user ? this.canSign(current, row, user) : false,
          signature: sig ?? null,
        };
      }),
    };
  }

  private canView(request: { requesterId: number | null; createdBy: number; departmentId: number | null }, user: AccessContext): boolean {
    if (user.isSuperAdmin || user.permissions.includes('hsba.request.view-all')) return true;
    if (request.createdBy === user.id || request.requesterId === user.id) return true;
    if (user.dataScope === 'DEPT' && request.departmentId && user.departmentIds.includes(request.departmentId)) {
      return true;
    }
    return user.departmentId !== null && request.departmentId === user.departmentId;
  }

  async create(dto: CreateRequestDto, user: AccessContext, client?: ClientMeta) {
    // Chặn tạo trùng phiếu cho cùng một hồ sơ khi hồ sơ đó còn phiếu ĐANG MỞ —
    // giao diện phải hiển thị danh sách phiếu đó cho người nhập xác nhận rồi gọi lại với force=true.
    if (!dto.force) {
      const dups = await this.findOpenDuplicates({
        maKcb: dto.maKcb,
        maTheBhyt: dto.maTheBhyt,
      });
      if (dups.length > 0) {
        throw new ConflictException({
          code: 'DUPLICATE_OPEN',
          message: `Đã có ${dups.length} phiếu đang mở cho hồ sơ này — kiểm tra trước khi tạo tiếp`,
          duplicates: dups,
        });
      }
   }

    const [requester] = await this.db.db
      .select({
        id: users.id,
        username: users.username,
        fullName: users.fullName,
        title: users.title,
        departmentId: users.departmentId,
      })
      .from(users)
      .where(eq(users.id, dto.requesterId));
    if (!requester) throw new NotFoundException('Không tìm thấy tài khoản người đề nghị');

    let departmentName = dto.departmentName ?? '';
    const deptId = dto.departmentId ?? requester.departmentId ?? user.departmentId ?? null;
    if (deptId && !departmentName) {
      const [dept] = await this.db.db
        .select({ name: departments.name })
        .from(departments)
        .where(eq(departments.id, deptId));
      departmentName = dept?.name ?? '';
    }

    // Quy trình áp dụng: theo yêu cầu → riêng khoa → mặc định
    const { workflow, steps } = await this.resolveWorkflow({
      workflowId: dto.workflowId ?? null,
      departmentId: deptId,
    });

    if (steps.length === 0) {
      throw new BadRequestException('Chưa cấu hình quy trình ký — hãy tạo quy trình trước');
    }

    const firstStep = steps[0];
    const initialStatus = this.statusForStep(firstStep, 0);

    const created = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(hsbaRequests)
        .values({
          code: 'TMP',
          status: initialStatus,
          workflowId: workflow?.id ?? null,
          currentStep: 0,
          pendingStepKey: firstStep.key,
          createdBy: user.id,
          requesterId: requester.id,
          requesterName: dto.requesterName ?? requester.fullName,
          requesterTitle: dto.requesterTitle ?? requester.title,
          departmentId: deptId,
          departmentName,
          patientName: dto.patientName,
          patientBirthYear: dto.patientBirthYear ?? '',
          patientBirthDate: dto.patientBirthDate ?? null,
          patientGender: dto.patientGender ?? '',
          patientCode: dto.patientCode ?? '',
          patientAddress: dto.patientAddress ?? '',
          maKcb: dto.maKcb ?? '',
          maTheBhyt: dto.maTheBhyt ?? '',
          ngayVaoVien: dto.ngayVaoVien ?? null,
          ngayRaVien: dto.ngayRaVien ?? null,
          doiTuong: dto.doiTuong ?? '',
          reason: dto.reason,
          content: dto.content,
          amount: dto.amount ?? '',
          attachmentsNote: dto.attachmentsNote ?? '',
          extraFields: dto.extraFields ?? {},
          priority: dto.priority ?? 'NORMAL',
        })
        .returning();

      const code = makeCode('SDS', row.id);
      const [updated] = await tx
        .update(hsbaRequests)
        .set({ code, searchText: buildSearchText({ ...row, code }) })
        .where(eq(hsbaRequests.id, row.id))
        .returning();

      await tx.insert(hsbaLogs).values({
        requestId: row.id,
        userId: user.id,
        username: user.username,
        fullName: user.fullName,
        action: 'CREATE',
        detail: `Tạo phiếu ${code}`,
        fromStatus: '',
        toStatus: initialStatus,
        ip: client?.ip ?? '',
      });

      return updated;
    });

    // Ký ngay ở bước đầu (khi tài khoản tạo chính là người đề nghị)
    if (dto.signNow && (firstStep.kind === 'requester' || firstStep.kind === 'creator')) {
      return this.sign(created.id, {}, user, client);
    }

    await this.invalidateStats();
    return this.findOne(created.id);
  }

  async update(id: number, dto: UpdateRequestDto, user: AccessContext) {
    const current = await this.findOne(id);
    // Chủ sở hữu phiếu: người tạo hoặc người đề nghị; còn lại phải có quyền điều hành toàn bộ phiếu
    if (
      !user.isSuperAdmin &&
      !user.permissions.includes('hsba.request.view-all') &&
      current.createdBy !== user.id &&
      current.requesterId !== user.id
    ) {
      throw new ForbiddenException('Chỉ người tạo hoặc người đề nghị mới được sửa phiếu này');
    }
    if (['HOAN_TAT', 'DA_HUY'].includes(current.status)) {
      throw new BadRequestException('Phiếu đã hoàn tất hoặc đã huỷ — không sửa được nội dung');
    }
    // Chỉ sửa được khi phiếu còn ở bước người đề nghị (phiếu mới hoặc vừa bị trả lại)
    if (!user.isSuperAdmin && current.currentStep > 0 && current.status !== 'TRA_LAI') {
      throw new BadRequestException('Phiếu đã được ký ở bước tiếp theo — đề nghị trả lại phiếu trước khi sửa');
    }
    if (dto.workflowId && dto.workflowId !== current.workflowId) {
      const [used] = await this.db.db
        .select({ total: sql<number>`count(*)::int` })
        .from(hsbaSignatures)
        .where(eq(hsbaSignatures.requestId, id));
      if ((used?.total ?? 0) > 0) {
        throw new BadRequestException('Phiếu đã có chữ ký — không thể đổi quy trình ký');
      }
    }

    const [row] = await this.db.db
      .update(hsbaRequests)
      .set({
        patientName: dto.patientName,
        patientBirthYear: dto.patientBirthYear,
        patientBirthDate: dto.patientBirthDate,
        patientGender: dto.patientGender,
        patientCode: dto.patientCode,
        patientAddress: dto.patientAddress,
        maKcb: dto.maKcb,
        maTheBhyt: dto.maTheBhyt,
        ngayVaoVien: dto.ngayVaoVien,
        ngayRaVien: dto.ngayRaVien,
        doiTuong: dto.doiTuong,
        reason: dto.reason,
        content: dto.content,
        amount: dto.amount,
        attachmentsNote: dto.attachmentsNote,
        extraFields: dto.extraFields,
        priority: dto.priority,
        internalNote: dto.internalNote,
        requesterId: dto.requesterId,
        requesterName: dto.requesterName,
        requesterTitle: dto.requesterTitle,
        departmentId: dto.departmentId === undefined ? undefined : dto.departmentId,
        departmentName: dto.departmentName,
        workflowId: dto.workflowId,
        updatedAt: new Date(),
        searchText: buildSearchText({
          code: current.code,
          patientName: dto.patientName ?? current.patientName,
          patientCode: dto.patientCode ?? current.patientCode,
          requesterName: dto.requesterName ?? current.requesterName,
          departmentName: dto.departmentName ?? current.departmentName,
          maKcb: dto.maKcb ?? current.maKcb,
          maTheBhyt: dto.maTheBhyt ?? current.maTheBhyt,
          content: dto.content ?? current.content,
          reason: dto.reason ?? current.reason,
        }),
      })
      .where(eq(hsbaRequests.id, id))
      .returning();

    await this.writeLog(id, user, 'UPDATE', 'Cập nhật nội dung phiếu', current.status, current.status);
    await this.invalidateStats();
    return this.findOne(row.id);
  }

  /** Trình ký: bước tiếp theo do người dùng hiện tại ký */
  async sign(id: number, body: { note?: string; stepKey?: string }, user: AccessContext, client?: ClientMeta) {
    const detail = await this.findOne(id);
    if (['HOAN_TAT', 'DA_HUY'].includes(detail.status)) {
      throw new BadRequestException('Phiếu đã kết thúc — không thể ký');
    }

    const { steps } = await this.resolveWorkflow(detail);
    const stepIndex = body.stepKey
      ? steps.findIndex((s) => s.key === body.stepKey)
      : detail.currentStep;
    const step = steps[stepIndex];
    if (!step) throw new BadRequestException('Bước ký không hợp lệ theo quy trình hiện hành');

    if (step.key !== detail.pendingStepKey) {
      throw new BadRequestException('Bước ký không khớp với bước đang chờ của phiếu');
    }
    if (!this.canSign(step, detail, user)) {
      throw new ForbiddenException(`Bạn không phải là người được ký ở bước "${step.name}"`);
    }
    if (step.requireNote && !body.note?.trim()) {
      throw new BadRequestException(`Bước "${step.name}" bắt buộc ghi ý kiến`);
    }

    const [existing] = await this.db.db
      .select({ id: hsbaSignatures.id })
      .from(hsbaSignatures)
      .where(and(eq(hsbaSignatures.requestId, id), eq(hsbaSignatures.stepKey, step.key)));
    if (existing) throw new ConflictException('Bước này đã được ký');

    const nextIndex = stepIndex + 1;
    const nextStep = steps[nextIndex];
    const nextStatus = nextStep ? this.statusForStep(nextStep, nextIndex) : 'HOAN_TAT';
    const hash = this.contentHash(detail, step.key);

    await this.db.transaction(async (tx) => {
      await tx.insert(hsbaSignatures).values({
        requestId: id,
        stepKey: step.key,
        stepName: step.name,
        userId: user.id,
        username: user.username,
        fullName: step.kind === 'requester' ? (detail.requesterName || user.fullName) : user.fullName,
        title: step.title,
        note: body.note ?? '',
        contentHash: hash,
        ip: client?.ip ?? '',
        userAgent: client?.userAgent ?? '',
      });

      await tx
        .update(hsbaRequests)
        .set({
          status: nextStatus,
          currentStep: nextStep ? nextIndex : steps.length,
          pendingStepKey: nextStep?.key ?? 'HOAN_TAT',
          completedAt: nextStep ? null : new Date(),
          updatedAt: new Date(),
        })
        .where(eq(hsbaRequests.id, id));

      await tx.insert(hsbaLogs).values({
        requestId: id,
        userId: user.id,
        username: user.username,
        fullName: user.fullName,
        action: 'SIGN',
        detail: `Ký bước ${step.name}${body.note ? ` — ý kiến: ${body.note}` : ''}`,
        fromStatus: detail.status,
        toStatus: nextStatus,
        ip: client?.ip ?? '',
      });
    });

    await this.invalidateStats();
    // Thông báo cho bước kế tiếp (xử lý nền, không chặn phản hồi)
    if (nextStep) {
      void this.queue.enqueue('hsba.notifyNextStep', {
        requestId: id,
        code: detail.code ?? '',
        stepKey: nextStep.key,
        stepName: nextStep.name,
      });
    } else {
      void this.queue.enqueue('hsba.notifyCompleted', { requestId: id, code: detail.code ?? '' });
    }

    return this.findOne(id);
  }

  /** Trả lại phiếu kèm lý do (đưa về bước người đề nghị) */
  async returnRequest(id: number, reason: string, user: AccessContext, client?: ClientMeta) {
    const detail = await this.findOne(id);
    if (['HOAN_TAT', 'DA_HUY'].includes(detail.status)) {
      throw new BadRequestException('Phiếu đã kết thúc — không thể trả lại');
    }
    // Phiếu đang chờ chính người đề nghị (mới tạo hoặc vừa bị trả lại) thì không có gì để trả lại:
    // chỉ cần sửa nội dung rồi ký lại để gửi đi.
    if (detail.status === 'TRA_LAI' || detail.currentStep === 0) {
      throw new BadRequestException(
        'Phiếu đang ở bước người đề nghị — sửa nội dung và ký lại để gửi đi, không cần trả lại',
      );
    }
    const { steps } = await this.resolveWorkflow(detail);
    const current = steps[detail.currentStep];
    if (!current) throw new BadRequestException('Không xác định được bước đang chờ');
    if (!(current.allowReturn ?? false) && !user.isSuperAdmin) {
      throw new ForbiddenException(`Bước "${current.name}" không cho phép trả lại`);
    }

    // Trả về bước người đề nghị (bước đầu tiên trong quy trình)
    const targetIndex = 0;
    const target = steps[targetIndex];
    const targetStatus = this.statusForStep(target, targetIndex);

    await this.db.transaction(async (tx) => {
      await tx
        .update(hsbaRequests)
        .set({
          // Đánh dấu rõ "đã trả lại" để thống kê và bộ lọc tách được khỏi phiếu mới,
          // nhưng vẫn chờ đúng bước đầu của quy trình để người đề nghị sửa và gửi lại.
          status: targetIndex === 0 ? 'TRA_LAI' : targetStatus,
          currentStep: targetIndex,
          pendingStepKey: target.key,
          returnReason: reason,
          returnedBy: user.id,
          returnedAt: new Date(),
          returnCount: sql`${hsbaRequests.returnCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(hsbaRequests.id, id));

      // Nội dung sẽ được sửa lại nên mọi chữ ký cũ đều hết giá trị:
      // người đề nghị phải ký lại nội dung mới, các bước sau duyệt lại từ đầu.
      const removed = await tx
        .delete(hsbaSignatures)
        .where(eq(hsbaSignatures.requestId, id))
        .returning({ stepKey: hsbaSignatures.stepKey });

      if (removed.length > 0) {
        await tx.insert(hsbaLogs).values({
          requestId: id,
          userId: user.id,
          username: user.username,
          fullName: user.fullName,
          action: 'UNSIGN',
          detail: `Huỷ ${removed.length} chữ ký cũ do phiếu bị trả lại (${removed
            .map((r) => r.stepKey)
            .join(', ')})`,
          fromStatus: detail.status,
          toStatus: targetStatus,
          ip: client?.ip ?? '',
        });
      }

      await tx.insert(hsbaLogs).values({
        requestId: id,
        userId: user.id,
        username: user.username,
        fullName: user.fullName,
        action: 'RETURN',
        detail: `Trả lại phiếu: ${reason}`,
        fromStatus: detail.status,
        toStatus: targetIndex === 0 ? 'TRA_LAI' : targetStatus,
        ip: client?.ip ?? '',
      });
    });

    await this.invalidateStats();
    void this.queue.enqueue('hsba.notifyReturned', {
      requestId: id,
      code: detail.code ?? '',
      reason,
    });
    return this.findOne(id);
  }

  /** Ký hàng loạt các phiếu đang chờ mình xử lý */
  async bulkSign(ids: number[], note: string | undefined, user: AccessContext, client?: ClientMeta) {
    const results: { id: number; ok: boolean; message?: string; status?: string }[] = [];
    for (const id of ids) {
      try {
        const res = await this.sign(id, { note }, user, client);
        results.push({ id, ok: true, status: res.status });
      } catch (err) {
        results.push({ id, ok: false, message: (err as Error).message });
      }
    }
    return {
      total: ids.length,
      success: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  async cancel(id: number, reason: string | undefined, user: AccessContext, client?: ClientMeta) {
    const detail = await this.findOne(id);
    if (detail.status === 'HOAN_TAT') {
      throw new BadRequestException('Phiếu đã hoàn tất — không thể huỷ');
    }
    await this.db.db
      .update(hsbaRequests)
      .set({ status: 'DA_HUY', updatedAt: new Date(), internalNote: reason ?? detail.internalNote })
      .where(eq(hsbaRequests.id, id));
    await this.writeLog(id, user, 'CANCEL', reason ? `Huỷ phiếu: ${reason}` : 'Huỷ phiếu', detail.status, 'DA_HUY', client);
    await this.invalidateStats();
    return this.findOne(id);
  }

  async remove(id: number, user: AccessContext) {
    const detail = await this.findOne(id);
    if (!['DA_HUY', 'HOAN_TAT'].includes(detail.status) && !user.isSuperAdmin) {
      throw new BadRequestException('Chỉ xoá được phiếu đã kết thúc hoặc đã huỷ');
    }
    await this.db.db
      .update(hsbaRequests)
      .set({ deletedAt: new Date() })
      .where(eq(hsbaRequests.id, id));
    await this.writeLog(id, user, 'DELETE', 'Xoá phiếu (xoá mềm)', detail.status, detail.status);
    await this.invalidateStats();
    return { deleted: true };
  }

  async restore(id: number) {
    await this.db.db
      .update(hsbaRequests)
      .set({ deletedAt: null })
      .where(eq(hsbaRequests.id, id));
    return this.findOne(id);
  }

  /* ------------------------------------------------------------ Thống kê */

  async stats(user: AccessContext, query: RequestQueryDto) {
    const extra: SQL[] = [];
    if (query.myTurn) {
      const condition = await this.myTurnCondition(user);
      // Không có bước nào thuộc về người dùng → danh sách rỗng
      if (!condition) return buildPage<Record<string, unknown>>([], 0, query.page, query.pageSize);
      extra.push(condition);
    }

    const where = this.buildSearchCondition(query, user, extra);
    const condition = where.length ? and(...where) : undefined;

    const rows = await this.db.db
      .select({
        status: hsbaRequests.status,
        total: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(nullif(regexp_replace(${hsbaRequests.amount}, '[^0-9.-]', '', 'g'), '')::numeric), 0)::text`,
      })
      .from(hsbaRequests)
      .where(condition)
      .groupBy(hsbaRequests.status);

    const byDept = await this.db.db
      .select({
        departmentId: hsbaRequests.departmentId,
        departmentName: hsbaRequests.departmentName,
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${hsbaRequests.status} = 'HOAN_TAT')::int`,
        pending: sql<number>`count(*) filter (where ${hsbaRequests.status} like 'CHO_%' or ${hsbaRequests.status} = 'TRA_LAI')::int`,
        returned: sql<number>`count(*) filter (where ${hsbaRequests.status} = 'TRA_LAI')::int`,
      })
      .from(hsbaRequests)
      .where(condition)
      .groupBy(hsbaRequests.departmentId, hsbaRequests.departmentName)
      .orderBy(desc(sql`count(*)`));

    const [totals] = await this.db.db
      .select({
        total: sql<number>`count(*)::int`,
        pending: sql<number>`count(*) filter (where ${hsbaRequests.status} like 'CHO_%' or ${hsbaRequests.status} = 'TRA_LAI')::int`,
        completed: sql<number>`count(*) filter (where ${hsbaRequests.status} = 'HOAN_TAT')::int`,
        returned: sql<number>`count(*) filter (where ${hsbaRequests.status} = 'TRA_LAI')::int`,
        avgDays: sql<string>`coalesce(round(avg(extract(epoch from (coalesce(${hsbaRequests.completedAt}, now()) - ${hsbaRequests.createdAt})) / 86400)::numeric, 1), 0)::text`,
      })
      .from(hsbaRequests)
      .where(condition);

    const statuses = rows.map((r) => ({
      status: r.status,
      label: REQUEST_STATUS_LABELS[r.status as keyof typeof REQUEST_STATUS_LABELS] ?? r.status,
      total: r.total,
      amount: Number(r.amount ?? 0),
    }));

    return { statuses, byDepartment: byDept, totals: totals ?? { total: 0, pending: 0, completed: 0, returned: 0, avgDays: '0' } };
  }

  /* -------------------------------------------------------- In / kết xuất */

  /** Dữ liệu cho bản in */
  private async buildPrintData(id: number, user: AccessContext) {
    const detail = await this.findOne(id, user);
    const signatureByStep = new Map(detail.signatures.map((s) => [s.stepKey, s]));
    const signature: Record<string, Record<string, unknown>> = {};
    for (const step of detail.workflow?.steps ?? []) {
      const sig = signatureByStep.get(step.key);
      signature[step.key] = {
        key: step.key,
        title: step.title,
        name: sig?.fullName ?? '',
        fullName: sig?.fullName ?? '',
        position: sig?.title ?? step.title,
        title2: sig?.title ?? step.title,
        note: sig?.note ?? '',
        signed: !!sig,
        signedAt: sig?.signedAt ? formatVN(String(sig.signedAt).slice(0, 10)) : '',
        signedTime: sig?.signedAt
          ? new Date(sig.signedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
          : '',
        hash: sig?.contentHash ?? '',
        statusText: sig ? 'ĐÃ KÝ' : 'CHƯA KÝ',
      };
    }
    const patientGender = detail.patientGender ?? '';
    const birth = detail.patientBirthDate
      ? formatVN(String(detail.patientBirthDate))
      : (detail.patientBirthYear ?? '');
    const data: Record<string, unknown> = {
      // Cho phép mẫu in tham chiếu cả 'request.patientName' lẫn 'patientName'
      request: detail,
      ...detail,
      signature,
      signatures: detail.signatures,
      patientBirth: birth,
      patientGenderText: patientGender,
      ngayVaoVienText: detail.ngayVaoVien ? formatVN(String(detail.ngayVaoVien)) : '',
      ngayRaVienText: detail.ngayRaVien ? formatVN(String(detail.ngayRaVien)) : '',
      createdAtText: new Date(detail.createdAt).toLocaleDateString('vi-VN'),
      statusText: detail.statusLabel,
      timeline: detail.timeline,
      integrity: detail.integrity,
    };
    return { detail, data };
  }

  /** Dữ liệu in của phiếu (JSON) — cho trình thiết kế xem trước bằng dữ liệu thật */
  async printData(id: number, user: AccessContext) {
    const { data } = await this.buildPrintData(id, user);
    return JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  }

  /** Xem trước / xuất PDF phiếu theo mẫu in cấu hình được */
  async exportPdf(id: number, user: AccessContext, templateIdOrCode?: string | number) {
    const { detail, data } = await this.buildPrintData(id, user);
    let template = templateIdOrCode
      ? await this.printing.renderTemplate(templateIdOrCode, data, [])
      : null;
    if (!template) {
      const found = await this.printing.resolveFor('PHIEU_SUA_HSBA', detail.departmentId);
      if (!found) {
        throw new NotFoundException(
          'Chưa có mẫu in cho phiếu sửa HSBA — hãy tạo mẫu in với loại chứng từ PHIEU_SUA_HSBA',
        );
      }
      template = await this.printing.renderTemplate(found.id, data, []);
    }
    return {
      fileName: `${detail.code ?? 'phieu'}_${(detail.patientName ?? '').replace(/\s+/g, '_')}.pdf`,
      buffer: template.result.buffer,
      pages: template.result.pages,
      templateCode: template.template.code,
      signatureHashes: detail.integrity,
      hasUnsignedStep: detail.timeline.some((t) => t.state === 'PENDING'),
    };
  }

  /** Xác thực chữ ký số nội dung (dùng cho QR/đối chiếu) */
  async verify(id: number, stepKey: string, hash: string) {
    const [row] = await this.db.db.select().from(hsbaRequests).where(eq(hsbaRequests.id, id));
    if (!row) throw new NotFoundException('Không tìm thấy phiếu');
    const expected = this.contentHash(row, stepKey);
    const [sig] = await this.db.db
      .select()
      .from(hsbaSignatures)
      .where(and(eq(hsbaSignatures.requestId, id), eq(hsbaSignatures.stepKey, stepKey)));
    return {
      code: row.code,
      stepKey,
      found: !!sig,
      signedBy: sig?.fullName ?? '',
      signedAt: sig?.signedAt ?? null,
      hashMatches: hash === (sig?.contentHash ?? ''),
      contentUnchanged: expected === (sig?.contentHash ?? ''),
      expectedHash: expected,
    };
  }
}
