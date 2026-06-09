import { Injectable, Logger } from '@nestjs/common';
import { TutorCandidateDto } from '../../be-client/dto';
import { ZaloService } from '../../zalo/zalo.service';
import { ConversationState } from '../state/conversation-state.enum';
import { ConversationStateService } from '../state/conversation-state.service';
import { OnboardingFlow } from './onboarding.flow';

@Injectable()
export class ReplacementTutorFlow {
  private readonly logger = new Logger(ReplacementTutorFlow.name);

  constructor(
    private readonly state: ConversationStateService,
    private readonly zalo: ZaloService,
    private readonly onboardingFlow: OnboardingFlow,
  ) {}

  async suggest(
    zaloUserId: string,
    opts: { declinedTutorName?: string; reason?: string } = {},
  ): Promise<void> {
    const candidates =
      await this.state.getMatchingCandidates<TutorCandidateDto>(zaloUserId);

    const context = await this.state.getContext(zaloUserId);
    const alreadySelected = context.selectedTutorId;

    const next = candidates.find((c) => c.tutorId !== alreadySelected);

    if (!next) {
      this.logger.warn(`No replacement candidate found for ${zaloUserId}, restarting matching`);
      await this.zalo.sendText(
        zaloUserId,
        'Hiện không còn gia sư dự phòng trong danh sách. Mình sẽ tìm gia sư mới cho bạn.',
      );
      await this.onboardingFlow.start(zaloUserId);
      return;
    }

    const declinedMsg = opts.declinedTutorName
      ? `${opts.declinedTutorName} ${opts.reason ? `(${opts.reason}) ` : ''}không thể dạy.`
      : '';

    await this.zalo.sendText(
      zaloUserId,
      `${declinedMsg} Mình đề xuất gia sư thay thế sau:`.trim(),
    );

    await this.zalo.sendListCard(zaloUserId, [
      {
        title: `${next.fullName} - ${next.subscriptionType}`,
        subtitle: `${next.averageRating}/5 (${next.totalReviews} đánh giá) - ${next.hourlyRate.toLocaleString('vi-VN')} VND/buổi`,
        imageUrl: next.avatarUrl,
        buttons: [
          { title: 'Chọn gia sư này', payload: `replacement:select:${next.tutorId}` },
        ],
      },
    ]);

    await this.zalo.sendQuickReply(
      zaloUserId,
      'Hoặc bạn có thể chọn:',
      [
        { title: 'Giữ nguyên lịch cũ', payload: `replacement:same_schedule:${next.tutorId}` },
        { title: 'Chọn lịch mới', payload: `replacement:new_schedule:${next.tutorId}` },
        { title: 'Xem thêm gia sư', payload: 'replacement:see_others' },
      ],
    );

    await this.state.transitionState(zaloUserId, ConversationState.Matched);
  }

  async handlePostback(zaloUserId: string, payload: string): Promise<void> {
    if (payload.startsWith('replacement:same_schedule:')) {
      const tutorId = payload.split(':')[2];
      await this.state.updateContext(zaloUserId, { selectedTutorId: tutorId });
      await this.zalo.sendText(
        zaloUserId,
        'Đã giữ nguyên lịch học với gia sư mới. Tutora sẽ xác nhận và thông báo cho bạn.',
      );
      await this.state.transitionState(zaloUserId, ConversationState.BookingConfirm);
      return;
    }

    if (payload.startsWith('replacement:new_schedule:')) {
      const tutorId = payload.split(':')[2];
      await this.state.updateContext(zaloUserId, { selectedTutorId: tutorId });
      await this.zalo.sendText(
        zaloUserId,
        'Vui lòng nhập thời gian học mong muốn (ví dụ: 25/06 19:00).',
      );
      return;
    }

    if (payload === 'replacement:see_others') {
      const context = await this.state.getContext(zaloUserId);
      const candidates =
        await this.state.getMatchingCandidates<TutorCandidateDto>(zaloUserId);
      const others = candidates
        .filter((c) => c.tutorId !== context.selectedTutorId)
        .slice(0, 3);

      if (others.length === 0) {
        await this.zalo.sendText(
          zaloUserId,
          'Không còn gia sư nào khác trong danh sách hiện tại. Mình sẽ tìm gia sư mới.',
        );
        await this.onboardingFlow.start(zaloUserId);
        return;
      }

      await this.zalo.sendListCard(
        zaloUserId,
        others.map((c) => ({
          title: `${c.fullName} - ${c.subscriptionType}`,
          subtitle: `${c.averageRating}/5 (${c.totalReviews} đánh giá) - ${c.hourlyRate.toLocaleString('vi-VN')} VND/buổi`,
          imageUrl: c.avatarUrl,
          buttons: [{ title: 'Chọn', payload: `select_tutor:${c.tutorId}` }],
        })),
      );
      return;
    }

    if (payload.startsWith('replacement:select:')) {
      const tutorId = payload.split(':')[2];
      await this.state.updateContext(zaloUserId, { selectedTutorId: tutorId });
      await this.zalo.sendQuickReply(
        zaloUserId,
        'Bạn đã chọn gia sư thay thế. Bạn muốn giữ lịch cũ hay chọn lịch mới?',
        [
          { title: 'Giữ lịch cũ', payload: `replacement:same_schedule:${tutorId}` },
          { title: 'Chọn lịch mới', payload: `replacement:new_schedule:${tutorId}` },
        ],
      );
    }
  }
}
