import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BeClientService } from '../../be-client/be-client.service';
import { TutorCandidateDto } from '../../be-client/dto';
import { ZaloService } from '../../zalo/zalo.service';
import { ConversationState } from '../state/conversation-state.enum';
import { ConversationStateService } from '../state/conversation-state.service';

@Injectable()
export class MatchingFlow {
  private readonly logger = new Logger(MatchingFlow.name);
  private readonly tutorProfileBaseUrl: string;

  constructor(
    private readonly beClient: BeClientService,
    private readonly state: ConversationStateService,
    private readonly zalo: ZaloService,
    config: ConfigService,
  ) {
    this.tutorProfileBaseUrl = config.get<string>(
      'tutorProfileBaseUrl',
      'https://tutora.vn/gia-su',
    );
  }

  async showMatches(zaloUserId: string): Promise<void> {
    const context = await this.state.getContext(zaloUserId);

    if (!context.criteria) {
      await this.zalo.sendText(
        zaloUserId,
        'Mình cần thêm thông tin để tìm gia sư.',
      );
      return;
    }

    const result = await this.beClient.getMatchedTutors(context.criteria);
    await this.state.updateContext(zaloUserId, { subjectId: result.subjectId });
    await this.state.setMatchingCandidates(zaloUserId, result.candidates);

    if (result.candidates.length === 0) {
      await this.zalo.sendText(
        zaloUserId,
        'Hiện chưa tìm thấy gia sư phù hợp. Tutora sẽ liên hệ lại khi có ứng viên mới.',
      );
      return;
    }

    try {
      await this.zalo.sendInteractiveListCard(
        zaloUserId,
        result.candidates
          .slice(0, 3)
          .map((candidate) => this.toListElement(candidate)),
      );
      await this.state.transitionState(zaloUserId, ConversationState.Matched);
    } catch (error) {
      this.logger.error(
        `Failed to send tutor cards for ${zaloUserId}: ${String(error)}`,
      );
      await this.zalo.sendText(
        zaloUserId,
        'Mình gặp sự cố khi hiển thị danh sách gia sư. Bạn thử lại sau nhé.',
      );
    }
  }

  private toListElement(candidate: TutorCandidateDto) {
    const tierLabel: Record<string, string> = {
      standard: 'Tiêu chuẩn',
      pro: 'Pro',
      premium: 'Premium',
    };

    return {
      title: candidate.fullName,
      subtitle: [
        `${tierLabel[candidate.subscriptionType] ?? candidate.subscriptionType}`,
        `⭐ ${candidate.averageRating}/5 (${candidate.totalReviews} đánh giá)`,
        `💰 ${candidate.hourlyRate.toLocaleString('vi-VN')}đ/buổi`,
      ].join(' · '),
      imageUrl: candidate.avatarUrl,
      profileUrl: `${this.tutorProfileBaseUrl}/${candidate.tutorId}`,
      buttons: [
        {
          title: 'Đặt lịch',
          payload: `select_tutor:${candidate.tutorId}`,
        },
      ],
    };
  }
}
