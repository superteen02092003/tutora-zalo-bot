import { Injectable, Logger } from '@nestjs/common';
import { AgentClientService } from '../../agent/agent-client.service';
import { mapAgentTutorsToCandidates } from '../../agent/tutor-mapper.util';
import { TutorCandidateDto } from '../../be-client/dto';
import { MiniAppTokenService } from '../../mini-app/mini-app-token.service';
import { MiniAppButtonService } from '../../mini-app/mini-app-button.service';
import { ConversationState } from '../state/conversation-state.enum';
import { ConversationStateService } from '../state/conversation-state.service';
import { AgentMatchingFlow } from './agent-matching.flow';

/** Body Mini App gửi lên sau khi PH submit form — dropdown môn/lớp Mini App tự fetch
 * trực tiếp .NET nên subjectId/gradeLevelId ĐÃ LÀ số thật, không cần NestJS resolve tên. */
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
 * Luồng hybrid: bước KHỞI TẠO tìm gia sư đi qua Zalo Mini App (form) thay vì chat hỏi từng
 * slot. Sau khi Mini App submit, tái dùng NGUYÊN pipeline agent (search/tier/card) qua
 * AgentMatchingFlow.runTurn với context đã bơm sẵn đầy đủ slot + asked_preferences=true —
 * agent Python nhảy thẳng vào search, không hỏi lại gì (xem agents/agentscenarios.md,
 * _handle_find_tutor nhánh rush/đủ-slot của tutora-ai).
 *
 * sendSearchButton() SỐNG Ở MiniAppButtonService (không phải ở đây) — tránh circular
 * dependency với AgentMatchingFlow, vì class này cũng cần gọi AgentMatchingFlow.runTurn.
 */
@Injectable()
export class MiniAppSearchFlow {
  private readonly logger = new Logger(MiniAppSearchFlow.name);

  constructor(
    private readonly tokenService: MiniAppTokenService,
    private readonly buttonService: MiniAppButtonService,
    private readonly agentMatchingFlow: AgentMatchingFlow,
    private readonly agentClient: AgentClientService,
    private readonly state: ConversationStateService,
  ) {}

  /** @deprecated Dùng MiniAppButtonService.sendSearchButton trực tiếp — giữ lại để không
   * phải sửa các chỗ gọi cũ, chỉ forward. */
  async sendSearchButton(userId: string, lang: 'vi' | 'en' = 'vi'): Promise<void> {
    return this.buttonService.sendSearchButton(userId, lang);
  }

  /** Xác thực token + tái dùng pipeline agent để search + trả card. */
  async handleFormSubmit(payload: MiniAppSearchSubmission): Promise<{ ok: boolean; error?: string }> {
    const verified = this.tokenService.verify(payload.token);
    if (!verified) {
      this.logger.warn('Token Mini App không hợp lệ hoặc đã hết hạn.');
      return { ok: false, error: 'invalid_or_expired_token' };
    }
    const { userId, lang } = verified;

    const agentCtx: Record<string, unknown> = {
      subject_id: payload.subjectId,
      grade_level_id: payload.gradeLevelId,
      // Đánh dấu đã hỏi lượt gộp tuỳ chọn — agent Python (KB-A bước 4) sẽ search luôn
      // thay vì hỏi lại khu vực/hình thức/mong muốn (PH đã điền hết trong form rồi).
      asked_preferences: true,
    };
    if (payload.goal) agentCtx.goal = payload.goal;
    if (payload.preferences) agentCtx.preferences = payload.preferences;
    if (payload.minRate != null) agentCtx.min_rate = payload.minRate;
    if (payload.maxRate != null) agentCtx.max_rate = payload.maxRate;
    if (payload.teachingMode) agentCtx.teaching_mode = payload.teachingMode;
    if (payload.city) agentCtx.city = payload.city;
    if (payload.tutorGender) agentCtx.tutor_gender = payload.tutorGender;

    // Trigger message CHÍNH LÀ tin nhắn cuối agent thấy — Gemini mirror ngôn ngữ từ đây
    // (xem tutora-ai/app/services/agent.py _STYLE), nên phải đúng ngôn ngữ PH đang dùng.
    const triggerMessage = lang === 'en' ? 'Please find a tutor for me.' : 'Tìm gia sư giúp tôi ạ';
    // shownTutorsOverride=[] : form mới submit = coi như search mới hoàn toàn, KHÔNG mang
    // theo "đã gợi ý gia sư X" từ lần tìm trước (nếu có) — tránh agent Python hỏi lại
    // disambiguation "đổi gia sư khác/nhu cầu khác" (xem runTurn jsdoc) ngay sau khi PH
    // vừa quyết định qua form.
    await this.agentMatchingFlow.runTurn(userId, triggerMessage, agentCtx, []);
    return { ok: true };
  }

  /**
   * Search THẲNG (không qua agent Python/LLM — xem AgentClientService.searchDirect) để hiển
   * thị kết quả NGAY trong Mini App (list gọn kiểu Preply, 3-5 gia sư) thay vì chỉ báo "quay
   * lại Zalo xem" như handleFormSubmit(). `excludeTutorIds` rỗng = lượt tìm đầu; có giá trị =
   * PH bấm nút "Tìm gia sư khác" trong Mini App (giữ nguyên tiêu chí, loại các gia sư vừa
   * hiện — KHÔNG hỏi lại gì, khác hẳn luồng disambiguation bên chat vì đây PH đã rõ ý qua
   * hành động bấm nút).
   */
  async getResults(payload: MiniAppSearchResultsRequest): Promise<MiniAppSearchResultsResponse> {
    const verified = this.tokenService.verify(payload.token);
    if (!verified) {
      this.logger.warn('Token Mini App không hợp lệ hoặc đã hết hạn (getResults).');
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
      tutors = mapAgentTutorsToCandidates(res.tutors.slice(0, MINI_APP_RESULTS_COUNT));
    } catch (error) {
      this.logger.error(`Mini App search-direct lỗi cho user=${userId}: ${String(error)}`);
      return { ok: false, error: 'search_failed' };
    }

    // Persist agentCtx + shown tutors — nếu PH quay lại chat hỏi tiếp ("chi tiết cô A",
    // "tìm gia sư nữa"...), agent Python cần biết đúng tiêu chí + danh sách đã hiện, không
    // hỏi lại từ đầu (khớp field agentCtx đã dùng cho luồng chat, xem conversation-context.interface.ts).
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
    await this.state.updateContext(userId, {
      agentCtx,
      agentShownTutors: tutors.map((t) => ({ tutor_id: t.tutorId, name: t.fullName })),
    });

    // Đã BỎ thông báo "đã gửi gợi ý gia sư..." vào OA chat sau search — bug thật 2026-07-14:
    // request từ Mini App (webview) bị lặp nhiều lần độc lập trong vài giây (chưa root-cause
    // được, kể cả sau khi thử dedup NX 8s vẫn không chặn hết vì khoảng cách giữa các lần
    // lặp có lúc >8s), gây spam nhiều tin giống hệt nhau vào OA dù PH chỉ thao tác 1 lần.
    // Quyết định (theo yêu cầu): bỏ hẳn thông báo này, KHÔNG chỉ dedup — search/response
    // chính cho Mini App vẫn hoạt động bình thường, chỉ không nhắn gì thêm vào OA nữa.

    return { ok: true, tutors };
  }
}
