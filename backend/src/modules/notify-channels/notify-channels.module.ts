/**
 * Bộ phận gởi thông báo ra các KÊNH NGOÀI (Telegram — miễn phí).
 *
 * Thông báo trong ứng dụng (chuông 🔔) luôn chạy trước và độc lập; `NotifyDeliveryService`
 * chỉ phụ trách phát fan-out ra ngoài và TUYỆT ĐỐI không ném lỗi (mọi hỏng hóc của
 * kênh ngoài đều chỉ ghi log cảnh báo).
 */
import { Logger, Injectable, Module } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { SettingsModule } from '../settings/settings.module';
import { NotifyChannelsController } from './notify-channels.controller';
import { TelegramService } from './telegram.service';

export type NotifyEventKind =
  | 'hsba.nextStep'
  | 'hsba.returned'
  | 'hsba.completed'
  // Quản lý công việc
  | 'task.assigned'
  | 'task.statusChanged'
  | 'task.submitted'
  | 'task.approved'
  | 'task.returned'
  | 'task.cancelled'
  | 'task.mention'
  | 'task.dueSoon'
  | 'task.overdue'
  | 'project.memberAdded';

/** Nhãn liên kết trong tin nhắn ngoài theo loại sự kiện. */
export function externalLinkLabel(kind: NotifyEventKind): string {
  if (kind.startsWith('task.')) return 'Mở công việc';
  if (kind.startsWith('project.')) return 'Mở dự án';
  return 'Mở phiếu';
}

export interface ExternalNotifyPayload {
  kind: NotifyEventKind;
  title: string;
  body: string;
  /** Đường dẫn tương đối đến phiếu trong ứng dụng (vd /ho-so-benh-an/12) */
  link: string;
}

@Injectable()
export class NotifyDeliveryService {
  private readonly logger = new Logger(NotifyDeliveryService.name);

  constructor(
    private readonly telegram: TelegramService,
    private readonly settings: SettingsService,
  ) {}

  /** Fan-out thông báo của một sự kiện nghiệp vụ tới các kênh ngoài mà người nhận đã thiết lập. */
  async deliver(userIds: number[], payload: ExternalNotifyPayload): Promise<void> {
    try {
      if (userIds.length === 0) return;
      const appUrl = String((await this.settings.get<string>('notify.channel.appUrl', '')) ?? '').replace(/\/+$/, '');
      const lines = [`🔔 ${payload.title}`, payload.body];
      if (appUrl && payload.link) lines.push(`${externalLinkLabel(payload.kind)}: ${appUrl}${payload.link}`);
      const text = lines.filter(Boolean).join('\n');

      await this.telegram.sendToUsers(userIds, text);
    } catch (err) {
      this.logger.warn(`Gởi kênh ngoài lỗi (bỏ qua): ${(err as Error).message}`);
    }
  }
}

@Module({
  imports: [SettingsModule],
  controllers: [NotifyChannelsController],
  providers: [TelegramService, NotifyDeliveryService],
  exports: [NotifyDeliveryService, TelegramService],
})
export class NotifyChannelsModule {}
