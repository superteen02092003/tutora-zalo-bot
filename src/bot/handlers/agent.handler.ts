import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiClientService, AgentResponse } from '../../be-client/ai-client.service';
import { TutorCandidateDto } from '../../be-client/dto';
import { ZaloService } from '../../zalo/zalo.service';
import { ConversationContext } from '../state/conversation-context.interface';
import { ConversationStateService } from '../state/conversation-state.service';

const MAX_HISTORY = 10;        // giữ ~10 lượt gần nhất, tránh phình Redis + tốn token
const MAX_CARDS = 3;           // số card gia sư hiển thị mỗi lượt

/**
 * Xử lý hội thoại tự do qua agent tutora-ai (tìm gia sư / hỏi chi tiết / lịch / confirm).
 *
 * NestJS giữ ngữ cảnh (history + shown_tutors) trong Redis, agent stateless.
 * Agent KHÔNG tự đặt lịch: khi handoff_to_booking -> trả cờ để caller chuyển booking flow.
 */
@Injectable()
export class AgentHandler {
  private readonly logger = new Logger(AgentHandler.name);
  private readonly tutorProfileBaseUrl: string;

  constructor(
    private readonly ai: AiClientService,
    private readonly state: ConversationStateService,
    private readonly zalo: ZaloService,
    config: ConfigService,
  ) {
    this.tutorProfileBaseUrl = config.get<string>('tutorProfileBaseUrl', 'https://tutora.vn/gia-su');
  }

  /**
   * @returns 'booking' nếu agent xác nhận ý định đặt lịch (caller chuyển booking flow),
   *          ngược lại 'handled' (đã xử lý xong trong lượt này).
   */
  async handle(userId: string, text: string, context: ConversationContext): Promise<'handled' | 'booking'> {
    const lang = context.preferredLanguage ?? 'vi';

    const res = await this.ai.askAgent({
      message: text,
      channel: 'zalo',
      context: {
        subject_id: context.subjectId,
        teaching_mode: context.criteria?.teachingMode,
        city: context.criteria?.locationDistrict,
      },
      history: context.agentHistory ?? [],
      shown_tutors: context.agentShownTutors ?? [],
    });

    // AI lỗi/chưa cấu hình -> fallback graceful, KHÔNG để bot chết câm.
    if (!res) {
      await this.zalo.sendText(
        userId,
        lang === 'en'
          ? 'Sorry, the system is a bit busy. Please try again shortly.'
          : 'Xin lỗi, hệ thống đang hơi bận. Bạn nhắn lại giúp mình sau giây lát nhé!',
      );
      return 'handled';
    }

    // 1. Gửi câu trả lời chính
    if (res.reply) {
      await this.zalo.sendText(userId, res.reply);
    }

    // 2. Render card gia sư (nếu có) — dùng renderer sẵn có
    const tutors = (res.tutors as unknown as TutorCandidateDto[]) ?? [];
    if (tutors.length > 0) {
      // Lưu vào matching candidates để booking flow (handleTutorSelected) tra cứu được.
      await this.state.setMatchingCandidates(userId, tutors);
    }
    for (const tutor of tutors.slice(0, MAX_CARDS)) {
      try {
        await this.zalo.sendTutorCard(userId, tutor, this.tutorProfileBaseUrl, lang);
      } catch (e) {
        this.logger.warn(`sendTutorCard failed for ${tutor.tutorId}: ${String(e)}`);
      }
    }

    // 3. Nút xác nhận (đổi ngữ cảnh / booking) nếu agent hỏi confirm
    if (res.awaiting_confirmation && res.suggestions.length > 0) {
      await this.zalo.sendNumberedList(
        userId,
        lang === 'en' ? 'Please confirm:' : 'Bạn xác nhận giúp mình nhé:',
        res.suggestions.map((s) => ({ label: s })),
      );
    }

    // 4. Cập nhật state: history + shown_tutors + cờ chờ confirm
    const history = [
      ...(context.agentHistory ?? []),
      { role: 'user' as const, content: text },
      ...(res.reply ? [{ role: 'assistant' as const, content: res.reply }] : []),
    ].slice(-MAX_HISTORY);

    const shownTutors = tutors.length
      ? tutors.slice(0, MAX_CARDS).map((t) => ({ tutor_id: t.tutorId, name: t.fullName }))
      : context.agentShownTutors; // giữ list cũ nếu lượt này không search

    await this.state.updateContext(userId, {
      agentHistory: history,
      agentShownTutors: shownTutors,
      agentAwaitingConfirm: res.awaiting_confirmation ? res.confirm_type ?? undefined : undefined,
    });

    // 5. Bàn giao booking — caller (message.handler) sẽ chuyển booking flow.
    //    Chỉ handoff khi phụ huynh ĐÃ xác nhận (awaiting_confirmation=false + handoff=true),
    //    còn awaiting=true nghĩa là mới hỏi, chờ phụ huynh bấm nút trước.
    if (res.handoff_to_booking && !res.awaiting_confirmation) {
      return 'booking';
    }
    return 'handled';
  }
}
