import { MatchCriteria, TutorAvailabilitySlot } from '../../be-client/dto';
import {
  AgentHistoryMessage,
  AgentShownTutor,
} from '../../agent/agent-client.types';

export interface ConversationContext {
  zaloUserId: string;
  preferredLanguage?: 'vi' | 'en';
  parentId?: string;
  selectedTutorId?: string;
  selectedTutorName?: string;
  subjectId?: number;
  criteria?: MatchCriteria;
  selectedPackageSessionCount?: number;
  requiredSessionsPerWeek?: number;
  requiredSessionDurationHours?: number;
  selectedTutorAvailabilitySlots?: TutorAvailabilitySlot[];
  selectedTutorAvailabilityLoadedAt?: string;
  bookingStep?:
    | 'awaiting_schedule_confirm'
    | 'awaiting_schedule_input'
    | 'awaiting_schedule_confirmation';
  selectedSchedule?: string;
  pendingSchedule?: string;
  pendingBookingId?: number;
  paymentRetryCount?: number;
  onboardingStep?: OnboardingStep;
  // Set after payment confirmed — persists for the lifetime of the booking
  activeBookingId?: number;
  // Schedule management sub-flows
  activeFlow?: 'reschedule' | 'cancel' | 'dispute';
  rescheduleStep?: 'awaiting_new_time' | 'awaiting_confirm';
  pendingLessonId?: number;
  pendingRescheduleNewTime?: string;
  cancelStep?: 'awaiting_reason' | 'awaiting_confirm';
  cancelReason?: string;
  consecutiveUnknownCount?: number;
  botChatDisabled?: boolean;
  findTutorStep?:
    | 'awaiting_subject'
    | 'awaiting_grade'
    | 'awaiting_gender'
    | 'awaiting_criteria'
    | 'awaiting_confirm';
  subject?: string;
  grade?: string;
  tutorGender?: 'male' | 'female' | 'any';
  personalCriteria?: string;
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

export type OnboardingStep =
  | 'subject'
  | 'grade'
  | 'mode'
  | 'area'
  | 'purpose'
  | 'done';
