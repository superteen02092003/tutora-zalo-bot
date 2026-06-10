import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BeClientService } from '../../be-client/be-client.service';
import { TutorCandidateDto, TutorSubscriptionType } from '../../be-client/dto';
import { ZaloService } from '../../zalo/zalo.service';
import { ConversationState } from '../state/conversation-state.enum';
import { ConversationStateService } from '../state/conversation-state.service';

const TIER_ORDER: TutorSubscriptionType[] = ['standard', 'pro', 'premium'];

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
      await this.zalo.sendText(zaloUserId, 'Mình cần thêm thông tin để tìm gia sư.');
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

    // Pick the best-rated tutor from each tier
    const displayed = this.pickOnePer(result.candidates);

    try {
      await this.zalo.sendText(
        zaloUserId,
        `Tutora tìm thấy ${result.candidates.length} gia sư phù hợp! Đây là ${displayed.length} gợi ý ở các mức học phí khác nhau:`,
      );

      for (const candidate of displayed) {
        await this.zalo.sendTutorCard(zaloUserId, candidate, this.tutorProfileBaseUrl);
      }

      await this.state.transitionState(zaloUserId, ConversationState.Matched);
    } catch (error) {
      this.logger.error(`Failed to send tutor cards for ${zaloUserId}: ${String(error)}`);
      await this.zalo.sendText(
        zaloUserId,
        'Mình gặp sự cố khi hiển thị danh sách gia sư. Bạn thử lại sau nhé.',
      );
    }
  }

  // Returns at most 3 candidates — one per tier, in Standard→Pro→Premium order.
  // Falls back to top 3 by rating if none match a tier.
  private pickOnePer(candidates: TutorCandidateDto[]): TutorCandidateDto[] {
    const picked = TIER_ORDER
      .map((tier) => {
        const inTier = candidates.filter((c) => c.subscriptionType === tier);
        return inTier.sort((a, b) => b.averageRating - a.averageRating)[0];
      })
      .filter((c): c is TutorCandidateDto => !!c);

    if (picked.length > 0) return picked;
    return [...candidates].sort((a, b) => b.averageRating - a.averageRating).slice(0, 3);
  }
}
