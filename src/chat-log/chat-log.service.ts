import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { ZaloWebhookEvent } from '../webhook/zalo-event.dto';

export type ChatDirection = 'in' | 'out';

/** user_send_* = khách nhắn vào OA; oa_send_* = OA gửi ra (bot qua API hoặc nhân viên trả lời
 * tay trên trang quản lý OA — Zalo bắn webhook cho cả hai). user_received_message /
 * user_seen_message chỉ là trạng thái đã nhận/đã xem, không phải tin nhắn, nên bỏ qua. */
export function getChatDirection(eventName: string): ChatDirection | null {
  if (eventName.startsWith('user_send_')) return 'in';
  if (eventName.startsWith('oa_send_')) return 'out';
  return null;
}

/**
 * Ghi toàn bộ tin nhắn OA (2 chiều) vào bảng zalo_chat_messages (Supabase Postgres, xem
 * db/migrations) để agent đọc phân tích sau này. Không set DATABASE_URL (local/stub) → chỉ
 * log cảnh báo 1 lần và bỏ qua, không làm hỏng xử lý webhook.
 */
@Injectable()
export class ChatLogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatLogService.name);
  private pool?: Pool;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const connectionString = this.config.get<string>('database.url');
    if (!connectionString) {
      this.logger.warn('DATABASE_URL chưa set — không lưu lịch sử chat OA.');
      return;
    }
    this.pool = new Pool({
      connectionString,
      // Supabase bắt buộc SSL nhưng cert ký bởi CA riêng của Supabase.
      ssl: this.config.get<boolean>('database.ssl', true)
        ? { rejectUnauthorized: false }
        : false,
      max: 3,
    });
    this.pool.on('error', (error) =>
      this.logger.error(`Postgres pool lỗi: ${String(error)}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  async record(event: ZaloWebhookEvent): Promise<void> {
    const eventName = event.event_name ?? event.eventName ?? '';
    const direction = getChatDirection(eventName);
    if (!direction || !this.pool) return;

    const zaloUserId =
      direction === 'in' ? event.sender?.id : event.recipient?.id;
    if (!zaloUserId) {
      this.logger.warn(`Tin ${eventName} thiếu user id, không lưu được.`);
      return;
    }

    const timestamp = Number(event.timestamp);
    const sentAt = Number.isFinite(timestamp)
      ? new Date(timestamp)
      : new Date();

    try {
      await this.pool.query(
        `insert into public.zalo_chat_messages
           (msg_id, zalo_user_id, direction, event_name, text, attachments, raw, sent_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (msg_id) do nothing`,
        [
          event.message?.msg_id ?? null,
          zaloUserId,
          direction,
          eventName,
          event.message?.text ?? null,
          event.message?.attachments
            ? JSON.stringify(event.message.attachments)
            : null,
          JSON.stringify(event),
          sentAt,
        ],
      );
    } catch (error) {
      this.logger.error(
        `Lưu tin ${eventName} user=${zaloUserId} lỗi: ${String(error)}`,
      );
    }
  }
}
