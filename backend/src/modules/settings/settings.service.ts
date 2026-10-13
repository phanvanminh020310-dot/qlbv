/**
 * Cấu hình hệ thống — lưu dạng khoá/giá trị JSON, nhóm theo `group`.
 * Cho phép quản trị thay đổi thông tin bệnh viện, quy tắc nghiệp vụ, mẫu in mặc định…
 * mà không cần sửa mã nguồn hay triển khai lại.
 */
import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
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

  async getMany(keys: string[]): Promise<Record<string, unknown>> {
    if (keys.length === 0) return {};
    const rows = await this.db.db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(inArray(settings.key, keys));
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async set(item: SettingItem, userId?: number) {
    await this.db.db
      .insert(settings)
      .values({
        key: item.key,
        value: item.value as never,
        group: item.group ?? 'general',
        label: item.label ?? '',
        description: item.description ?? '',
        valueType: item.valueType ?? this.inferType(item.value),
        isPublic: item.isPublic ?? false,
        updatedBy: userId ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          value: item.value as never,
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
    return { key: item.key, value: item.value };
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
    { key: 'hospital.shortName', value: 'BVQY4', group: 'hospital', label: 'Tên viết tắt', isPublic: true },
    { key: 'hospital.address', value: '', group: 'hospital', label: 'Địa chỉ', isPublic: true },
    { key: 'hospital.phone', value: '', group: 'hospital', label: 'Điện thoại', isPublic: true },
    { key: 'hospital.website', value: '', group: 'hospital', label: 'Website', isPublic: true },
    { key: 'hospital.logo', value: '', group: 'hospital', label: 'Logo (đường dẫn)', isPublic: true },
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

    // Kiosk phòng khám & Điểm danh
    {
      key: 'kiosk.itMasterPin',
      value: '999888',
      group: 'kiosk',
      label: 'Mã PIN IT mở khoá Kiosk khẩn cấp',
      description: 'Mã PIN khẩn cấp mở khoá tại chỗ màn hình Kiosk phòng khám khi có sự cố kỹ thuật hoặc mất mạng',
      valueType: 'string',
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

    // Hệ thống
    { key: 'system.sessionHours', value: 12, group: 'system', label: 'Thời gian phiên đăng nhập (giờ)', valueType: 'number' },
    { key: 'system.passwordMinLength', value: 6, group: 'system', label: 'Độ dài mật khẩu tối thiểu', valueType: 'number', isPublic: true },
    { key: 'system.maintenanceMode', value: false, group: 'system', label: 'Chế độ bảo trì', valueType: 'boolean' },
    { key: 'system.maintenanceMessage', value: 'Hệ thống đang bảo trì, vui lòng quay lại sau.', group: 'system', label: 'Thông báo bảo trì', isPublic: true },
    { key: 'system.dashboardNotice', value: '', group: 'system', label: 'Thông báo trên trang chủ', isPublic: true },
  ];
}
