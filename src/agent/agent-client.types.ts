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

export interface AgentResponseBody {
  reply: string;
  tutors: AgentTutorItem[];
  handoff_to_booking: boolean;
  awaiting_confirmation: boolean;
  confirm_type?: 'context_change' | 'booking' | null;
  suggestions: string[];
  /** Slot mới rút được lượt này — merge generic vào agentCtx rồi gửi lại lượt sau. */
  context_patch?: AgentChatContext | null;
}
