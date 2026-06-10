import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TutorCandidateDto } from '../../be-client/dto';
import { LlmRouterService } from '../../llm/llm-router.service';
import { RouterDecision } from '../../llm/llm-router.types';
import { ZaloWebhookEvent } from '../../webhook/zalo-event.dto';
import { getMessageText, getZaloUserId } from '../../webhook/zalo-event.utils';
import { ZaloService } from '../../zalo/zalo.service';
import { OnboardingFlow } from '../flows/onboarding.flow';
import { ConversationContext } from '../state/conversation-context.interface';
import { ConversationStateService } from '../state/conversation-state.service';

@Injectable()
export class MessageHandler {
  private readonly logger = new Logger(MessageHandler.name);
  private readonly adminUserIds: Set<string>;

  constructor(
    private readonly state: ConversationStateService,
    private readonly zalo: ZaloService,
    private readonly llmRouter: LlmRouterService,
    private readonly onboardingFlow: OnboardingFlow,
    config: ConfigService,
  ) {
    this.adminUserIds = new Set(config.get<string[]>('adminZaloUserIds') ?? []);
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

    const convState = await this.state.getState(userId);
    const candidates = await this.state.getMatchingCandidates<TutorCandidateDto>(userId);

    const decision = await this.llmRouter.decide({ message: text, state: convState, context, candidates });
    this.logger.debug(`LLM decision | user=${userId} | ${JSON.stringify(decision)}`);

    await this.executeDecision(userId, decision, context, candidates);
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

      case 'select_tutor': {
        const tutor = candidates.find((c) =>
          c.fullName.toLowerCase().includes(decision.tutorName.toLowerCase()),
        );
        if (!tutor) {
          await this.zalo.sendText(userId, `Mình không tìm thấy gia sư "${decision.tutorName}" trong danh sách. Bạn chọn lại nhé?`);
          return;
        }
        await this.handleTutorSelected(userId, tutor);
        break;
      }

      case 'select_package':
        await this.state.updateContext(userId, { selectedPackageSessionCount: decision.sessionCount });
        await this.zalo.sendNumberedList(
          userId,
          `Đã chọn ${decision.sessionCount} buổi! Bạn muốn học mấy buổi mỗi tuần?`,
          [{ label: '2 buổi/tuần' }, { label: '3 buổi/tuần' }],
        );
        break;

      case 'select_schedule':
        await this.state.updateContext(userId, {
          requiredSessionsPerWeek: decision.preset === 'twice_weekly' ? 2 : 3,
        });
        await this.zalo.sendText(
          userId,
          'Tutora đã ghi nhận. Nhân viên Tutora sẽ liên hệ để xác nhận lịch và gửi thông tin thanh toán cho bạn sớm nhé!',
        );
        break;

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
          (decision as { reply?: string }).reply ?? 'Mình chưa hiểu ý bạn. Bạn muốn tìm gia sư hay cần hỗ trợ gì?',
        );
        break;
    }
  }

  private async handleTutorSelected(userId: string, tutor: TutorCandidateDto): Promise<void> {
    await this.state.updateContext(userId, {
      selectedTutorId: tutor.tutorId,
      selectedTutorName: tutor.fullName,
    });
    await this.zalo.sendNumberedList(
      userId,
      `Bạn đã chọn ${tutor.fullName}! Bạn muốn học gói bao nhiêu buổi?`,
      [
        { label: '4 buổi', hint: 'thử nghiệm' },
        { label: '8 buổi', hint: 'phổ biến' },
        { label: '12 buổi', hint: 'tiết kiệm nhất' },
      ],
    );
  }

  private buildStatusMessage(context: ConversationContext): string {
    if (context.activeBookingId) {
      return `Lịch học của bạn đang hoạt động (booking #${context.activeBookingId}). Bạn cần hỗ trợ gì?`;
    }
    if (context.selectedTutorName) {
      return `Bạn đang trong quá trình đặt lịch với ${context.selectedTutorName}. Bạn muốn tiếp tục không?`;
    }
    if (context.criteria?.subject) {
      return `Bạn đang tìm gia sư môn ${context.criteria.subject}. Bạn muốn xem lại danh sách gia sư không?`;
    }
    return 'Hiện bạn chưa có lịch học nào. Bạn muốn tìm gia sư không?';
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
