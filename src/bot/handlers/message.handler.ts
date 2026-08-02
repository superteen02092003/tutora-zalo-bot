import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentClientService } from '../../agent/agent-client.service';
import {
  AgentChatContext,
  AgentChatResponseBody,
} from '../../agent/agent-client.types';
import { mapAgentTutorsToCandidates } from '../../agent/tutor-mapper.util';
import { MiniAppButtonService } from '../../mini-app/mini-app-button.service';
import { ZaloWebhookEvent } from '../../webhook/zalo-event.dto';
import { getMessageText, getZaloUserId } from '../../webhook/zalo-event.utils';
import { ZaloService } from '../../zalo/zalo.service';
import { ConversationContext } from '../state/conversation-context.interface';
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

// Giữ 10 lượt gần nhất (20 message) gửi cho /api/v1/agent mỗi lần — agent stateless, KHÔNG
// tự cắt history phía nó (xem agent.py:471-477), nên cap ở đây để tránh Redis phình to +
// history quá dài khiến LLM lẫn lộn chủ đề cũ/mới.
const MAX_AGENT_HISTORY = 20;
// Khớp _MAX_CARDS_SHOWN bên tutora-ai (agent.py) — số card gia sư thực render trên Zalo.
const MAX_TUTOR_CARDS = 3;

/**
 * MATCHING THẬT (search có AI ranking) chỉ diễn ra trong Mini App (xem MiniAppSearchFlow) —
 * chatbot KHÔNG tự parse tiêu chí tìm gia sư từ chat để search hộ. Nhưng tin nhắn tự do vẫn
 * cần LLM trả lời tự nhiên (hỏi thăm, tư vấn, làm rõ nhu cầu...) thay vì luôn chỉ bắn nút mở
 * Mini App — nên mọi tin nhắn text đi qua agent (/api/v1/agent, channel="zalo"), và LLM tự
 * quyết định khi nào cần mở Mini App (reopen_mini_app/reopen_mini_app_fresh) thay vì
 * NestJS áp đặt cứng như trước 2026-07-19.
 */
@Injectable()
export class MessageHandler {
  private readonly logger = new Logger(MessageHandler.name);
  private readonly adminUserIds: Set<string>;

  constructor(
    private readonly state: ConversationStateService,
    private readonly zalo: ZaloService,
    private readonly miniAppButton: MiniAppButtonService,
    private readonly agentClient: AgentClientService,
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

    if (!text) {
      // Ảnh/sticker/không có text — agent chỉ xử lý được text, mở thẳng Mini App như cũ.
      await this.miniAppButton.sendSearchButton(
        userId,
        currentPreferredLanguage,
      );
      return;
    }

    await this.chatWithAgent(userId, text, currentPreferredLanguage, context);
  }

  private async chatWithAgent(
    userId: string,
    text: string,
    lang: 'vi' | 'en',
    context: ConversationContext,
  ): Promise<void> {
    const history = context.chatHistory ?? [];
    const agentContext: AgentChatContext = {
      ...(context.agentCtx as AgentChatContext | undefined),
      preferred_language: lang,
    };

    let response: AgentChatResponseBody;
    try {
      response = await this.agentClient.chat({
        history,
        message: text,
        channel: 'zalo',
        context: agentContext,
        shown_tutors: context.shownTutors ?? [],
      });
    } catch (error) {
      // Đừng để PH im lặng khi agent lỗi/timeout — fallback mở thẳng Mini App (hành vi cũ).
      this.logger.error(`Agent chat lỗi cho user=${userId}: ${String(error)}`);
      await this.miniAppButton.sendSearchButton(userId, lang);
      return;
    }

    if (response.suggestions.length > 0) {
      await this.zalo.sendQuickReply(
        userId,
        response.reply,
        response.suggestions.map((label) => ({ title: label, payload: label })),
      );
    } else {
      await this.zalo.sendText(userId, response.reply);
    }

    if (response.tutors.length > 0) {
      const candidates = mapAgentTutorsToCandidates(
        response.tutors.slice(0, MAX_TUTOR_CARDS),
      );
      for (const tutor of candidates) {
        await this.zalo.sendTutorCard(
          userId,
          tutor,
          this.miniAppButton.buildTutorDetailLink(tutor.tutorId),
          this.miniAppButton.buildTutorDetailLink(tutor.tutorId, true),
          lang,
        );
      }
    }

    if (response.reopen_mini_app || response.reopen_mini_app_fresh) {
      await this.miniAppButton.sendSearchButton(
        userId,
        lang,
        response.reopen_mini_app_fresh,
      );
    }

    const nextHistory = [
      ...history,
      { role: 'user' as const, content: text },
      { role: 'assistant' as const, content: response.reply },
    ].slice(-MAX_AGENT_HISTORY);

    const nextShownTutors = response.tutors.length
      ? response.tutors.map((t) => ({ tutor_id: t.tutorId, name: t.fullName }))
      : context.shownTutors;

    await this.state.updateContext(userId, {
      chatHistory: nextHistory,
      shownTutors: nextShownTutors,
      agentCtx: {
        ...(context.agentCtx ?? {}),
        ...(response.context_patch ?? {}),
      },
    });
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
