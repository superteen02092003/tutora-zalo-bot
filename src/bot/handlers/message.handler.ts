import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MiniAppButtonService } from '../../mini-app/mini-app-button.service';
import { ZaloWebhookEvent } from '../../webhook/zalo-event.dto';
import { getMessageText, getZaloUserId } from '../../webhook/zalo-event.utils';
import { ZaloService } from '../../zalo/zalo.service';
import { ConversationStateService } from '../state/conversation-state.service';

/** null = tin nhắn không mang tín hiệu ngôn ngữ rõ ràng (giữ nguyên preferredLanguage cũ). */
function detectLanguage(text: string): 'vi' | 'en' | null {
  if (
    /[àáâãèéêìíòóôõùúăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(
      text,
    )
  ) {
    return 'vi';
  }
  return /[a-z]{2,}/i.test(text) ? 'en' : null;
}

/**
 * Chatbot chỉ còn vai trò ĐIỀU HƯỚNG — mọi tin nhắn (trigger hay tự do) đều dẫn thẳng tới
 * nút mở Mini App form filter, KHÔNG còn AI matching qua chat/LLM (AgentMatchingFlow +
 * chatHistory/sessionMemory/welcome-back đã bỏ hẳn 2026-07-19 — nguồn gây "loạn dữ liệu
 * cũ" mỗi khi PH muốn tìm gia sư khác, vì agent giữ ngữ cảnh hội thoại qua nhiều lượt).
 * Tìm kiếm thật (có AI ranking) diễn ra hoàn toàn trong Mini App, xem MiniAppSearchFlow.
 */
@Injectable()
export class MessageHandler {
  private readonly logger = new Logger(MessageHandler.name);
  private readonly adminUserIds: Set<string>;

  constructor(
    private readonly state: ConversationStateService,
    private readonly zalo: ZaloService,
    private readonly miniAppButton: MiniAppButtonService,
    config: ConfigService,
  ) {
    this.adminUserIds = new Set(config.get<string[]>('adminZaloUserIds') ?? []);
  }

  async handle(event: ZaloWebhookEvent): Promise<void> {
    const userId = getZaloUserId(event);
    if (!userId) {
      this.logger.warn(
        `Message event missing sender id: ${JSON.stringify(event)}`,
      );
      return;
    }

    const text = getMessageText(event);
    this.logger.debug(`Message | user=${userId} | text="${text}"`);

    const context = await this.state.getContext(userId);
    if (context.botChatDisabled) return;

    if (this.adminUserIds.has(userId)) {
      const handled = await this.handleAdminCommand(userId, text);
      if (handled) return;
    }

    let currentPreferredLanguage = context.preferredLanguage ?? 'vi';
    if (text && !text.startsWith('#')) {
      const detectedLang = detectLanguage(text);
      if (detectedLang) {
        currentPreferredLanguage = detectedLang;
        if (detectedLang !== context.preferredLanguage) {
          await this.state.updateContext(userId, {
            preferredLanguage: detectedLang,
          });
        }
      }
    }

    // Mọi tin nhắn (trigger hay tự do) đều mở nút Mini App form — chatbot không còn tự
    // diễn giải nội dung tin nhắn để search hộ.
    await this.miniAppButton.sendSearchButton(userId, currentPreferredLanguage);
  }

  private async handleAdminCommand(
    adminId: string,
    text: string,
  ): Promise<boolean> {
    const match = text.match(/^\/botchat\s+(on|off)\s+(\S+)$/i);
    if (!match) return false;
    const [, action, targetUserId] = match;
    const disabled = action.toLowerCase() === 'off';
    await this.state.updateContext(targetUserId, { botChatDisabled: disabled });
    await this.zalo.sendText(
      adminId,
      `BotChat cho user ${targetUserId} đã được ${disabled ? 'TẮT' : 'BẬT'}.`,
    );
    return true;
  }
}
