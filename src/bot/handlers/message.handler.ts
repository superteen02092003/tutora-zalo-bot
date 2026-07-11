import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TutorCandidateDto } from '../../be-client/dto';
import { LlmRouterService } from '../../llm/llm-router.service';
import { RouterDecision } from '../../llm/llm-router.types';
import { ZaloWebhookEvent } from '../../webhook/zalo-event.dto';
import { getMessageText, getZaloUserId } from '../../webhook/zalo-event.utils';
import { ZaloService } from '../../zalo/zalo.service';
import { AgentMatchingFlow } from '../flows/agent-matching.flow';
import { OnboardingFlow } from '../flows/onboarding.flow';
import { ChatMessage, ConversationContext } from '../state/conversation-context.interface';
import { ConversationStateService } from '../state/conversation-state.service';

function detectLanguage(text: string): 'vi' | 'en' {
  return /[àáâãèéêìíòóôõùúăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(text)
    ? 'vi'
    : 'en';
}

// Direct triggers — bypass LLM hoàn toàn.
const FIND_TUTOR_TRIGGERS = ['#timgiasu', 'onboarding:start', 'tìm gia sư', 'tìm giasư'];

@Injectable()
export class MessageHandler {
  private readonly logger = new Logger(MessageHandler.name);
  private readonly adminUserIds: Set<string>;
  private readonly aiMatchingEnabled: boolean;

  constructor(
    private readonly state: ConversationStateService,
    private readonly zalo: ZaloService,
    private readonly llmRouter: LlmRouterService,
    private readonly onboardingFlow: OnboardingFlow,
    private readonly agentMatchingFlow: AgentMatchingFlow,
    config: ConfigService,
  ) {
    this.adminUserIds = new Set(config.get<string[]>('adminZaloUserIds') ?? []);
    this.aiMatchingEnabled = config.get<boolean>('aiMatching.enabled', false);
  }

  async handle(event: ZaloWebhookEvent): Promise<void> {
    const userId = getZaloUserId(event);
    if (!userId) {
      this.logger.warn(`Message event missing sender id: ${JSON.stringify(event)}`);
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

    // Auto-detect language from natural-language messages (skip commands/postbacks).
    if (text && !text.startsWith('#') && !text.startsWith('onboarding:') && !text.startsWith('select_tutor:')) {
      const detectedLang = detectLanguage(text);
      if (detectedLang !== context.preferredLanguage) {
        await this.state.updateContext(userId, { preferredLanguage: detectedLang });
      }
    }

    const candidates = await this.state.getMatchingCandidates<TutorCandidateDto>(userId);

    // ── AI MATCHING (feature flag): hội thoại giai đoạn matching qua FastAPI agent ──
    // Giữ nguyên đường cũ cho: postback onboarding:<slot> còn treo, nút select_tutor:
    // (booking entry), và các sub-flow booking/sau-booking (agent Python không xử lý
    // reschedule/cancel — xem tutora-ai/agents/agentscenarios.md mục 7).
    const isFindTrigger = FIND_TUTOR_TRIGGERS.includes(text.toLowerCase().trim());
    if (
      this.aiMatchingEnabled &&
      !text.startsWith('select_tutor:') &&
      (!text.startsWith('onboarding:') || text === 'onboarding:start') &&
      (isFindTrigger || !this.inBookingPhase(context))
    ) {
      // Trigger nút "tìm gia sư" → gửi vào agent như câu nói tự nhiên để agent mở màn
      // slot-filling (thay vì onboarding nút bấm từng bước).
      const message = isFindTrigger ? 'tìm gia sư' : text;
      await this.agentMatchingFlow.handle(userId, message);
      return;
    }

    if (isFindTrigger) {
      await this.onboardingFlow.start(userId);
      return;
    }

    // Structured payloads từ nút bấm (oa.query.hide) — route thẳng, không qua LLM.
    if (text.startsWith('onboarding:')) {
      await this.onboardingFlow.handlePostbackInput(userId, text);
      return;
    }
    if (text.startsWith('select_tutor:')) {
      const tutorId = text.slice('select_tutor:'.length);
      const updatedCtx = await this.state.getContext(userId);
      const tutor = candidates.find((c) => c.tutorId === tutorId);
      if (tutor) {
        await this.handleTutorSelected(userId, tutor, updatedCtx);
      } else {
        await this.zalo.sendText(
          userId,
          updatedCtx.preferredLanguage === 'en'
            ? "Couldn't find that tutor. Please select again."
            : 'Mình không tìm thấy gia sư này. Bạn thử chọn lại nhé?',
        );
      }
      return;
    }

    const convState = await this.state.getState(userId);
    const decision = await this.llmRouter.decide({ message: text, state: convState, context, candidates });
    this.logger.debug(`LLM decision | user=${userId} | ${JSON.stringify(decision)}`);

    const freshContext = await this.state.getContext(userId);
    await this.executeDecision(userId, decision, freshContext, candidates);

    if ('reply' in decision && decision.reply) {
      await this.appendChatHistory(userId, text, decision.reply);
    }
  }

  private async executeDecision(
    userId: string,
    decision: RouterDecision,
    context: ConversationContext,
    candidates: TutorCandidateDto[],
  ): Promise<void> {
    switch (decision.action) {
      case 'start_onboarding':
        await this.onboardingFlow.start(userId);
        break;

      case 'fill_slot':
        await this.onboardingFlow.applySlot(userId, decision.slot, decision.value);
        break;

      case 'bulk_fill_slots':
        await this.onboardingFlow.applyBulkSlots(userId, decision.slots);
        break;

      case 'select_tutor': {
        const tutor = candidates.find((c) =>
          c.fullName.toLowerCase().includes(decision.tutorName.toLowerCase()),
        );
        if (!tutor) {
          await this.zalo.sendText(
            userId,
            context.preferredLanguage === 'en'
              ? `Couldn't find tutor "${decision.tutorName}" in the list. Please select again.`
              : `Mình không tìm thấy gia sư "${decision.tutorName}" trong danh sách. Bạn chọn lại nhé?`,
          );
          return;
        }
        await this.handleTutorSelected(userId, tutor, context);
        break;
      }

      case 'select_package':
        await this.state.updateContext(userId, { selectedPackageSessionCount: decision.sessionCount });
        await this.zalo.sendNumberedList(
          userId,
          context.preferredLanguage === 'en'
            ? `Selected ${decision.sessionCount} sessions! How many sessions per week?`
            : `Đã chọn ${decision.sessionCount} buổi! Bạn muốn học mấy buổi mỗi tuần?`,
          context.preferredLanguage === 'en'
            ? [{ label: '2 sessions/week' }, { label: '3 sessions/week' }]
            : [{ label: '2 buổi/tuần' }, { label: '3 buổi/tuần' }],
        );
        break;

      case 'select_schedule': {
        const freshCtx = await this.state.updateContext(userId, {
          requiredSessionsPerWeek: decision.preset === 'twice_weekly' ? 2 : 3,
        });
        await this.zalo.sendText(
          userId,
          freshCtx.preferredLanguage === 'en'
            ? "Got it! Tutora's team will reach out to confirm your schedule and send payment details."
            : 'Tutora đã ghi nhận. Nhân viên Tutora sẽ liên hệ để xác nhận lịch và gửi thông tin thanh toán cho bạn sớm nhé!',
        );
        break;
      }

      case 'check_status':
        await this.zalo.sendText(userId, this.buildStatusMessage(context));
        break;

      case 'answer_question':
        await this.zalo.sendText(userId, decision.reply);
        break;

      case 'unknown':
      default:
        await this.zalo.sendText(
          userId,
          (decision as { reply?: string }).reply ??
            (context.preferredLanguage === 'en'
              ? "I didn't quite understand. Would you like to find a tutor or need other help?"
              : 'Mình chưa hiểu ý bạn. Bạn muốn tìm gia sư hay cần hỗ trợ gì?'),
        );
        break;
    }
  }

  private async handleTutorSelected(userId: string, tutor: TutorCandidateDto, context?: ConversationContext): Promise<void> {
    await this.state.updateContext(userId, {
      selectedTutorId: tutor.tutorId,
      selectedTutorName: tutor.fullName,
    });
    const lang = context?.preferredLanguage ?? 'vi';
    await this.zalo.sendNumberedList(
      userId,
      lang === 'en'
        ? `You selected ${tutor.fullName}! How many sessions would you like?`
        : `Bạn đã chọn ${tutor.fullName}! Bạn muốn học gói bao nhiêu buổi?`,
      lang === 'en'
        ? [
            { label: '4 sessions', hint: 'trial' },
            { label: '8 sessions', hint: 'popular' },
            { label: '12 sessions', hint: 'best value' },
          ]
        : [
            { label: '4 buổi', hint: 'thử nghiệm' },
            { label: '8 buổi', hint: 'phổ biến' },
            { label: '12 buổi', hint: 'tiết kiệm nhất' },
          ],
    );
  }

  private buildStatusMessage(context: ConversationContext): string {
    const en = context.preferredLanguage === 'en';
    if (context.activeBookingId) {
      return en
        ? `Your lesson schedule is active (booking #${context.activeBookingId}). How can I help?`
        : `Lịch học của bạn đang hoạt động (booking #${context.activeBookingId}). Bạn cần hỗ trợ gì?`;
    }
    if (context.selectedTutorName) {
      return en
        ? `You're in the process of booking with ${context.selectedTutorName}. Would you like to continue?`
        : `Bạn đang trong quá trình đặt lịch với ${context.selectedTutorName}. Bạn muốn tiếp tục không?`;
    }
    if (context.criteria?.subject) {
      return en
        ? `You're looking for a ${context.criteria.subject} tutor. Would you like to view the tutor list again?`
        : `Bạn đang tìm gia sư môn ${context.criteria.subject}. Bạn muốn xem lại danh sách gia sư không?`;
    }
    return en
      ? "You don't have any active lessons yet. Would you like to find a tutor?"
      : 'Hiện bạn chưa có lịch học nào. Bạn muốn tìm gia sư không?';
  }

  private async appendChatHistory(userId: string, userText: string, botReply: string): Promise<void> {
    const context = await this.state.getContext(userId);
    const history: ChatMessage[] = context.chatHistory ?? [];
    history.push({ role: 'user', content: userText });
    history.push({ role: 'assistant', content: botReply });
    await this.state.updateContext(userId, { chatHistory: history.slice(-20) });
  }

  // Đang trong phễu booking / sau-booking → giữ đường llm-router + flows cũ, KHÔNG đưa
  // vào agent matching (agent chỉ phụ trách giai đoạn tìm gia sư). selectedTutorId tính
  // là trong phễu (đang chọn gói/lịch qua free-text) — thoát bằng trigger "tìm gia sư".
  private inBookingPhase(context: ConversationContext): boolean {
    return Boolean(
      context.bookingStep ||
        context.activeFlow ||
        context.activeBookingId ||
        context.selectedTutorId,
    );
  }

  private async handleAdminCommand(adminId: string, text: string): Promise<boolean> {
    const match = text.match(/^\/botchat\s+(on|off)\s+(\S+)$/i);
    if (!match) return false;
    const [, action, targetUserId] = match;
    const disabled = action.toLowerCase() === 'off';
    await this.state.updateContext(targetUserId, { botChatDisabled: disabled });
    await this.zalo.sendText(adminId, `BotChat cho user ${targetUserId} đã được ${disabled ? 'TẮT' : 'BẬT'}.`);
    return true;
  }
}
