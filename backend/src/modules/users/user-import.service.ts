/**
 * Nhập danh sách nhân viên (người dùng) từ tệp Excel/CSV/TXT hoặc JSON.
 *
 * Quy trình 2 bước trên giao diện: chạy thử (dryRun) → xem trước từng dòng → xác nhận nhập.
 * - Họ tên là bắt buộc; tên đăng nhập bỏ trống sẽ tự tạo từ họ tên ("Nguyễn Văn An" → annv).
 * - Thư điện tử, điện thoại, ghi chú, chức danh, khoa… đều KHÔNG bắt buộc. Giá trị sai định
 *   dạng chỉ bị bỏ qua kèm cảnh báo, dòng vẫn được nhập.
 * - Người dùng đã có: bỏ qua, hoặc cập nhật nếu chọn "ghi đè" (ô trống trong tệp KHÔNG xoá
 *   dữ liệu cũ; mật khẩu không bị đổi).
 * - Toàn bộ ghi trong 1 transaction: lỗi giữa chừng → không dòng nào được ghi.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { Request } from 'express';
import * as ExcelJS from 'exceljs';
import { DbService } from '../../db/db.service';
import { SettingsService } from '../settings/settings.service';
import { departments, jobTitles, managementPositions, roles, userManagementPositions, userRoles, users } from '../../db/schema';
import type { AccessContext } from '../../common/types/access-context';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { DUTY_STAFF_ROLE_CODE, isDoctorTitle } from './duty-staff-role';
import {
  IMPORT_MAX_ROWS,
  normalizeKey,
  parseImportFile,
  suggestUsername,
  type ImportField,
  type ParsedFile,
  type ParsedRow,
} from './user-import.parser';

export const DEFAULT_IMPORT_PASSWORD = '1'; // Mật khẩu mặc định cho tài khoản nhập từ tệp khi ô mật khẩu để trống
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const USERNAME_RE = /^[a-z0-9._-]+$/;
/** MANV do tệp cung cấp có thể khác quy tắc backfill 4 ký tự, nhưng vẫn cùng bộ ký tự an toàn. */
const MANV_RE = /^[A-Za-z0-9._-]{1,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+().\-\s/,;]+$/;
/** Một ô import có thể khai báo nhiều chức vụ bằng dấu chấm phẩy, dấu phẩy hoặc xuống dòng. */
const splitManagementPositions = (value: string) => [...new Map(
  value.split(/[;,\n]+/).map((item) => item.trim()).filter(Boolean).map((item) => [item.toLocaleLowerCase('vi-VN'), item] as const),
).values()];

export interface ImportOptions {
  dryRun?: boolean;
  overwrite?: boolean;
  /** Tự thêm chức danh chưa có vào danh mục */
  addTitles?: boolean;
}

type Level = 'error' | 'warning' | 'info';
export interface ImportPreviewRow {
  line: number;
  /** Mã nhân viên liên thông, từ cột MANV hoặc 4 ký tự đầu tên đăng nhập. */
  manv: string;
  username: string;
  usernameGenerated: boolean;
  fullName: string;
  title: string;
  managementPosition: string;
  department: string;
  email: string;
  phone: string;
  roles: string[];
  action: 'create' | 'update' | 'skip' | 'error';
  messages: { level: Level; text: string }[];
}

interface PlannedRow extends ImportPreviewRow {
  /** Chỉ cột MANV được cung cấp mới được ghi đè trên tài khoản đã có. */
  manvProvided: boolean;
  existingId?: number;
  departmentId: number | null;
  roleIds: number[];
  note: string;
  password?: string;
}

@Injectable()
export class UserImportService {
  constructor(
    private readonly db: DbService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /* ------------------------------------------------------------ Đầu vào */

  /** Đọc thân yêu cầu dạng application/octet-stream (giới hạn 10 MB) */
  async readUpload(req: Request): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_FILE_BYTES) throw new BadRequestException('Tệp quá lớn (tối đa 10 MB)');
      chunks.push(chunk);
    }
    if (!size) throw new BadRequestException('Chưa chọn tệp hoặc tệp rỗng');
    return Buffer.concat(chunks);
  }

  async importFile(buf: Buffer, fileName: string, opts: ImportOptions, actor?: AccessContext) {
    const parsed = await parseImportFile(buf, fileName || 'danh-sach.xlsx');
    if (!parsed.rows.length) throw new BadRequestException('Tệp không có dòng dữ liệu nào bên dưới dòng tiêu đề');
    const result = await this.run(parsed.rows, opts, actor, fileName);
    return {
      ...result,
      file: {
        name: fileName,
        format: parsed.format,
        encoding: parsed.encoding,
        delimiter: parsed.delimiter === '\t' ? 'Tab' : parsed.delimiter,
        sheet: parsed.sheet,
        columns: parsed.columns,
        ignoredColumns: parsed.columns.filter((c) => !c.field).map((c) => c.header),
      },
    };
  }

  /** Tương thích API cũ POST /users/import (JSON rows, khoá là tên cột bất kỳ) */
  async importJson(rows: Record<string, unknown>[], opts: ImportOptions, actor?: AccessContext) {
    if (rows.length > IMPORT_MAX_ROWS) throw new BadRequestException(`Tối đa ${IMPORT_MAX_ROWS} dòng mỗi lần nhập`);
    const FIELD_KEYS: Record<string, ImportField> = {
      username: 'username', fullname: 'fullName', title: 'title', managementposition: 'managementPosition',
      position: 'managementPosition', chucvu: 'managementPosition', chucvukiemnhiem: 'managementPosition', departmentcode: 'department',
      department: 'department', email: 'email', phone: 'phone', note: 'note', roles: 'roles', password: 'password',
      manv: 'employeeCode', employeecode: 'employeeCode', employeeid: 'employeeCode',
    };
    const parsed: ParsedRow[] = rows.map((r, i) => {
      const values: ParsedRow['values'] = {};
      for (const [k, v] of Object.entries(r)) {
        const field = FIELD_KEYS[k.toLowerCase()] ?? this.fieldFromHeader(k);
        if (field && values[field] === undefined) values[field] = String(v ?? '').trim();
      }
      return { line: i + 2, values };
    });
    return this.run(parsed, opts, actor, 'JSON');
  }

  private fieldFromHeader(header: string): ImportField | null {
    // Dùng lại bảng tên cột của bộ đọc tệp (qua lưới 2 dòng giả)
    const k = normalizeKey(header);
    const map: Record<string, ImportField> = {
      tendangnhap: 'username', taikhoan: 'username', hoten: 'fullName', hovaten: 'fullName',
      manhanvien: 'employeeCode', manv: 'employeeCode', macanbo: 'employeeCode', macb: 'employeeCode', employeecode: 'employeeCode', employeeid: 'employeeCode', sohieu: 'employeeCode',
      chucdanh: 'title', chucdanhchuyenmon: 'title', chucvu: 'managementPosition', chucvukiemnhiem: 'managementPosition', chucvuquanly: 'managementPosition', makhoa: 'department', khoa: 'department', dienthoai: 'phone', sdt: 'phone',
      email: 'email', thudientu: 'email', ghichu: 'note', vaitro: 'roles', matkhau: 'password',
    };
    return map[k] ?? null;
  }

  /* ------------------------------------------------------------ Lõi */

  private async run(rows: ParsedRow[], opts: ImportOptions, actor: AccessContext | undefined, source: string) {
    const plan = await this.plan(rows, opts);
    const count = (a: ImportPreviewRow['action']) => plan.rows.filter((r) => r.action === a).length;
    const usesDefaultPassword = plan.rows.some((r) => r.action === 'create' && !r.password);
    let titlesAdded: string[] = plan.newTitles;

    if (!opts.dryRun && (count('create') || count('update'))) {
      titlesAdded = await this.apply(plan.rows, opts.addTitles ? plan.newTitles : []);
      await this.audit.log({
        userId: actor?.id ?? null,
        username: actor?.username ?? '',
        action: 'IMPORT',
        module: 'ADMIN',
        entity: 'user',
        description:
          `Nhập nhân viên từ ${source}: ${count('create')} mới, ${count('update')} cập nhật, ` +
          `${count('skip')} bỏ qua, ${count('error')} lỗi` +
          (titlesAdded.length ? `; thêm chức danh: ${titlesAdded.join(', ')}` : ''),
      });
    } else if (!opts.dryRun) {
      titlesAdded = [];
    }

    const preview = plan.rows.map(
      ({ existingId: _e, manvProvided: _mp, departmentId: _d, roleIds: _r, note: _n, password: _p, ...rest }) => rest,
    );
    return {
      dryRun: !!opts.dryRun,
      total: plan.rows.length,
      created: count('create'),
      updated: count('update'),
      skipped: count('skip'),
      errorCount: count('error'),
      warningCount: plan.rows.filter((r) => r.messages.some((m) => m.level === 'warning')).length,
      /** Chức danh chưa có trong danh mục (dryRun) / đã thêm vào danh mục (nhập thật) */
      newTitles: plan.newTitles,
      titlesAdded: opts.dryRun ? [] : titlesAdded,
      defaultPassword: usesDefaultPassword ? DEFAULT_IMPORT_PASSWORD : null,
      /** Dạng cũ, giữ tương thích */
      errors: plan.rows.flatMap((r) =>
        r.messages.filter((m) => m.level === 'error').map((m) => ({ row: r.line, message: m.text })),
      ),
      rows: preview,
    };
  }

  private async plan(rows: ParsedRow[], opts: ImportOptions) {
    const [allUsers, depts, roleRows, titles] = await Promise.all([
      this.db.db
        .select({ id: users.id, manv: users.manv, username: users.username, fullName: users.fullName, deletedAt: users.deletedAt })
        .from(users),
      this.db.db
        .select({ id: departments.id, code: departments.code, name: departments.name, shortName: departments.shortName })
        .from(departments)
        .where(sql`${departments.deletedAt} is null`),
      this.db.db.select({ id: roles.id, code: roles.code, name: roles.name }).from(roles),
      this.db.db.select({ name: jobTitles.name }).from(jobTitles),
    ]);

    const userByName = new Map(allUsers.map((u) => [u.username.toLowerCase(), u]));
    const taken = new Set(userByName.keys());
    const deptIndex = new Map<string, (typeof depts)[number]>();
    for (const d of depts) {
      // Ưu tiên mã → tên → tên viết tắt (không ghi đè khoá đã có)
      for (const k of [`c:${d.code.toLowerCase()}`, `n:${normalizeKey(d.name)}`, `n:${normalizeKey(d.shortName)}`]) {
        if (k.length > 2 && !deptIndex.has(k)) deptIndex.set(k, d);
      }
    }
    const roleIndex = new Map<string, (typeof roleRows)[number]>();
    for (const r of roleRows) {
      roleIndex.set(r.code.toUpperCase(), r);
      roleIndex.set(normalizeKey(r.name), r);
    }
    const titleIndex = new Map(titles.map((t) => [normalizeKey(t.name), t.name]));
    const newTitles = new Map<string, string>();
    const seenInFile = new Map<string, number>();

    // Độ dài mật khẩu tối thiểu từ cấu hình hệ thống — ngắn hơn thì rơi về mật khẩu mặc định
    const pwdMin = await this.settings.passwordMinLength();
    const planned: PlannedRow[] = rows.map(({ line, values: v }) => {
      const messages: PlannedRow['messages'] = [];
      const fullName = (v.fullName ?? '').trim();
      const row: PlannedRow = {
        line,
        manv: '',
        manvProvided: false,
        username: '',
        usernameGenerated: false,
        fullName,
        title: '',
        managementPosition: '',
        department: '',
        email: '',
        phone: '',
        roles: [],
        action: 'create',
        messages,
        departmentId: null,
        roleIds: [],
        note: (v.note ?? '').trim(),
      };
      const fail = (text: string) => {
        messages.push({ level: 'error', text });
        row.action = 'error';
      };

      if (!fullName) fail('Thiếu họ tên');

      // Giữ tương thích tệp cũ: nếu không có tên đăng nhập, cột MANV vẫn được dùng làm tên đăng nhập.
      let username = (v.username || v.employeeCode || '').trim().toLowerCase();
      if (!username && fullName) {
        const match = this.findGeneratedMatch(fullName, allUsers, seenInFile);
        if (match) {
          username = match.username.toLowerCase();
          messages.push({
            level: 'warning',
            text: `Trùng họ tên với tài khoản "${username}" đã có — coi là cùng người. Nếu là người khác, hãy điền cột "Tên đăng nhập"`,
          });
        } else {
          username = suggestUsername(fullName, taken);
          row.usernameGenerated = true;
          messages.push({ level: 'info', text: `Tự tạo tên đăng nhập "${username}"` });
        }
      }
      row.username = username;
      if (username) {
        if (username.length > 64 || !USERNAME_RE.test(username)) {
          fail(`Tên đăng nhập "${username}" không hợp lệ (chỉ gồm chữ không dấu, số, dấu chấm, gạch ngang, gạch dưới)`);
        } else if (seenInFile.has(username)) {
          fail(`Tên đăng nhập "${username}" trùng với dòng ${seenInFile.get(username)} trong tệp`);
        } else {
          seenInFile.set(username, line);
          taken.add(username);
        }
      } else if (fullName) {
        fail('Không tạo được tên đăng nhập từ họ tên — hãy nhập cột "Tên đăng nhập"');
      }

      // MANV: ưu tiên giá trị tệp; nếu trống, giữ quy tắc đã chốt = 4 ký tự đầu username.
      // Khi ghi đè một tài khoản cũ, MANV chỉ thay đổi nếu tệp thực sự có cột/giá trị MANV.
      const suppliedManv = (v.employeeCode ?? '').trim();
      if (row.action !== 'error') {
        if (suppliedManv) {
          if (!MANV_RE.test(suppliedManv)) {
            fail(`MANV "${suppliedManv}" không hợp lệ (tối đa 64 chữ, số, dấu chấm, gạch ngang hoặc gạch dưới)`);
          } else {
            row.manv = suppliedManv;
            row.manvProvided = true;
          }
        } else {
          row.manv = userByName.get(username)?.manv || username.slice(0, 4);
        }
      }

      // Thư điện tử / điện thoại: không bắt buộc, sai định dạng → bỏ qua giá trị
      const email = (v.email ?? '').trim();
      if (email) {
        if (EMAIL_RE.test(email) && email.length <= 254) row.email = email.toLowerCase();
        else messages.push({ level: 'warning', text: `Thư điện tử "${email}" không hợp lệ — bỏ qua` });
      }
      let phone = (v.phone ?? '').trim();
      if (/^[1-9]\d{8}$/.test(phone)) phone = `0${phone}`; // Excel làm mất số 0 đầu
      if (phone) {
        if (PHONE_RE.test(phone) && phone.length <= 32) row.phone = phone;
        else messages.push({ level: 'warning', text: `Số điện thoại "${phone}" không hợp lệ — bỏ qua` });
      }

      // Khoa: theo mã, tên hoặc tên viết tắt (không phân biệt dấu/hoa thường)
      const deptRaw = (v.department ?? '').trim();
      if (deptRaw) {
        const d = deptIndex.get(`c:${deptRaw.toLowerCase()}`) ?? deptIndex.get(`n:${normalizeKey(deptRaw)}`);
        if (d) {
          row.departmentId = d.id;
          row.department = `${d.code} — ${d.name}`;
        } else {
          row.department = deptRaw;
          messages.push({ level: 'warning', text: `Không tìm thấy khoa "${deptRaw}" — để trống khoa` });
        }
      }

      // Chức danh: khớp danh mục (không phân biệt dấu) để thống nhất cách viết
      const titleRaw = (v.title ?? '').trim();
      if (titleRaw) {
        const known = titleIndex.get(normalizeKey(titleRaw)) ?? newTitles.get(normalizeKey(titleRaw));
        row.title = known ?? titleRaw;
        if (!known) {
          newTitles.set(normalizeKey(titleRaw), titleRaw);
          messages.push(
            opts.addTitles
              ? { level: 'info', text: `Chức danh "${titleRaw}" sẽ được thêm vào danh mục` }
              : { level: 'warning', text: `Chức danh "${titleRaw}" chưa có trong danh mục (vẫn lưu)` },
          );
        }
      }

      // Chức vụ quản lý/kiêm nhiệm: giữ độc lập với chức danh chuyên môn để Bác sĩ kiêm Chủ nhiệm khoa vẫn được xếp lịch khám.
      const managementPositionRaw = (v.managementPosition ?? '').trim();
      if (managementPositionRaw) {
        if (managementPositionRaw.length <= 128) row.managementPosition = managementPositionRaw;
        else messages.push({ level: 'warning', text: `Chức vụ "${managementPositionRaw.slice(0, 40)}…" vượt quá 128 ký tự — bỏ qua` });
      }

      // Vai trò: mã hoặc tên, nhiều vai trò cách nhau bởi , ; |
      for (const part of (v.roles ?? '').split(/[,;|]/).map((s) => s.trim()).filter(Boolean)) {
        const r = roleIndex.get(part.toUpperCase()) ?? roleIndex.get(normalizeKey(part));
        if (r) {
          if (!row.roleIds.includes(r.id)) {
            row.roleIds.push(r.id);
            row.roles.push(r.code);
          }
        } else messages.push({ level: 'warning', text: `Vai trò "${part}" không tồn tại — bỏ qua` });
      }

      const password = (v.password ?? '').trim();
      if (password) {
        if (password.length >= pwdMin) row.password = password;
        else messages.push({ level: 'warning', text: `Mật khẩu dưới ${pwdMin} ký tự — dùng mật khẩu mặc định` });
      }

      if (row.action !== 'error') {
        const existing = userByName.get(username);
        if (existing?.deletedAt) {
          fail(`Tên đăng nhập "${username}" thuộc tài khoản đã xoá — hãy khôi phục tài khoản đó hoặc dùng tên khác`);
        } else if (existing) {
          row.existingId = existing.id;
          if (opts.overwrite) {
            row.action = 'update';
            if (password) messages.push({ level: 'info', text: 'Tài khoản đã có — cập nhật thông tin, KHÔNG đổi mật khẩu' });
            else messages.push({ level: 'info', text: 'Tài khoản đã có — cập nhật thông tin' });
          } else {
            row.action = 'skip';
            messages.push({ level: 'info', text: 'Tài khoản đã có — bỏ qua (chọn "Ghi đè" để cập nhật)' });
          }
        }
      }

      // Vai trò mặc định cho tài khoản tạo mới khi tệp không chỉ định: gán vai trò
      // "Nhập liệu / Người đề nghị" (mã NHAP_LIEU — nút quyền nhỏ nhất).
      // Dòng 'update'/'skip' không tự thêm — tránh cấp quyền ngoài ý muốn cho tài khoản đã có.
      if (row.action === 'create' && row.roleIds.length === 0) {
        const r = roleIndex.get('NHAP_LIEU');
        if (r) {
          row.roleIds.push(r.id);
          row.roles.push(r.code);
          messages.push({ level: 'info', text: `Không chỉ định vai trò — gán mặc định "${r.name}"` });
        }
      }

      // Bác sĩ luôn có thêm vai trò xem lịch trực, kể cả khi tệp đã chỉ định
      // các vai trò nghiệp vụ khác. Không áp dụng vào dòng bị bỏ qua.
      if ((row.action === 'create' || row.action === 'update') && isDoctorTitle(row.title)) {
        const dutyStaff = roleIndex.get(DUTY_STAFF_ROLE_CODE);
        if (dutyStaff && !row.roleIds.includes(dutyStaff.id)) {
          row.roleIds.push(dutyStaff.id);
          row.roles.push(dutyStaff.code);
          messages.push({ level: 'info', text: `Chức danh Bác sĩ — bổ sung mặc định vai trò "${dutyStaff.name}"` });
        }
      }
      return row;
    });

    return { rows: planned, newTitles: [...newTitles.values()] };
  }

  /**
   * Nhập lại cùng tệp không có cột tên đăng nhập: tìm người cùng họ tên có tên đăng nhập
   * dạng tự tạo (annv, annv2…) để cập nhật/bỏ qua thay vì tạo trùng.
   */
  private findGeneratedMatch(
    fullName: string,
    all: { id: number; username: string; fullName: string; deletedAt: Date | null }[],
    claimed: Map<string, number>,
  ) {
    const base = suggestUsername(fullName, new Set());
    if (!base) return undefined;
    const re = new RegExp(`^${base}\\d*$`);
    const key = normalizeKey(fullName);
    return all
      .filter((u) => !u.deletedAt && re.test(u.username.toLowerCase()) && normalizeKey(u.fullName) === key)
      .sort((a, b) => a.id - b.id)
      .find((u) => !claimed.has(u.username.toLowerCase()));
  }

  private async apply(rows: PlannedRow[], titlesToAdd: string[]): Promise<string[]> {
    // bcrypt rất chậm (≈100 ms/lần) → băm mật khẩu mặc định 1 lần, dùng chung
    const defaultHash = await this.auth.hashPassword(DEFAULT_IMPORT_PASSWORD);
    const customHashes = new Map<string, string>();
    for (const r of rows) {
      if (r.action === 'create' && r.password && !customHashes.has(r.password)) {
        customHashes.set(r.password, await this.auth.hashPassword(r.password));
      }
    }
    const touched: number[] = [];
    const added: string[] = [];
    const managementNames = [...new Map(
      rows.flatMap((row) => splitManagementPositions(row.managementPosition)).map((name) => [name.toLocaleLowerCase('vi-VN'), name] as const),
    ).values()];

    await this.db.db.transaction(async (tx) => {
      if (titlesToAdd.length) {
        const existing = await tx.select({ code: jobTitles.code, sort: jobTitles.sortOrder }).from(jobTitles);
        const codes = new Set(existing.map((e) => e.code.toUpperCase()));
        let sort = Math.max(0, ...existing.map((e) => e.sort));
        let seq = existing.length;
        for (const name of titlesToAdd) {
          let code: string;
          do code = `CD${String(++seq).padStart(3, '0')}`;
          while (codes.has(code));
          codes.add(code);
          const res = await tx
            .insert(jobTitles)
            .values({ code, name, sortOrder: ++sort })
            .onConflictDoNothing()
            .returning({ id: jobTitles.id });
          if (res.length) added.push(name);
        }
      }

      // Chức vụ kiêm nhiệm là danh mục riêng. Tệp cũ vẫn có thể nhập tên tự do;
      // tên mới được thêm an toàn, sau đó liên kết nhiều-nhiều theo từng nhân sự.
      const existingManagementPositions = await tx
        .select({ id: managementPositions.id, code: managementPositions.code, name: managementPositions.name, sortOrder: managementPositions.sortOrder })
        .from(managementPositions);
      const managementByName = new Map(existingManagementPositions.map((position) => [position.name.toLocaleLowerCase('vi-VN').trim(), position]));
      const managementCodes = new Set(existingManagementPositions.map((position) => position.code.toUpperCase()));
      let managementSort = Math.max(0, ...existingManagementPositions.map((position) => position.sortOrder));
      let managementSequence = existingManagementPositions.length;
      for (const name of managementNames) {
        const key = name.toLocaleLowerCase('vi-VN');
        if (managementByName.has(key)) continue;
        let code: string;
        do code = `CV${String(++managementSequence).padStart(3, '0')}`;
        while (managementCodes.has(code));
        managementCodes.add(code);
        const [created] = await tx.insert(managementPositions).values({ code, name, sortOrder: ++managementSort }).returning({ id: managementPositions.id, code: managementPositions.code, name: managementPositions.name, sortOrder: managementPositions.sortOrder });
        if (created) managementByName.set(key, created);
      }
      const syncManagementPositions = async (userId: number, value: string) => {
        const positions = splitManagementPositions(value)
          .map((name) => managementByName.get(name.toLocaleLowerCase('vi-VN')))
          .filter((position): position is { id: number; code: string; name: string; sortOrder: number } => !!position)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi'));
        await tx.delete(userManagementPositions).where(eq(userManagementPositions.userId, userId));
        if (positions.length) await tx.insert(userManagementPositions).values(positions.map((position) => ({ userId, managementPositionId: position.id })));
        await tx.update(users).set({ managementPosition: positions.map((position) => position.name).join('; '), updatedAt: new Date() }).where(eq(users.id, userId));
      };

      const roleLinks: { userId: number; roleId: number }[] = [];
      for (const r of rows) {
        if (r.action === 'create') {
          const [created] = await tx
            .insert(users)
            .values({
              manv: r.manv,
              username: r.username,
              passwordHash: r.password ? customHashes.get(r.password)! : defaultHash,
              fullName: r.fullName,
              title: r.title,
              managementPosition: r.managementPosition,
              email: r.email,
              phone: r.phone,
              note: r.note,
              departmentId: r.departmentId,
              mustChangePassword: true,
            })
            .returning({ id: users.id });
          if (r.managementPosition) await syncManagementPositions(created!.id, r.managementPosition);
          r.roleIds.forEach((roleId) => roleLinks.push({ userId: created!.id, roleId }));
        } else if (r.action === 'update' && r.existingId) {
          // Chỉ ghi các ô có giá trị — ô trống trong tệp giữ nguyên dữ liệu cũ
          await tx
            .update(users)
            .set({
              fullName: r.fullName,
              ...(r.manvProvided ? { manv: r.manv } : {}),
              ...(r.title ? { title: r.title } : {}),
              ...(r.managementPosition ? { managementPosition: r.managementPosition } : {}),
              ...(r.email ? { email: r.email } : {}),
              ...(r.phone ? { phone: r.phone } : {}),
              ...(r.note ? { note: r.note } : {}),
              ...(r.departmentId ? { departmentId: r.departmentId } : {}),
              updatedAt: new Date(),
            })
            .where(eq(users.id, r.existingId));
          if (r.managementPosition) await syncManagementPositions(r.existingId, r.managementPosition);
          touched.push(r.existingId);
          r.roleIds.forEach((roleId) => roleLinks.push({ userId: r.existingId!, roleId }));
        }
      }
      for (let i = 0; i < roleLinks.length; i += 1000) {
        await tx.insert(userRoles).values(roleLinks.slice(i, i + 1000)).onConflictDoNothing();
      }
    });

    for (const id of touched) await this.auth.invalidateUserCache(id);
    return added;
  }

  /* ------------------------------------------------------------ Tệp mẫu */

  async template(): Promise<Buffer> {
    const [depts, titles, managementPositionRows, roleRows] = await Promise.all([
      this.db.db
        .select({ code: departments.code, name: departments.name, kind: departments.kind })
        .from(departments)
        .where(sql`${departments.deletedAt} is null and ${departments.active} = true`)
        .orderBy(departments.level, departments.sortOrder, departments.name),
      this.db.db
        .select({ name: jobTitles.name })
        .from(jobTitles)
        .where(eq(jobTitles.active, true))
        .orderBy(jobTitles.sortOrder, jobTitles.name),
      this.db.db
        .select({ name: managementPositions.name })
        .from(managementPositions)
        .where(eq(managementPositions.active, true))
        .orderBy(managementPositions.sortOrder, managementPositions.name),
      this.db.db.select({ code: roles.code, name: roles.name }).from(roles).orderBy(roles.sortOrder),
    ]);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'QLBS';
    const ws = wb.addWorksheet('Nhân viên', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Họ và tên', key: 'fullName', width: 28 },
      { header: 'MANV', key: 'employeeCode', width: 12 },
      { header: 'Tên đăng nhập', key: 'username', width: 18 },
      { header: 'Chức danh chuyên môn', key: 'title', width: 22 },
      { header: 'Chức vụ kiêm nhiệm', key: 'managementPosition', width: 24 },
      { header: 'Mã khoa', key: 'department', width: 14 },
      { header: 'Thư điện tử', key: 'email', width: 28 },
      { header: 'Điện thoại', key: 'phone', width: 16 },
      { header: 'Vai trò', key: 'roles', width: 16 },
      { header: 'Ghi chú', key: 'note', width: 28 },
    ];
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
    header.alignment = { vertical: 'middle' };
    header.height = 22;
    ws.getColumn('phone').numFmt = '@'; // giữ số 0 đầu
    ws.getColumn('employeeCode').numFmt = '@';
    ws.getColumn('username').numFmt = '@';
    const khoa = depts.filter((d) => d.kind === 'KHOA');
    const d1 = (khoa[0] ?? depts[0])?.code ?? '';
    const d2 = (khoa[1] ?? depts[1])?.code ?? d1;
    ws.addRow({ fullName: 'Nguyễn Văn An', employeeCode: '', username: '', title: titles.find((item) => isDoctorTitle(item.name))?.name ?? 'Bác sĩ', managementPosition: 'Chủ nhiệm khoa', department: d1, email: 'an.nv@benhvien.vn', phone: '0912345678', roles: '', note: 'Chức danh chuyên môn Bác sĩ và chức vụ kiêm nhiệm được lưu riêng' });
    ws.addRow({ fullName: 'Trần Thị Bình', employeeCode: 'bint', username: 'binhtt', title: titles[1]?.name ?? 'Điều dưỡng', managementPosition: '', department: d2, email: '', phone: '', roles: '', note: '' });
    ws.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };
    ws.getRow(3).font = { italic: true, color: { argb: 'FF6B7280' } };
    if (titles.length) {
      for (let r = 2; r <= 500; r++) {
        ws.getCell(`D${r}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          showErrorMessage: false,
          formulae: [`'Hướng dẫn'!$D$2:$D$${titles.length + 1}`],
        };
      }
    }
    if (managementPositionRows.length) {
      for (let r = 2; r <= 500; r++) {
        ws.getCell(`E${r}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          showErrorMessage: false,
          formulae: [`'Hướng dẫn'!$E$2:$E$${managementPositionRows.length + 1}`],
        };
      }
    }

    const guide = wb.addWorksheet('Hướng dẫn');
    guide.columns = [
      { header: 'Hướng dẫn', key: 'a', width: 70 },
      { header: '', key: 'gap', width: 3 },
      { header: 'Mã khoa', key: 'deptCode', width: 14 },
      { header: 'Chức danh chuyên môn', key: 'title', width: 24 },
      { header: 'Chức vụ kiêm nhiệm', key: 'managementPosition', width: 26 },
      { header: 'Mã vai trò', key: 'roleCode', width: 16 },
      { header: 'Tên vai trò', key: 'roleName', width: 30 },
      { header: 'Tên khoa', key: 'deptName', width: 40 },
    ];
    guide.getRow(1).font = { bold: true };
    const notes = [
      'Nhập dữ liệu ở trang "Nhân viên", mỗi người một dòng. Có thể xoá 2 dòng ví dụ.',
      'Bắt buộc: Họ và tên.',
      'Không bắt buộc: MANV, Tên đăng nhập, Chức danh chuyên môn, Chức vụ kiêm nhiệm, Mã khoa, Thư điện tử, Điện thoại, Vai trò, Ghi chú.',
      'MANV: nếu để trống, hệ thống lấy 4 ký tự đầu Tên đăng nhập; nếu có nhập, hệ thống giữ nguyên mã liên thông đã cung cấp.',
      'Tên đăng nhập để trống → tự tạo từ họ tên: "Nguyễn Văn An" → annv (trùng thì annv2…).',
      'Mã khoa: nhập mã hoặc tên khoa (xem cột bên phải).',
      'Chức danh chuyên môn: chọn theo danh mục; nhập “Bác sĩ” để được xét lịch khám. Chức vụ kiêm nhiệm (ví dụ Chủ nhiệm khoa) được lưu riêng, không thay thế chức danh chuyên môn; có thể ghi nhiều chức vụ, cách nhau bằng dấu chấm phẩy (;).',
      'Vai trò: mã vai trò, nhiều vai trò cách nhau bởi dấu phẩy.',
      `Tài khoản mới dùng mật khẩu mặc định ${DEFAULT_IMPORT_PASSWORD} và phải đổi khi đăng nhập lần đầu.`,
      'Có thể thêm cột "Mật khẩu" nếu muốn đặt riêng (tối thiểu 6 ký tự).',
      'Cũng nhận tệp CSV/TXT (UTF-8, phân cách bằng dấu phẩy, chấm phẩy hoặc Tab) với cùng tên cột.',
    ];
    const n = Math.max(notes.length, depts.length, titles.length, managementPositionRows.length, roleRows.length);
    for (let i = 0; i < n; i++) {
      guide.addRow({
        a: notes[i] ?? '',
        deptCode: depts[i]?.code ?? '',
        deptName: depts[i]?.name ?? '',
        title: titles[i]?.name ?? '',
        managementPosition: managementPositionRows[i]?.name ?? '',
        roleCode: roleRows[i]?.code ?? '',
        roleName: roleRows[i]?.name ?? '',
      });
    }
    guide.getColumn('a').alignment = { wrapText: true, vertical: 'top' };
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
