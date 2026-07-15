import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentClientService } from '../../agent/agent-client.service';
import { BeClientService } from '../../be-client/be-client.service';
import { MatchCriteria, TutorCandidateDto, TutorSubscriptionType } from '../../be-client/dto';
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

  async showMatches(zaloUserId: string): Promise<void> {
    const context = await this.state.getContext(zaloUserId);

    if (!context.criteria) {
      const lang = context.preferredLanguage ?? 'vi';
      await this.zalo.sendText(
        zaloUserId,
        lang === 'en' ? 'I need a bit more information to find tutors.' : 'Mình cần thêm thông tin để tìm gia sư.',
      );
      return;
    }

    const result = await this.beClient.getMatchedTutors(context.criteria);
    await this.state.updateContext(zaloUserId, { subjectId: result.subjectId });

    // AI rerank theo mức liên quan ngữ nghĩa (embedding) — .NET chỉ hard-filter (đúng
    // môn/lớp/khu vực...), thứ tự trong cùng 1 filter chưa phản ánh mức "hợp" với nhu cầu
    // thật của PH. Lỗi/rỗng → rankCandidates tự trả lại đúng thứ tự gốc, không chặn hiển thị.
    let candidates = result.candidates;
    if (candidates.length > 0) {
      const query = this.buildQueryFromCriteria(context.criteria);
      const candidateIds = candidates.map((c) => c.tutorId);
      const rankedIds = await this.agentClient.rankCandidates(query, candidateIds, 10);
      const byId = new Map(candidates.map((c) => [c.tutorId, c]));
      const reordered = rankedIds
        .map((id) => byId.get(id))
        .filter((c): c is TutorCandidateDto => c !== undefined);
      if (reordered.length > 0) candidates = reordered;
    }
    await this.state.setMatchingCandidates(zaloUserId, candidates);

    const lang = context.preferredLanguage ?? 'vi';

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

  // Query tự do cho AI rerank — ghép từ tiêu chí CỨNG đã thu (không có freetext step
  // trong wizard nút bấm này, khác wizard Mini App/agent chat).
  private buildQueryFromCriteria(criteria: MatchCriteria): string {
    const parts = [`${criteria.subject} lớp ${criteria.grade}`];
    if (criteria.purpose) {
      const purposeLabel: Record<string, string> = {
        exam_prep: 'ôn thi',
        regular: 'học thường xuyên',
        foundation: 'mất gốc, cần củng cố',
        advanced: 'nâng cao',
      };
      parts.push(purposeLabel[criteria.purpose] ?? criteria.purpose);
    }
    if (criteria.genderPreference && criteria.genderPreference !== 'any') {
      parts.push(criteria.genderPreference === 'female' ? 'ưu tiên gia sư nữ' : 'ưu tiên gia sư nam');
    }
    return parts.join(', ');
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
