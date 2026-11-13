/**
 * Cấu hình hệ thống — lưu dạng khoá/giá trị JSON, nhóm theo `group`.
 * Cho phép quản trị thay đổi thông tin bệnh viện, quy tắc nghiệp vụ, mẫu in mặc định…
 * mà không cần sửa mã nguồn hay triển khai lại.
 */
import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { settings } from '../../db/schema';
import { CacheService } from '../../infra/cache/cache.service';

export interface SettingItem {
  key: string;
  value: unknown;
  group?: string;
  label?: string;
  description?: string;
  valueType?: string;
  isPublic?: boolean;
}

const CACHE_PREFIX = 'setting:';

@Injectable()
export class SettingsService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly cache: CacheService,
  ) {}

  async onModuleInit() {
    try {
      await this.ensureDefaults();
    } catch (e: any) {
      console.warn('[SettingsService] Lỗi nạp cấu hình mặc định:', e?.message || e);
    }
  }

  private async invalidate(key?: string): Promise<void> {
    if (key) await this.cache.del(`${CACHE_PREFIX}${key}`);
    await this.cache.delByPrefix(CACHE_PREFIX);
    await this.cache.del('setting:all');
  }

  async all() {
    await this.ensureDefaults();
    const rows = await this.db.db
      .select()
      .from(settings)
      .orderBy(asc(settings.group), asc(settings.key));
    const grouped = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = grouped.get(row.group) ?? [];
      list.push(row);
      grouped.set(row.group, list);
    }
    return {
      items: rows,
      groups: [...grouped.entries()].map(([group, items]) => ({ group, items })),
    };
  }

  /** Cấu hình công khai cho giao diện (không lộ thông tin nội bộ) */
  async publicSettings(): Promise<Record<string, unknown>> {
    const rows = await this.db.db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(eq(settings.isPublic, true));
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async get<T = unknown>(key: string, fallback: T | null = null): Promise<T | null> {
    const cached = await this.cache.get<T>(`${CACHE_PREFIX}${key}`);
    if (cached !== null) return cached;
    const [row] = await this.db.db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1);
    if (!row) return fallback;
    await this.cache.set(`${CACHE_PREFIX}${key}`, row.value, 600);
    return row.value as T;
  }

  /** Độ dài mật khẩu tối thiểu theo cấu hình `system.passwordMinLength` (mặc định 6, ép khung 1–64) */
  async passwordMinLength(): Promise<number> {
    const v = Number(await this.get<number>('system.passwordMinLength', 6));
    if (!Number.isFinite(v)) return 6;
    return Math.min(64, Math.max(1, Math.floor(v)));
  }

  /**
   * Chính sách giữ bộ backup đầy đủ. Không cho thấp hơn 3 để một lỗi chỉ được
   * phát hiện muộn vẫn còn ít nhất ba điểm khôi phục cục bộ.
   */
  async backupKeepCount(): Promise<number> {
    return this.boundedNumber('backup.keepCount', 3, 3, 365);
  }

  /** Số ngày giữ tệp xuất tạm (Excel/PDF/Studio), không bao giờ áp dụng lên uploads. */
  async exportRetentionDays(): Promise<number> {
    return this.boundedNumber('backup.exportRetentionDays', 30, 1, 3650);
  }

  /** File .partial/.building cũ hơn mốc này mới được coi là rác sau khi backup lỗi/ngắt. */
  async backupTemporaryRetentionHours(): Promise<number> {
    return this.boundedNumber('backup.temporaryRetentionHours', 24, 1, 24 * 30);
  }

  /** Lịch sử chạy tác vụ là log vận hành, có thể dọn an toàn; nhật ký kiểm toán không bị dọn. */
  async jobRunRetentionDays(): Promise<number> {
    return this.boundedNumber('backup.jobRunRetentionDays', 90, 30, 3650);
  }

  private async boundedNumber(key: string, fallback: number, min: number, max: number): Promise<number> {
    const value = Number(await this.get<number>(key, fallback));
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(value)));
  }

  async getMany(keys: string[]): Promise<Record<string, unknown>> {
    if (keys.length === 0) return {};
    const rows = await this.db.db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(inArray(settings.key, keys));
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async set(item: SettingItem, userId?: number) {
    const value = this.normalizeManagedValue(item.key, item.value);
    await this.db.db
      .insert(settings)
      .values({
        key: item.key,
        value: value as never,
        group: item.group ?? 'general',
        label: item.label ?? '',
        description: item.description ?? '',
        valueType: item.valueType ?? this.inferType(value),
        isPublic: item.isPublic ?? false,
        updatedBy: userId ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          value: value as never,
          ...(item.group !== undefined ? { group: item.group } : {}),
          ...(item.label !== undefined ? { label: item.label } : {}),
          ...(item.description !== undefined ? { description: item.description } : {}),
          ...(item.valueType !== undefined ? { valueType: item.valueType } : {}),
          ...(item.isPublic !== undefined ? { isPublic: item.isPublic } : {}),
          updatedBy: userId ?? null,
          updatedAt: new Date(),
        },
      });
    await this.invalidate(item.key);
    return { key: item.key, value };
  }

  /** Chặn giá trị giữ/dọn nguy hiểm ngay tại API, không chỉ lúc công việc chạy. */
  private normalizeManagedValue(key: string, value: unknown): unknown {
    if (key === 'app.brandName') {
      const name = String(value ?? '').trim();
      return name ? name.slice(0, 80) : 'QLBS';
    }
    if (key === 'app.brandSubtitle') {
      const subtitle = String(value ?? '').trim();
      return subtitle ? subtitle.slice(0, 120) : 'Quản lý bệnh viện';
    }
    if (key === 'hospital.logo') {
      const source = String(value ?? '').trim();
      if (!source) return '';
      const dataUrl = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(source);
      if (dataUrl) {
        const mime = dataUrl[1].toLowerCase(); const encoded = dataUrl[2]; const bytes = Buffer.from(encoded, 'base64');
        if (!bytes.length || bytes.length > 512 * 1024) throw new BadRequestException('Logo phải là ảnh PNG/JPEG/WebP không quá 512 KB');
        const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
        const isWebp = bytes.subarray(0, 4).equals(Buffer.from('RIFF')) && bytes.subarray(8, 12).equals(Buffer.from('WEBP'));
        if ((mime === 'png' && !isPng) || (mime === 'jpeg' && !isJpeg) || (mime === 'webp' && !isWebp)) throw new BadRequestException('Nội dung logo không khớp định dạng ảnh đã chọn');
        return `data:image/${mime};base64,${encoded}`;
      }
      if ((source.startsWith('/') || /^https?:\/\//i.test(source)) && source.length <= 2_000) return source;
      throw new BadRequestException('Logo phải là ảnh PNG/JPEG/WebP hoặc đường dẫn ảnh hợp lệ');
    }
    const policies: Record<string, { fallback: number; min: number; max: number }> = {
      'backup.keepCount': { fallback: 3, min: 3, max: 365 },
      'backup.exportRetentionDays': { fallback: 30, min: 1, max: 3650 },
      'backup.temporaryRetentionHours': { fallback: 24, min: 1, max: 24 * 30 },
      'backup.jobRunRetentionDays': { fallback: 90, min: 30, max: 3650 },
      'dutyAttendance.restPairLookbackDays': { fallback: 14, min: 1, max: 62 },
    };
    if (key === 'dutyAttendance.lockPolicy') {
      const policy = String(value ?? '').trim().toUpperCase();
      return ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(policy) ? policy : 'DAILY';
    }
    if (key === 'dutyAttendance.staffOrderMode') {
      const mode = String(value ?? '').trim().toUpperCase();
      return ['PROFESSIONAL', 'MANAGEMENT_THEN_PROFESSIONAL'].includes(mode) ? mode : 'PROFESSIONAL';
    }
    const policy = policies[key];
    if (!policy) return value;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return policy.fallback;
    return Math.min(policy.max, Math.max(policy.min, Math.floor(numeric)));
  }

  async setMany(items: SettingItem[], userId?: number) {
    for (const item of items) await this.set(item, userId);
    return { message: `Đã lưu ${items.length} cấu hình`, updated: items.length };
  }

  async remove(key: string) {
    const [deleted] = await this.db.db.delete(settings).where(eq(settings.key, key)).returning();
    if (!deleted) throw new NotFoundException(`Không tìm thấy cấu hình "${key}"`);
    await this.invalidate(key);
    return { message: `Đã xoá cấu hình ${key}` };
  }

  /** Đặt lại cấu hình về giá trị mặc định của hệ thống */
  async resetToDefaults(userId?: number) {
    const defaults = defaultSettings();
    await this.setMany(defaults, userId);
    return { message: 'Đã khôi phục cấu hình mặc định', total: defaults.length };
  }

  async ensureDefaults(userId?: number): Promise<number> {
    const defaults = defaultSettings();
    const existing = await this.db.db.select({ key: settings.key }).from(settings);
    const existingKeys = new Set(existing.map((r) => r.key));
    const missing = defaults.filter((d) => !existingKeys.has(d.key));
    if (missing.length > 0) {
      for (const item of missing) {
        await this.set(item, userId);
      }
    }
    return missing.length;
  }

  private inferType(value: unknown): string {
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'object') return 'json';
    return 'string';
  }
}

/** Danh mục cấu hình mặc định — quản trị sửa được toàn bộ */
export function defaultSettings(): SettingItem[] {
  return [
    // Thông tin đơn vị
    { key: 'hospital.name', value: 'BỆNH VIỆN QUÂN Y 4', group: 'hospital', label: 'Tên bệnh viện', isPublic: true },
    { key: 'app.brandName', value: 'QLBS', group: 'hospital', label: 'Tên ứng dụng', description: 'Tên hiển thị thay cho QLBS ở menu và màn hình đăng nhập.', isPublic: true },
    { key: 'app.brandSubtitle', value: 'Quản lý bệnh viện', group: 'hospital', label: 'Dòng mô tả ứng dụng', description: 'Dòng chữ nhỏ bên dưới tên ứng dụng.', isPublic: true },
    { key: 'hospital.shortName', value: 'BVQY4', group: 'hospital', label: 'Tên viết tắt', isPublic: true },
    { key: 'hospital.address', value: '', group: 'hospital', label: 'Địa chỉ', isPublic: true },
    { key: 'hospital.phone', value: '', group: 'hospital', label: 'Điện thoại', isPublic: true },
    { key: 'hospital.website', value: '', group: 'hospital', label: 'Website', isPublic: true },
    { key: 'hospital.logo', value: '', group: 'hospital', label: 'Logo ứng dụng', description: 'Chọn tệp PNG/JPEG/WebP tối đa 512 KB hoặc nhập đường dẫn ảnh. Logo hiển thị ở menu và màn hình đăng nhập.', valueType: 'brand-logo', isPublic: true },
    { key: 'hospital.director', value: '', group: 'hospital', label: 'Giám đốc bệnh viện', isPublic: true },
    { key: 'hospital.parentName', value: '', group: 'hospital', label: 'Cơ quan cấp trên (dòng trên tên đơn vị ở biên bản)', isPublic: true },
    { key: 'hospital.place', value: '', group: 'hospital', label: 'Địa danh ghi trên văn bản (vd: TP. Hồ Chí Minh)', isPublic: true },

    // Quy tắc HSBA
    { key: 'hsba.codePrefix', value: 'SDS', group: 'hsba', label: 'Tiền tố mã phiếu sửa HSBA', isPublic: true },
    { key: 'hsba.requirePatientCode', value: false, group: 'hsba', label: 'Bắt buộc nhập mã KCB', valueType: 'boolean' },
    { key: 'hsba.allowEditAfterSign', value: false, group: 'hsba', label: 'Cho sửa phiếu sau khi đã ký', valueType: 'boolean' },
    { key: 'hsba.defaultWorkflow', value: 'MAC_DINH', group: 'hsba', label: 'Quy trình ký mặc định', isPublic: true },
    { key: 'hsba.enableSignatureHash', value: true, group: 'hsba', label: 'Băm xác thực nội dung khi ký', valueType: 'boolean' },

    // Quy tắc báo cáo
    { key: 'report.weekStartsOn', value: 'monday', group: 'report', label: 'Tuần bắt đầu từ', isPublic: true },
    { key: 'report.carryOver', value: true, group: 'report', label: 'Tự động lấy số dư kỳ trước', valueType: 'boolean' },
    { key: 'report.allowBackdated', value: true, group: 'report', label: 'Cho nhập số liệu ngày cũ', valueType: 'boolean' },
    { key: 'report.lockPreviousPeriods', value: false, group: 'report', label: 'Khoá số liệu các kỳ đã qua', valueType: 'boolean' },
    { key: 'report.defaultPeriod', value: 'week', group: 'report', label: 'Kỳ báo cáo mặc định', isPublic: true },
    { key: 'report.decimals', value: 0, group: 'report', label: 'Số chữ số thập phân trên báo cáo', valueType: 'number', isPublic: true },

    // Bản in
    { key: 'print.defaultPaper', value: 'A4', group: 'print', label: 'Khổ giấy mặc định', isPublic: true },
    { key: 'print.defaultFont', value: 'Times New Roman', group: 'print', label: 'Phông chữ mặc định', isPublic: true },
    { key: 'print.defaultFontSize', value: 13, group: 'print', label: 'Cỡ chữ mặc định (pt)', valueType: 'number', isPublic: true },

    // Nhập / xuất
    { key: 'export.dateFormat', value: 'dd/MM/yyyy', group: 'export', label: 'Định dạng ngày khi xuất', isPublic: true },
    { key: 'export.excelTemplate', value: '', group: 'export', label: 'Đường dẫn tệp Excel mẫu' },
    { key: 'export.includeSignature', value: true, group: 'export', label: 'Chèn chữ ký vào PDF', valueType: 'boolean' },

    // Thông báo
    { key: 'notify.onNewRequest', value: true, group: 'notification', label: 'Thông báo khi có phiếu mới', valueType: 'boolean' },
    { key: 'notify.onSign', value: true, group: 'notification', label: 'Thông báo khi phiếu được ký', valueType: 'boolean' },
    { key: 'notify.onReturn', value: true, group: 'notification', label: 'Thông báo khi phiếu bị trả lại', valueType: 'boolean' },

    // Kênh thông báo bên ngoài — Telegram Bot (miễn phí): bật rồi nhập Bot Token, người dùng tự liên kết ở trang Cá nhân
    { key: 'notify.channel.appUrl', value: '', group: 'notification', label: 'Địa chỉ web hệ thống (ghép vào liên kết trong tin nhắn)', description: 'Ví dụ: http://192.168.1.10:3000 — bỏ trống thì tin nhắn không kèm liên kết' },
    { key: 'telegram.enabled', value: false, group: 'notification', label: 'Gửi thông báo qua Telegram Bot', valueType: 'boolean' },
    { key: 'telegram.botToken', value: '', group: 'notification', label: 'Telegram Bot Token', valueType: 'password', description: 'Tạo miễn phí bằng /newbot tại @BotFather trên Telegram' },

    // Chấm công
    {
      key: 'dutyAttendance.lockPolicy',
      value: 'DAILY',
      group: 'attendance',
      label: 'Chế độ khóa bảng chấm công',
      description: 'Chọn thời điểm dữ liệu chấm công không còn được sửa: qua ngày, hết tuần, hết tháng hoặc hết năm. Số liệu tự nhập theo tháng được khóa khi tháng/kỳ năm đã qua.',
      valueType: 'attendance-lock-policy',
    },
    {
      key: 'dutyAttendance.restPairLookbackDays',
      value: 14,
      group: 'attendance',
      label: 'Số ngày dò ca trước khi tính nghỉ bù',
      description: 'Ký hiệu nghỉ bù sẽ ghép với ca Trực/Tăng cường phù hợp gần nhất trước đó trong số ngày này. Giới hạn giúp không ghép nhầm với một ca quá xa trong lịch sử.',
      valueType: 'number',
    },
    {
      key: 'dutyAttendance.staffOrderMode',
      value: 'PROFESSIONAL',
      group: 'attendance',
      label: 'Thứ tự nhân sự bảng chấm công',
      description: 'Chọn ưu tiên chức danh chuyên môn hoặc chức vụ quản lý/kiêm nhiệm trước chức danh chuyên môn. Mọi thứ tự đều lấy từ cột Thứ tự của danh mục; dữ liệu cũ chưa có danh mục xếp sau.',
      valueType: 'attendance-staff-order',
    },

    // Kiosk phòng khám & Điểm danh
    {
      key: 'kiosk.itMasterPin',
      value: '',
      group: 'kiosk',
      label: 'Mã PIN IT mở khoá Kiosk khẩn cấp',
      description: 'Đặt mã riêng của bệnh viện trước khi triển khai. Xác minh trực tuyến, giới hạn 5 lần nhập/10 phút; khi mất mạng dùng bộ gỡ có quyền Administrator.',
      valueType: 'password',
      isPublic: false,
    },
    {
      key: 'kiosk.qrExpiresSeconds',
      value: 15,
      group: 'kiosk',
      label: 'Thời gian hiệu lực mã QR Kiosk (giây)',
      description: 'Thời gian sống của mỗi mã QR động trên màn hình phòng khám trước khi tự động đổi mới (mặc định 15 giây để triệt tiêu việc chụp ảnh chuyển tiếp)',
      valueType: 'number',
      isPublic: true,
    },
    {
      key: 'kiosk.faceVerifyBufferSeconds',
      value: 60,
      group: 'kiosk',
      label: 'Thời gian đệm xác thực khuôn mặt sau khi quét (giây)',
      description: 'Khoảng thời gian gia hạn đệm cho Bác sĩ (đặc biệt bác sĩ lớn tuổi) thong thả nhìn camera nhận diện khuôn mặt sau khi đã quét mã QR thành công (mặc định 60 giây)',
      valueType: 'number',
      isPublic: true,
    },
    {
      key: 'kiosk.earlyCheckinMinutes',
      value: 60,
      group: 'kiosk',
      label: 'Thời gian cho phép đến sớm trước ca (phút)',
      description: 'Số phút trước khi ca trực bắt đầu mà Bác sĩ được phép quét QR mở khoá phòng khám và Kiosk hiển thị ca sắp tới',
      valueType: 'number',
      isPublic: true,
    },
    {
      key: 'kiosk.lateCheckoutMinutes',
      value: 30,
      group: 'kiosk',
      label: 'Thời gian ân hạn sau ca trực (phút)',
      description: 'Số phút sau khi ca trực kết thúc mà Bác sĩ vẫn được phép quét QR mở khoá Kiosk để hoàn tất bàn giao ca',
      valueType: 'number',
      isPublic: true,
    },
    {
      key: 'kiosk.allowSelfEnroll',
      value: false,
      group: 'kiosk',
      label: 'Cho phép nhân viên tự chụp đăng ký khuôn mặt lần đầu',
      description: 'Nếu bật, nhân viên chưa có dữ liệu có thể tự chụp ảnh trên trang Cá nhân. Nếu tắt, chỉ Quản trị viên/Phòng TCCB mới có quyền chụp tại Quản trị người dùng.',
      valueType: 'boolean',
      isPublic: true,
    },
    {
      key: 'kiosk.allowSelfUpdate',
      value: false,
      group: 'kiosk',
      label: 'Cho phép nhân viên tự chụp đổi lại khuôn mặt đã đăng ký',
      description: 'Nếu bật, nhân viên đã có khuôn mặt có thể tự chụp đè lại. KHUYẾN NGHỊ TẮT để triệt tiêu gian lận ca trực nhờ người khác chụp hộ.',
      valueType: 'boolean',
      isPublic: true,
    },
    {
      key: 'kiosk.faceDuplicateThreshold',
      value: 0.65,
      group: 'kiosk',
      label: 'Ngưỡng phát hiện trùng lặp khuôn mặt toàn viện (1:N)',
      description: 'Độ tương đồng tối thiểu để hệ thống cảnh báo và từ chối nếu khuôn mặt đăng ký trùng với nhân sự khác trong bệnh viện (chống mượn mặt đồng nghiệp).',
      valueType: 'number',
      isPublic: false,
    },

    // Sao lưu & vệ sinh lưu trữ. Các giới hạn được ép ở server để không vô tình xoá hết điểm khôi phục.
    {
      key: 'backup.keepCount',
      value: 3,
      group: 'backup',
      label: 'Số bộ sao lưu đầy đủ cần giữ',
      description: 'Giữ số bộ mới nhất gồm CSDL, tệp HSBA/phông tải lên và ảnh khuôn mặt. Tối thiểu 3 để luôn còn điểm khôi phục an toàn.',
      valueType: 'number',
    },
    {
      key: 'backup.exportRetentionDays',
      value: 30,
      group: 'backup',
      label: 'Số ngày giữ tệp kết xuất tạm',
      description: 'Áp dụng cho Excel/PDF/ấn bản Studio đã xuất. Không áp dụng lên tệp HSBA, ảnh khuôn mặt hoặc dữ liệu tải lên.',
      valueType: 'number',
    },
    {
      key: 'backup.temporaryRetentionHours',
      value: 24,
      group: 'backup',
      label: 'Số giờ giữ tệp dở dang',
      description: 'Chỉ dọn tệp .partial/.building do sao lưu hoặc tải lên bị ngắt; tệp backup hoàn chỉnh không bị dọn theo mục này.',
      valueType: 'number',
    },
    {
      key: 'backup.jobRunRetentionDays',
      value: 90,
      group: 'backup',
      label: 'Số ngày giữ lịch sử chạy tác vụ',
      description: 'Dọn lịch sử kỹ thuật của tác vụ nền sau thời hạn này; nhật ký kiểm toán nghiệp vụ không bị xóa.',
      valueType: 'number',
    },

    // Hệ thống
    { key: 'system.sessionHours', value: 12, group: 'system', label: 'Thời gian phiên đăng nhập (giờ)', valueType: 'number' },
    { key: 'system.passwordMinLength', value: 6, group: 'system', label: 'Độ dài mật khẩu tối thiểu', valueType: 'number', isPublic: true },
    { key: 'system.maintenanceMode', value: false, group: 'system', label: 'Chế độ bảo trì', valueType: 'boolean' },
    { key: 'system.maintenanceMessage', value: 'Hệ thống đang bảo trì, vui lòng quay lại sau.', group: 'system', label: 'Thông báo bảo trì', isPublic: true },
    { key: 'system.dashboardNotice', value: '', group: 'system', label: 'Thông báo trên trang chủ', isPublic: true },
  ];
}
