import {
  AgentHistoryMessage,
  AgentShownTutor,
} from '../../agent/agent-client.types';

export interface ConversationContext {
  zaloUserId: string;
  preferredLanguage?: 'vi' | 'en';
  botChatDisabled?: boolean;
  // agentCtx: slot hội thoại tích luỹ (subject_id, grade_level_id, goal, preferences,
  // min_rate, max_rate, teaching_mode, city, tutor_gender, asked_preferences...) — nguồn kép:
  // (1) Mini App form search-direct ghi vào để prefill lại form lần sau (MiniAppController.
  // getPrefill), (2) MessageHandler đọc/ghi mỗi lượt chat để gửi context cho /api/v1/agent +
  // merge context_patch agent trả về. Cùng 1 field, 2 nơi đọc/ghi vì cùng là "tiêu chí tìm
  // gia sư hiện tại" của user, bất kể đến từ chat hay từ form.
  agentCtx?: Record<string, unknown>;
  // Lịch sử hội thoại gửi cho /api/v1/agent mỗi lượt (agent KHÔNG tự lưu, stateless) — cap độ
  // dài (xem MAX_AGENT_HISTORY trong MessageHandler) để tránh Redis phình to + history quá
  // dài khiến LLM lẫn lộn chủ đề cũ/mới (agent.py hiện chưa tự cắt history phía tutora-ai).
  chatHistory?: AgentHistoryMessage[];
  // Gia sư agent vừa gợi ý trong chat lượt trước — cho agent hiểu "gia sư A" nhắc tới trong
  // câu tiếp theo là ai (KHÔNG liên quan candidates của Mini App search, xem setMatchingCandidates).
  shownTutors?: AgentShownTutor[];
}
