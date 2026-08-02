/**
 * Types mirror schema của FastAPI AI agent (tutora-ai: app/models/schemas.py).
 * Giữ snake_case đúng như FastAPI nhận/trả — KHÔNG đổi sang camelCase ở tầng wire.
 *
 * search-direct: không qua LLM (Mini App form, tiêu chí đã rõ id thật).
 * agent (chat): CÓ LLM, dùng cho tin nhắn tự do — hồi sinh lại 2026-08-02 (giữ vai trò
 * "chatbot chỉ điều hướng qua nút Mini App" cho MATCHING, nhưng chat tự do vẫn cần LLM trả
 * lời tự nhiên thay vì luôn chỉ bắn nút).
 */

/** Shape 1 gia sư từ .NET /api/tutors/recommend (TutorRecommendItem), agent proxy nguyên. */
export interface AgentTutorItem {
  tutorId: string;
  fullName: string;
  avatarUrl?: string | null;
  headline?: string | null;
  teachingMode?: string | null;
  teachingAreaCity?: string | null;
  teachingAreaDistrict?: string | null;
  averageRating?: number | null;
  totalReviews?: number | null;
  totalCompletedLessons?: number | null;
  totalStudentsTaught?: number | null;
  pricePerHour?: number | null;
  subjects?: string[] | null;
  aiSimilarity?: number | null;
  profileUrl?: string | null;
}

/** Body cho POST /api/v1/tutors/search-direct — search THẲNG, KHÔNG qua hội thoại/LLM
 * (xem tutora-ai/app/services/agent.py::search_tutors_direct). Dùng khi tiêu chí đã rõ từ
 * form Mini App (id thật), không cần agent hiểu ý tự do. */
export interface DirectSearchRequestBody {
  subject_id: number;
  grade_level_id?: number;
  goal?: string;
  preferences?: string;
  min_rate?: number;
  max_rate?: number;
  teaching_mode?: string;
  city?: string;
  tutor_gender?: string;
  exclude_tutor_ids?: string[];
  top_k?: number;
}

export interface DirectSearchResponseBody {
  tutors: AgentTutorItem[];
}

/** 1 lượt hội thoại — role "assistant" đúng như tutora-ai/app/models/schemas.py::HistoryMessage
 * (KHÔNG dùng "model"/"bot"). */
export interface AgentHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Gia sư đã gợi ý lượt trước — cho agent hiểu "gia sư A" nhắc tới trong câu tiếp theo là ai
 * (tutora-ai::ShownTutor). */
export interface AgentShownTutor {
  tutor_id: string;
  name?: string;
}

/** Slot hội thoại tích luỹ qua các lượt — mirror TutorChatContext (tutora-ai). Lưu trong
 * ConversationContext.agentCtx, gửi lại mỗi lượt vì agent stateless. */
export interface AgentChatContext {
  subject_id?: number;
  grade_level_id?: number;
  teaching_mode?: string;
  city?: string;
  goal?: string;
  preferences?: string;
  asked_preferences?: boolean;
  min_rate?: number;
  max_rate?: number;
  tutor_gender?: string;
  // "vi" | "en" — bot tự nhận diện từ tin nhắn PH (detectLanguage), gửi kèm mỗi lượt để
  // agent mirror đúng ngôn ngữ trả lời (không chỉ suy luận từ tin nhắn cuối).
  preferred_language?: 'vi' | 'en';
  pending_reopen_choice?: boolean;
  refining_alternate_search?: boolean;
}

/** Body cho POST /api/v1/agent — hội thoại CÓ LLM (channel chọn persona). Stateless: bot tự
 * giữ history/context/shown_tutors (Redis) và gửi lại mỗi lượt, xem tutora-ai::run_agent. */
export interface AgentChatRequestBody {
  history: AgentHistoryMessage[];
  message: string;
  channel: 'zalo' | 'web';
  context?: AgentChatContext;
  shown_tutors?: AgentShownTutor[];
}

/** Slot mới agent rút được lượt này — merge vào agentCtx, gửi lại lượt sau. KHÔNG có
 * tutor_gender/preferred_language (2 field đó bot tự set, agent không patch). */
export interface AgentContextPatch {
  subject_id?: number;
  grade_level_id?: number;
  goal?: string;
  preferences?: string;
  asked_preferences?: boolean;
  min_rate?: number;
  max_rate?: number;
  teaching_mode?: string;
  city?: string;
  pending_reopen_choice?: boolean;
  refining_alternate_search?: boolean;
}

export interface AgentChatResponseBody {
  reply: string;
  tutors: AgentTutorItem[];
  handoff_to_booking: boolean;
  reopen_mini_app: boolean;
  reopen_mini_app_fresh: boolean;
  awaiting_confirmation: boolean;
  confirm_type?: string | null;
  suggestions: string[];
  context_patch?: AgentContextPatch | null;
}
