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

  /**
   * Show tutor matches to the user.
   *
   * @param zaloUserId       Zalo user to send results to.
   * @param rankedCandidates Pre-ranked candidates from the onboarding flow (AI-reordered).
   *                         If omitted, falls back to fetching directly from .NET BE.
   */
  async showMatches(zaloUserId: string, rankedCandidates?: TutorCandidateDto[]): Promise<void> {
    const context = await this.state.getContext(zaloUserId);
    const lang = context.preferredLanguage ?? 'vi';

    let candidates: TutorCandidateDto[];

    if (rankedCandidates !== undefined) {
      // Use the pre-ranked candidates provided by onboardingFlow.triggerMatching()
      candidates = rankedCandidates;

      // Persist to Redis so downstream flows (select_tutor, etc.) can look them up
      await this.state.setMatchingCandidates(zaloUserId, candidates);
    } else {
      // Fallback: fetch directly from .NET BE (direct call without AI re-ranking)
      if (!context.criteria) {
        await this.zalo.sendText(
          zaloUserId,
          lang === 'en' ? 'I need a bit more information to find tutors.' : 'Mình cần thêm thông tin để tìm gia sư.',
        );
        return;
      }

      const result = await this.beClient.getMatchedTutors(context.criteria);
      await this.state.updateContext(zaloUserId, { subjectId: result.subjectId });
      await this.state.setMatchingCandidates(zaloUserId, result.candidates);
      candidates = result.candidates;
    }

    if (candidates.length === 0) {
      await this.zalo.sendText(
        zaloUserId,
        lang === 'en'
          ? 'No matching tutors found at the moment. Tutora will reach out when new tutors are available.'
          : 'Hiện chưa tìm thấy gia sư phù hợp. Tutora sẽ liên hệ lại khi có ứng viên mới.',
      );
      return;
    }

    // Pick the best-rated tutor from each tier
    const displayed = this.pickOnePer(candidates);

    try {
      await this.zalo.sendText(
        zaloUserId,
        lang === 'en'
          ? `Tutora found ${candidates.length} matching tutor(s)! Here are ${displayed.length} recommendations across different price ranges:`
          : `Tutora tìm thấy ${candidates.length} gia sư phù hợp! Đây là ${displayed.length} gợi ý ở các mức học phí khác nhau:`,
      );

      for (const candidate of displayed) {
        await this.zalo.sendTutorCard(zaloUserId, candidate, this.tutorProfileBaseUrl, lang);
      }

      await this.state.transitionState(zaloUserId, ConversationState.Matched);
    } catch (error) {
      this.logger.error(`Failed to send tutor cards for ${zaloUserId}: ${String(error)}`);
      await this.zalo.sendText(
        zaloUserId,
        lang === 'en'
          ? 'Something went wrong while displaying tutors. Please try again later.'
          : 'Mình gặp sự cố khi hiển thị danh sách gia sư. Bạn thử lại sau nhé.',
      );
    }
  }

  // Returns at most 3 candidates — one per tier, in Standard→Pro→Premium order.
  private pickOnePer(candidates: TutorCandidateDto[]): TutorCandidateDto[] {
    const picked = TIER_ORDER
      .map((tier) => candidates.find((c) => c.subscriptionType === tier))
      .filter((c): c is TutorCandidateDto => !!c);

    if (picked.length > 0) return picked;
    return candidates.slice(0, 3);
  }
}
