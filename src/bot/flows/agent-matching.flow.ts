import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentClientService } from '../../agent/agent-client.service';
import { AgentResponseBody } from '../../agent/agent-client.types';
import { mapAgentTutorsToCandidates, MAX_CARDS } from '../../agent/tutor-mapper.util';
import { MiniAppButtonService } from '../../mini-app/mini-app-button.service';
import { ZaloService } from '../../zalo/zalo.service';
import { ChatMessage, ConversationContext } from '../state/conversation-context.interface';
import { ConversationState } from '../state/conversation-state.enum';
import { ConversationStateService } from '../state/conversation-state.service';

/**
 * AI matching qua FastAPI agent (tutora-ai) — thay llm-router + onboarding nút bấm cho
 * giai đoạn matching khi cờ aiMatching.enabled bật.
 *
 * Bot chỉ làm việc "tay chân" deterministic: giữ state (Redis), render card, nút booking.
 * Toàn bộ hiểu ý + hỏi slot + quyết định search nằm bên agent (xem
 * tutora-ai/agents/agentscenarios.md — nguồn chân lý hành vi).
 */
@Injectable()
export class AgentMatchingFlow {
  private readonly logger = new Logger(AgentMatchingFlow.name);
  private readonly tutorProfileBaseUrl: string;

  constructor(
    private readonly agentClient: AgentClientService,
    private readonly state: ConversationStateService,
    private readonly zalo: ZaloService,
    private readonly miniAppButton: MiniAppButtonService,
    config: ConfigService,
  ) {
    this.tutorProfileBaseUrl = config.get<string>(
      'tutorProfileBaseUrl',
      'https://tutora.vn/gia-su',
    );
  }

  async handle(userId: string, text: string): Promise<void> {
    await this.runTurn(userId, text);
  }

  /**
   * Lõi dùng chung: gọi agent + xử lý reply/card/state. `agentCtxOverride` cho phép nguồn
   * KHÁC chat (vd Mini App form submit — src/bot/flows/mini-app-search.flow.ts) bơm sẵn
   * slot đầy đủ (subject_id/grade_level_id/goal/... + asked_preferences=true) để agent
   * Python nhảy thẳng vào search, bỏ qua toàn bộ câu hỏi — tái dùng 100% pipeline
   * search/tier/card/chống bịa đã có, không viết lại gì.
   *
   * `shownTutorsOverride`: mặc định lấy context.agentShownTutors (gia sư đã gợi ý phiên
   * trước). Mini App form submit truyền [] tường minh — form mới = tiêu chí có thể khác
   * hẳn, không nên còn "đã gợi ý" từ lần tìm trước đó, KHÔNG thì agent Python sẽ tưởng PH
   * "đã được giới thiệu gia sư" và hỏi lại disambiguation "đổi gia sư khác/nhu cầu khác"
   * (tutora-ai/app/services/agent.py _handle_find_tutor) dù PH VỪA quyết định qua form rồi.
   */
  async runTurn(
    userId: string,
    message: string,
    agentCtxOverride?: Record<string, unknown>,
    shownTutorsOverride?: ConversationContext['agentShownTutors'],
  ): Promise<void> {
    const context = await this.state.getContext(userId);
    const lang = context.preferredLanguage ?? 'vi';
    const agentCtx = agentCtxOverride ?? context.agentCtx ?? {};
    const shownTutors = shownTutorsOverride ?? context.agentShownTutors ?? [];

    let res: AgentResponseBody;
    try {
      res = await this.agentClient.chat({
        history: context.chatHistory ?? [],
        message,
        channel: 'zalo',
        // preferred_language: chỉ định TƯỜNG MINH cho agent Python (không chỉ suy luận từ
        // tin nhắn cuối — không đủ mạnh khi task nội bộ dài toàn tiếng Việt, xem
        // tutora-ai/app/services/agent.py _say()). Không persist vào agentCtx state, chỉ
        // gửi kèm request — luôn lấy tươi từ context.preferredLanguage mỗi lượt.
        context: { ...agentCtx, preferred_language: lang },
        shown_tutors: shownTutors,
      });
    } catch (error) {
      this.logger.error(`Agent call failed for ${userId}: ${String(error)}`);
      await this.zalo.sendText(
        userId,
        lang === 'en'
          ? 'Sorry, I hit a hiccup. Please try again in a moment!'
          : 'Dạ em đang gặp chút trục trặc, anh/chị thử lại giúp em sau ít phút nhé!',
      );
      return;
    }

    const updates: Partial<ConversationContext> = {};

    // Merge context_patch GENERIC: mọi key non-null đè vào agentCtx. Python thêm slot
    // mới (vd asked_preferences) → bot tự persist, không phải sửa code ở đây.
    {
      const merged: Record<string, unknown> = { ...agentCtx };
      if (res.context_patch) {
        for (const [key, value] of Object.entries(res.context_patch)) {
          if (value !== null && value !== undefined) merged[key] = value;
        }
      }
      updates.agentCtx = merged;
    }

    // Reply (kèm suggestions dạng danh sách đánh số nếu agent trả nút gợi ý).
    if (res.reply) {
      if (res.reopen_mini_app) {
        // PH muốn đổi tiêu chí tìm gia sư -> gửi lại nút mở Mini App (điền sẵn dữ liệu cũ
        // từ agentCtx hiện có — xem MiniAppController prefill endpoint) thay vì hỏi qua
        // chat. res.reply là câu dẫn ngắn ("Dạ em gửi lại form...").
        await this.zalo.sendText(userId, res.reply);
        await this.miniAppButton.sendSearchButton(userId, lang, res.reopen_mini_app_fresh);
      } else if (res.suggestions?.length) {
        await this.zalo.sendNumberedList(
          userId,
          res.reply,
          res.suggestions.map((label) => ({ label })),
        );
      } else {
        await this.zalo.sendText(userId, res.reply);
      }
    }

    // Card gia sư: map shape .NET recommend → TutorCandidateDto rồi tái dùng toàn bộ
    // hạ tầng card + nút "Đặt lịch" (select_tutor:) + booking flow sẵn có.
    if (res.tutors?.length) {
      const mapped = mapAgentTutorsToCandidates(res.tutors.slice(0, MAX_CARDS));
      await this.state.setMatchingCandidates(userId, mapped);
      updates.agentShownTutors = mapped.map((c) => ({
        tutor_id: c.tutorId,
        name: c.fullName,
      }));
      for (const candidate of mapped) {
        await this.zalo.sendTutorCard(userId, candidate, this.tutorProfileBaseUrl, lang);
      }
      // setState trực tiếp (không transitionState): hội thoại AI không đi qua bước
      // Onboarding của state machine nút bấm — New → Matched là hợp lệ ở luồng agent.
      await this.state.setState(userId, ConversationState.Matched);
    }

    if (res.handoff_to_booking) {
      // Agent chỉ báo Ý ĐỊNH đặt lịch (không trả tutor được chọn). PH chốt bằng nút
      // "Đặt lịch" trên card → select_tutor: → booking flow deterministic tiếp quản.
      this.logger.log(`Agent handoff_to_booking for ${userId} — awaiting card tap`);
    }

    // Append history (bản đã có updates ở trên chưa persist — đọc từ context gốc).
    const history: ChatMessage[] = [...(context.chatHistory ?? [])];
    history.push({ role: 'user', content: message });
    if (res.reply) history.push({ role: 'assistant', content: res.reply });
    updates.chatHistory = history.slice(-20);

    await this.state.updateContext(userId, updates);
  }
}
