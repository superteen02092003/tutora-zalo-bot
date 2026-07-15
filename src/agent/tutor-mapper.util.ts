import { AgentTutorItem } from './agent-client.types';
import { TutorCandidateDto, TutorSubscriptionType } from '../be-client/dto';

// Khớp _MAX_CARDS_SHOWN = 3 bên FastAPI agent (tutora-ai) — top 3 theo 3 tier.
export const MAX_CARDS = 3;
const TIER_BY_PRICE_RANK: TutorSubscriptionType[] = ['standard', 'pro', 'premium'];

/**
 * Map TutorRecommendItem (.NET, qua agent/search-direct) → TutorCandidateDto (card render).
 * Dùng chung cho cả AgentMatchingFlow (chat) và MiniAppSearchFlow (Mini App inline results)
 * — tách ra đây để 2 nơi không định nghĩa tier/mapping khác nhau, dễ lệch.
 *
 * TODO: thay bằng tier chính thức từ BE khi có (tutora-ai/agents/agentscenarios.md KB-A —
 * công thức tier phải deterministic ở BE/Ranking Core, đây chỉ là heuristic tạm cho demo:
 * xếp theo giá trong chính nhóm hiển thị).
 */
export function mapAgentTutorsToCandidates(items: AgentTutorItem[]): TutorCandidateDto[] {
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
