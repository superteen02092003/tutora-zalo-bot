/**
 * Types mirror schema của FastAPI AI agent (tutora-ai: app/models/schemas.py).
 * Giữ snake_case đúng như FastAPI nhận/trả — KHÔNG đổi sang camelCase ở tầng wire.
 *
 * Chỉ còn search-direct — chat()/summarize-session đã bỏ 2026-07-19 cùng AgentMatchingFlow.
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
