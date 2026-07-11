import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentClientService } from '../../agent/agent-client.service';
import { AgentResponseBody, AgentTutorItem } from '../../agent/agent-client.types';
import { TutorCandidateDto, TutorSubscriptionType } from '../../be-client/dto';
import { ZaloService } from '../../zalo/zalo.service';
import { ChatMessage, ConversationContext } from '../state/conversation-context.interface';
import { ConversationState } from '../state/conversation-state.enum';
import { ConversationStateService } from '../state/conversation-state.service';

// Khớp _MAX_CARDS_SHOWN = 3 bên FastAPI agent (tutora-ai) — top 3 theo 3 tier.
const MAX_CARDS = 3;
const TIER_BY_PRICE_RANK: TutorSubscriptionType[] = ['standard', 'pro', 'premium'];

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
    config: ConfigService,
  ) {
    this.tutorProfileBaseUrl = config.get<string>(
      'tutorProfileBaseUrl',
      'https://tutora.vn/gia-su',
    );
  }

  async handle(userId: string, text: string): Promise<void> {
    const context = await this.state.getContext(userId);
    const lang = context.preferredLanguage ?? 'vi';

    let res: AgentResponseBody;
    try {
      res = await this.agentClient.chat({
        history: context.chatHistory ?? [],
        message: text,
        channel: 'zalo',
        context: context.agentCtx ?? {},
        shown_tutors: context.agentShownTutors ?? [],
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
    if (res.context_patch) {
      const agentCtx: Record<string, unknown> = { ...(context.agentCtx ?? {}) };
      for (const [key, value] of Object.entries(res.context_patch)) {
        if (value !== null && value !== undefined) agentCtx[key] = value;
      }
      updates.agentCtx = agentCtx;
    }

    // Reply (kèm suggestions dạng danh sách đánh số nếu agent trả nút gợi ý).
    if (res.reply) {
      if (res.suggestions?.length) {
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
      const mapped = this.toCandidates(res.tutors.slice(0, MAX_CARDS));
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
    history.push({ role: 'user', content: text });
    if (res.reply) history.push({ role: 'assistant', content: res.reply });
    updates.chatHistory = history.slice(-20);

    await this.state.updateContext(userId, updates);
  }

  /**
   * Map TutorRecommendItem (.NET, qua agent) → TutorCandidateDto (card render).
   * Card image gọi KHÔNG guard các field: fullName, averageRating, totalReviews,
   * completedHours, teachingMode, hourlyRate — phải luôn non-null.
   */
  private toCandidates(items: AgentTutorItem[]): TutorCandidateDto[] {
    // TODO: thay bằng tier chính thức từ BE khi có (tutora-ai/agents/agentscenarios.md
    // KB-A — công thức tier phải deterministic ở BE/Ranking Core, đây chỉ là heuristic
    // tạm cho demo: xếp theo giá trong chính nhóm hiển thị).
    const priceRank = new Map<string, number>(
      [...items]
        .sort((a, b) => (a.pricePerHour ?? 0) - (b.pricePerHour ?? 0))
        .map((item, i) => [item.tutorId, i]),
    );

    return items.map((item) => {
      const mode = (item.teachingMode ?? '').toLowerCase();
      const tier: TutorSubscriptionType =
        item.pricePerHour == null
          ? 'standard'
          : (TIER_BY_PRICE_RANK[priceRank.get(item.tutorId) ?? 0] ?? 'standard');
      return {
        tutorId: item.tutorId,
        fullName: item.fullName,
        avatarUrl: item.avatarUrl ?? undefined,
        bio: item.headline ?? undefined,
        subjects: item.subjects ?? undefined,
        hourlyRate: item.pricePerHour ?? 0,
        averageRating: item.averageRating ?? 0,
        totalReviews: item.totalReviews ?? 0,
        completedHours: item.completedHours ?? 0,
        subscriptionType: tier,
        teachingMode: mode === 'online' || mode === 'offline' ? mode : 'both',
        teachingAreaCity: item.teachingAreaCity ?? undefined,
        teachingAreaDistrict: item.teachingAreaDistrict ?? undefined,
      };
    });
  }
}
