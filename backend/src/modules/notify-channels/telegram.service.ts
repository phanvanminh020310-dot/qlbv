/**
 * Kênh Telegram — gửi thông báo tức thời đến điện thoại Người dùng, hoàn toàn miễn phí.
 *
 * Thiết kế:
 *  - Bật/tắt + Bot Token nằm trong Cấu hình hệ thống (nhóm Thông báo).
 *  - Người dùng tự liên kết một lần: trang Cá nhân sinh mã → mở bot gởi `/start <mã>`
 *    → hệ thống ghi `telegram_chat_id` vào hồ sơ Người dùng.
 *  - Máy chủ LAN không có địa chỉ công khai nên KHÔNG dùng webhook; thay vào đó
 *    long-polling `getUpdates` chạy ngay trong tiến trình API (đi ra ngoài là được,
 *    tường lửa không chặn). OFFSET được lưu vào bảng settings để khởi động lại
 *    không nhận lặp tin cũ.
 */
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { users } from '../../db/schema';
import { SettingsService } from '../settings/settings.service';

const TG_API = 'https://api.telegram.org';
const OFFSET_KEY = 'telegram.updateOffset';
const POLL_INTERVAL_MS = 3_000;
const LINK_CODE_TTL_MS = 10 * 60_000;
const LONG_POLL_TIMEOUT = 25; // giây — phía Telegram giữ kết nối chờ tin mới

export interface TgUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat?: { id: number; type?: string };
    from?: { id: number; username?: string; first_name?: string };
    /** Danh thiếp do người dùng bấm nút "Chia sẻ số điện thoại" gửi lên */
    contact?: { phone_number?: string; user_id?: number; first_name?: string };
  };
}

/**
 * Chuẩn hoá số điện thoại Việt Nam để so khớp: bỏ ký tự không phải số,
 * đổi tiền tố quốc tế 84 → 0. Trả về chuỗi rỗng nếu không đủ 9 số.
 */
export function normalizeVnPhone(raw: string | null | undefined): string {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('0084')) digits = digits.slice(4);
  else if (digits.startsWith('84') && digits.length >= 11) digits = digits.slice(2);
  if (!digits.startsWith('0')) digits = `0${digits}`;
  return digits.length >= 10 ? digits : '';
}

const SHARE_PHONE_KEYBOARD = {
  keyboard: [[{ text: '📱 Chia sẻ số điện thoại để liên kết', request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

interface LinkCode {
  userId: number;
  username: string;
  expiresAt: number;
}

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private botUsername = '';
  /** Mã liên kết tạm thời trong bộ nhớ (10 phút, một tiến trình API) */
  private readonly linkCodes = new Map<string, LinkCode>();

  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit(): void {
    this.scheduleNext(2_000); // chờ migrate/khởi động xong
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  /* ------------------------------------------------------------------ cấu hình */

  private async config(): Promise<{ enabled: boolean; token: string }> {
    const map = await this.settings.getMany(['telegram.enabled', 'telegram.botToken']);
    return { enabled: map['telegram.enabled'] === true, token: String(map['telegram.botToken'] ?? '') };
  }

  /** Username bot (điền sau lần polling đầu tiên) — đồng bộ để dựng deep-link */
  getBotUsername(): string {
    return this.botUsername;
  }

  /* ------------------------------------------------------------ liên kết tài khoản */

  /** Sinh mã liên kết 6 ký tự chữ-số cho Người dùng đang đăng nhập. */
  createLinkCode(userId: number, username: string): { code: string; expiresAt: Date } {
    // Huỷ mã cũ của cùng Người dùng
    for (const [k, v] of this.linkCodes) if (v.userId === userId) this.linkCodes.delete(k);
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
    this.linkCodes.set(code, { userId, username, expiresAt: expiresAt.getTime() });
    return { code, expiresAt };
  }

  /** Trạng thái liên kết hiện tại của một Người dùng. */
  async statusOf(userId: number): Promise<{ enabled: boolean; botUsername: string; linked: boolean; linkByPhone: boolean; hasPhone: boolean }> {
    const { enabled, token } = await this.config();
    const [row] = await this.db.db
      .select({ chatId: users.telegramChatId, phone: users.phone })
      .from(users)
      .where(eq(users.id, userId));
    const linkByPhone = (await this.settings.get<boolean>('telegram.linkByPhone', true)) !== false;
    return { enabled: enabled && !!token, botUsername: this.botUsername, linked: !!row?.chatId, linkByPhone, hasPhone: !!normalizeVnPhone(row?.phone) };
  }

  async unlink(userId: number): Promise<void> {
    await this.db.db.update(users).set({ telegramChatId: null }).where(eq(users.id, userId));
  }

  /* ------------------------------------------------------------------ gởi tin */

  /** Gửi tin cho một danh sách Người dùng (bỏ qua ai chưa liên kết). Trả về số tin đã gởi. */
  async sendToUsers(userIds: number[], text: string): Promise<number> {
    const { enabled, token } = await this.config();
    if (!enabled || !token || userIds.length === 0) return 0;
    const rows = await this.db.db
      .select({ id: users.id, chatId: users.telegramChatId })
      .from(users)
      .where(inArray(users.id, userIds));
    let sent = 0;
    for (const row of rows) {
      if (!row.chatId) continue;
      const ok = await this.api(token, 'sendMessage', {
        chat_id: row.chatId,
        text,
        disable_web_page_preview: true,
      });
      if (ok) sent += 1;
    }
    if (sent > 0) this.logger.log(`Đã gởi ${sent} tin Telegram`);
    return sent;
  }

  private async api(token: string, method: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), LONG_POLL_TIMEOUT * 1000 + 5_000);
      const res = await fetch(`${TG_API}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
      if (!res.ok || !data?.ok) {
        this.logger.warn(`Telegram ${method} lỗi ${res.status}: ${data?.description ?? 'không rõ'}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(`Telegram ${method} không gọi được: ${(err as Error).message}`);
      return false;
    }
  }

  /* --------------------------------------------------------------- long polling */

  private scheduleNext(delay = POLL_INTERVAL_MS): void {
    this.timer = setTimeout(() => {
      void this.pollOnce()
        .catch((err) => this.logger.warn(`Polling Telegram lỗi: ${(err as Error).message}`))
        .finally(() => this.scheduleNext());
    }, delay);
  }

  private async pollOnce(): Promise<void> {
    if (this.inFlight) return;
    const { enabled, token } = await this.config();
    if (!enabled || !token) return;
    this.inFlight = true;
    try {
      // Xác định username bot (một lần) để dựng https://t.me/<bot>?start=
      if (!this.botUsername) {
        const me = await this.apiGet<{ result?: { username?: string } }>(token, 'getMe');
        const name = me?.result?.username;
        if (name) {
          this.botUsername = name;
          this.logger.log(`Kết nối Telegram Bot @${name} thành công`);
        } else {
          return; // token chưa đúng — thử lại chu kỳ sau
        }
      }
      const offset = await this.readOffset();
      const data = await this.apiGet<{ result?: TgUpdate[] }>(token, `getUpdates?offset=${offset}&timeout=${LONG_POLL_TIMEOUT}&allowed_updates=["message"]`);
      const updates = data?.result ?? [];
      let maxId = offset ? offset - 1 : 0;
      for (const up of updates) {
        maxId = Math.max(maxId, up.update_id);
        await this.handleUpdate(up, token);
      }
      if (maxId >= offset) await this.writeOffset(maxId + 1);
    } finally {
      this.inFlight = false;
    }
  }

  private async apiGet<T>(token: string, path: string): Promise<T | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), (LONG_POLL_TIMEOUT + 10) * 1000);
      const res = await fetch(`${TG_API}/bot${token}/${path}`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null; // mạng chập chờn — chu kỳ sau gọi lại
    }
  }

  private async handleUpdate(up: TgUpdate, token: string): Promise<void> {
    const chatId = up.message?.chat?.id;
    const text = up.message?.text?.trim() ?? '';
    if (!chatId) return;
    if (up.message?.contact) {
      await this.linkByContact(up, token);
      return;
    }
    const linkByPhone = (await this.settings.get<boolean>('telegram.linkByPhone', true)) !== false;
    if (!text.startsWith('/start')) {
      if (linkByPhone && up.message?.chat?.type === 'private' && /^\/(lienket|link|phone)\b/i.test(text)) {
        await this.askForContact(token, chatId);
      }
      return;
    }
    const code = text.replace('/start', '').trim().toUpperCase();
    if (!code) {
      if (linkByPhone) {
        await this.askForContact(token, chatId);
        return;
      }
      await this.api(token, 'sendMessage', {
        chat_id: chatId,
        text: 'Chào bạn! Để nhận thông báo từ hệ thống QLBS, vào trang Cá nhân trong phần mềm, bấm "Tạo mã liên kết Telegram", rồi gởi: /start <MÃ>',
      });
      return;
    }
    // Dọn mã hết hạn
    const now = Date.now();
    for (const [k, v] of this.linkCodes) if (v.expiresAt < now) this.linkCodes.delete(k);
    const link = this.linkCodes.get(code);
    if (!link) {
      await this.api(token, 'sendMessage', {
        chat_id: chatId,
        text: `Mã ${code} không đúng hoặc đã hết hạn. Vào trang Cá nhân tạo mã mới rồi thử lại nhé.`,
      });
      return;
    }
    this.linkCodes.delete(code);
    await this.db.db
      .update(users)
      .set({ telegramChatId: String(chatId) })
      .where(eq(users.id, link.userId));
    await this.api(token, 'sendMessage', {
      chat_id: chatId,
      text: `Liên kết thành công với tài khoản "${link.username}". Từ nay thông báo ký/duyệt phiếu sẽ được gởi tức thời về đây.`,
    });
    this.logger.log(`Người dùng ${link.username} (#${link.userId}) đã liên kết Telegram ${chatId}`);
  }

  /* --------------------------------------------- liên kết bằng số điện thoại */

  private async askForContact(token: string, chatId: number): Promise<void> {
    await this.api(token, 'sendMessage', {
      chat_id: chatId,
      text:
        'Chào bạn! Bấm nút "📱 Chia sẻ số điện thoại để liên kết" bên dưới. Nếu số điện thoại trùng với số đã khai báo trong hồ sơ người dùng của phần mềm, tài khoản sẽ được liên kết để nhận thông báo công việc và ký duyệt.\n\nHoặc vào trang Cá nhân → "Tạo mã liên kết Telegram" rồi gởi: /start <MÃ>',
      reply_markup: SHARE_PHONE_KEYBOARD,
    });
  }

  /** Người dùng bấm "Chia sẻ số điện thoại": chỉ chấp nhận số của chính họ và khớp đúng một tài khoản. */
  async linkByContact(up: TgUpdate, token: string): Promise<'linked' | 'not-own' | 'not-found' | 'ambiguous' | 'disabled'> {
    const chatId = up.message?.chat?.id;
    const contact = up.message?.contact;
    if (!chatId || !contact) return 'not-found';
    const reply = (text: string) => this.api(token, 'sendMessage', { chat_id: chatId, text, reply_markup: { remove_keyboard: true } });
    if ((await this.settings.get<boolean>('telegram.linkByPhone', true)) === false) {
      await reply('Hệ thống chưa bật liên kết bằng số điện thoại. Vào trang Cá nhân để tạo mã liên kết.');
      return 'disabled';
    }
    // Chặn chia sẻ danh thiếp của người khác để chiếm thông báo
    if (!contact.user_id || contact.user_id !== up.message?.from?.id) {
      await reply('Vui lòng dùng nút "Chia sẻ số điện thoại" để gởi số điện thoại của chính bạn.');
      return 'not-own';
    }
    const phone = normalizeVnPhone(contact.phone_number);
    if (!phone) {
      await reply('Số điện thoại không hợp lệ.');
      return 'not-found';
    }
    const tail = phone.slice(-9);
    const candidates = await this.db.db
      .select({ id: users.id, username: users.username, phone: users.phone })
      .from(users)
      .where(and(eq(users.active, true), isNull(users.deletedAt), sql`right(regexp_replace(${users.phone}, '[^0-9]', '', 'g'), 9) = ${tail}`));
    const matched = candidates.filter((row) => normalizeVnPhone(row.phone) === phone);
    if (matched.length === 0) {
      await reply('Không tìm thấy tài khoản có số điện thoại này. Hãy nhờ quản trị cập nhật số điện thoại trong hồ sơ người dùng, hoặc dùng mã liên kết ở trang Cá nhân.');
      return 'not-found';
    }
    if (matched.length > 1) {
      await reply('Số điện thoại này đang khai báo cho nhiều tài khoản. Vui lòng dùng mã liên kết ở trang Cá nhân.');
      return 'ambiguous';
    }
    const [target] = matched;
    await this.db.db.update(users).set({ telegramChatId: String(chatId) }).where(eq(users.id, target!.id));
    await reply(`Liên kết thành công với tài khoản "${target!.username}". Từ nay thông báo công việc, ký/duyệt phiếu sẽ được gởi tức thời về đây.`);
    this.logger.log(`Người dùng ${target!.username} (#${target!.id}) đã liên kết Telegram ${chatId} bằng số điện thoại`);
    return 'linked';
  }

  /* ------------------------------------------------- lưu offset vào bảng settings */

  private async readOffset(): Promise<number> {
    return Number(await this.settings.get<number>(OFFSET_KEY, 0)) || 0;
  }

  private async writeOffset(offset: number): Promise<void> {
    await this.settings.set({
      key: OFFSET_KEY,
      value: offset,
      group: 'notification',
      label: 'Telegram polling offset (tự động)',
      valueType: 'number',
    });
  }
}
