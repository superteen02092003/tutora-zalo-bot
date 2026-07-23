import { Injectable, Logger } from '@nestjs/common';
import { AgentClientService } from '../../agent/agent-client.service';
import { mapAgentTutorsToCandidates } from '../../agent/tutor-mapper.util';
import { TutorCandidateDto } from '../../be-client/dto';
import { MiniAppTokenService } from '../../mini-app/mini-app-token.service';
import { ConversationState } from '../state/conversation-state.enum';
import { ConversationStateService } from '../state/conversation-state.service';

/** Body Mini App gửi lên khi tìm gia sư — dropdown môn/lớp Mini App tự fetch trực tiếp
 * .NET nên subjectId/gradeLevelId ĐÃ LÀ số thật, không cần NestJS resolve tên. */
export interface MiniAppSearchSubmission {
  token: string;
  subjectId: number;
  gradeLevelId: number;
  goal?: string;
  preferences?: string;
  minRate?: number;
  maxRate?: number;
  teachingMode?: 'online' | 'offline' | 'both';
  city?: string;
  tutorGender?: 'male' | 'female';
}

/** Nút "tìm gia sư khác" trong Mini App — cùng payload search nhưng thêm excludeTutorIds
 * (loại các gia sư vừa hiện, KHÔNG lặp lại). */
export interface MiniAppSearchResultsRequest extends MiniAppSearchSubmission {
  excludeTutorIds?: string[];
}

export interface MiniAppSearchResultsResponse {
  ok: boolean;
  error?: string;
  tutors?: TutorCandidateDto[];
}

// Danh sách trong Mini App hiển thị nhiều hơn card chat (không bị giới hạn bởi khung ảnh
// card Zalo) — 3-5 gia sư dạng list gọn kiểu Preply, theo yêu cầu thiết kế.
const MINI_APP_RESULTS_COUNT = 5;

/**
 * Luồng tìm gia sư qua Zalo Mini App (form filter) — KHÔNG còn qua chat/LLM (AgentMatchingFlow
 * đã bỏ hẳn 2026-07-19, cùng chatHistory/sessionMemory/welcome-back trong ConversationContext —
 * nguồn gây "loạn dữ liệu cũ" khi PH tìm gia sư khác). Chỉ còn search trực tiếp qua
 * agentClient.searchDirect (embedding + Bayesian rating của tutora-ai, KHÔNG qua bước
 * hỏi-đáp LLM) — mỗi lượt tìm độc lập theo đúng tiêu chí Mini App gửi lên, không mang theo
 * ngữ cảnh hội thoại cũ nào.
 */
@Injectable()
export class MiniAppSearchFlow {
  private readonly logger = new Logger(MiniAppSearchFlow.name);

  constructor(
    private readonly tokenService: MiniAppTokenService,
    private readonly agentClient: AgentClientService,
    private readonly state: ConversationStateService,
  ) {}

  /**
   * Search THẲNG (không qua agent Python/LLM — xem AgentClientService.searchDirect) để hiển
   * thị kết quả NGAY trong Mini App (list gọn kiểu Preply, 3-5 gia sư). `excludeTutorIds`
   * rỗng = lượt tìm đầu; có giá trị = PH bấm nút "Tìm gia sư khác" trong Mini App (giữ
   * nguyên tiêu chí, loại các gia sư vừa hiện).
   */
  async getResults(
    payload: MiniAppSearchResultsRequest,
  ): Promise<MiniAppSearchResultsResponse> {
    const verified = this.tokenService.verify(payload.token);
    if (!verified) {
      this.logger.warn(
        'Token Mini App không hợp lệ hoặc đã hết hạn (getResults).',
      );
      return { ok: false, error: 'invalid_or_expired_token' };
    }
    const { userId } = verified;

    let tutors: TutorCandidateDto[];
    try {
      const res = await this.agentClient.searchDirect({
        subject_id: payload.subjectId,
        grade_level_id: payload.gradeLevelId,
        goal: payload.goal,
        preferences: payload.preferences,
        min_rate: payload.minRate,
        max_rate: payload.maxRate,
        teaching_mode: payload.teachingMode,
        city: payload.city,
        tutor_gender: payload.tutorGender,
        exclude_tutor_ids: payload.excludeTutorIds ?? [],
        top_k: MINI_APP_RESULTS_COUNT,
      });
      tutors = mapAgentTutorsToCandidates(
        res.tutors.slice(0, MINI_APP_RESULTS_COUNT),
      );
    } catch (error) {
      this.logger.error(
        `Mini App search-direct lỗi cho user=${userId}: ${String(error)}`,
      );
      return { ok: false, error: 'search_failed' };
    }

    // Persist agentCtx — dùng lại khi PH mở lại Mini App để SỬA tiêu chí (xem
    // MiniAppController.getPrefill), không liên quan gì tới chat/hội thoại nữa.
    const agentCtx: Record<string, unknown> = {
      subject_id: payload.subjectId,
      grade_level_id: payload.gradeLevelId,
      asked_preferences: true,
    };
    if (payload.goal) agentCtx.goal = payload.goal;
    if (payload.preferences) agentCtx.preferences = payload.preferences;
    if (payload.minRate != null) agentCtx.min_rate = payload.minRate;
    if (payload.maxRate != null) agentCtx.max_rate = payload.maxRate;
    if (payload.teachingMode) agentCtx.teaching_mode = payload.teachingMode;
    if (payload.city) agentCtx.city = payload.city;
    if (payload.tutorGender) agentCtx.tutor_gender = payload.tutorGender;

    await this.state.setMatchingCandidates(userId, tutors);
    await this.state.setState(userId, ConversationState.Matched);
    await this.state.updateContext(userId, { agentCtx });

    // Đã BỎ thông báo "đã gửi gợi ý gia sư..." vào OA chat sau search — bug thật 2026-07-14:
    // request từ Mini App (webview) bị lặp nhiều lần độc lập trong vài giây (chưa root-cause
    // được, kể cả sau khi thử dedup NX 8s vẫn không chặn hết vì khoảng cách giữa các lần
    // lặp có lúc >8s), gây spam nhiều tin giống hệt nhau vào OA dù PH chỉ thao tác 1 lần.
    // Quyết định (theo yêu cầu): bỏ hẳn thông báo này, KHÔNG chỉ dedup — search/response
    // chính cho Mini App vẫn hoạt động bình thường, chỉ không nhắn gì thêm vào OA nữa.

    return { ok: true, tutors };
  }
}
