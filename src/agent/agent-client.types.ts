/**
 * Types mirror schema của FastAPI AI agent (tutora-ai: app/models/schemas.py).
 * Giữ snake_case đúng như FastAPI nhận/trả — KHÔNG đổi sang camelCase ở tầng wire.
 */

export interface AgentHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Context slot hội thoại — bot chỉ persist và gửi lại, KHÔNG diễn giải từng field.
 * Dùng Record mở để Python thêm slot mới (vd asked_preferences) mà bot không phải sửa.
 * Các key đã biết: subject_id, grade_level_id, teaching_mode, city, goal, preferences,
 * asked_preferences.
 */
export type AgentChatContext = Record<string, unknown>;

export interface AgentShownTutor {
  tutor_id: string;
  name?: string;
}

export interface AgentRequestBody {
  history: AgentHistoryMessage[];
  message: string;
  channel: 'zalo' | 'web';
  context: AgentChatContext;
  shown_tutors: AgentShownTutor[];
}

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
  completedHours?: number | null;
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

export interface AgentResponseBody {
  reply: string;
  tutors: AgentTutorItem[];
  handoff_to_booking: boolean;
  awaiting_confirmation: boolean;
  confirm_type?: 'context_change' | 'booking' | null;
  suggestions: string[];
  /** Slot mới rút được lượt này — merge generic vào agentCtx rồi gửi lại lượt sau. */
  context_patch?: AgentChatContext | null;
  /** PH muốn đổi tiêu chí tìm gia sư giữa chat -> gửi lại nút mở Mini App (điền sẵn dữ
   * liệu cũ từ agentCtx) thay vì tiếp tục hỏi qua chat. */
  reopen_mini_app?: boolean;
  /** true = PH muốn NHU CẦU KHÁC HẲN — Mini App KHÔNG được auto-skip qua kết quả cũ bằng
   * prefill, phải để PH tự điền lại. Xem MiniAppButtonService.sendSearchButton. */
  reopen_mini_app_fresh?: boolean;
}

/** Body cho POST /api/v1/summarize-session — tóm tắt phiên chat CŨ khi PH quay lại sau gap
 * dài (welcome-back), xem tutora-ai/app/services/session_memory.py. */
export interface SummarizeSessionRequestBody {
  history: AgentHistoryMessage[];
  shown_tutors: AgentShownTutor[];
}

export interface SessionMemoryBody {
  subject?: string | null;
  grade?: number | null;
  goal?: string | null;
  budget_max?: number | null;
  preferences?: string | null;
  tutors_shown: string[];
}

export interface SummarizeSessionResponseBody {
  recap: string;
  memory: SessionMemoryBody;
  has_pending_search: boolean;
}
