import { Injectable, Logger } from '@nestjs/common';
import { TutorCandidateDto } from '../../be-client/dto';
import { ZaloWebhookEvent } from '../../webhook/zalo-event.dto';
import { getEventPayload, getZaloUserId } from '../../webhook/zalo-event.utils';
import { ZaloService } from '../../zalo/zalo.service';
import { OnboardingFlow } from '../flows/onboarding.flow';
import { ConversationStateService } from '../state/conversation-state.service';

@Injectable()
export class PostbackHandler {
  private readonly logger = new Logger(PostbackHandler.name);

  constructor(
    private readonly onboardingFlow: OnboardingFlow,
    private readonly state: ConversationStateService,
    private readonly zalo: ZaloService,
  ) {}

  async handle(event: ZaloWebhookEvent): Promise<void> {
    const userId = getZaloUserId(event);
    const payload = getEventPayload(event);

    if (!userId) {
      this.logger.warn(`Postback event missing sender id: ${JSON.stringify(event)}`);
      return;
    }

    this.logger.debug(`Postback | user=${userId} | payload="${payload}"`);
    if (!payload) return;

    // onboarding:slot:value  (e.g., onboarding:subject:Toán, onboarding:gender:female)
    if (payload.startsWith('onboarding:')) {
      await this.onboardingFlow.handlePostbackInput(userId, payload);
      return;
    }

    // select_tutor:tutorId
    if (payload.startsWith('select_tutor:')) {
      const tutorId = payload.slice('select_tutor:'.length);
      const candidates = await this.state.getMatchingCandidates<TutorCandidateDto>(userId);
      const tutor = candidates.find((c) => c.tutorId === tutorId);
      if (!tutor) {
        await this.zalo.sendText(userId, 'Mình không tìm thấy gia sư này. Bạn thử chọn lại nhé?');
        return;
      }
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
      return;
    }

    this.logger.warn(`Unknown postback payload: "${payload}"`);
  }
}
