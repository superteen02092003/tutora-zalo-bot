import { MatchCriteria, TutorAvailabilitySlot } from '../../be-client/dto';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationContext {
  zaloUserId: string;
  chatHistory?: ChatMessage[];
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
  findTutorStep?: 'awaiting_subject' | 'awaiting_grade' | 'awaiting_gender' | 'awaiting_criteria' | 'awaiting_confirm';
  subject?: string;
  grade?: string;
  tutorGender?: 'male' | 'female' | 'any';
  personalCriteria?: string;
  // ── AI matching qua FastAPI agent (tutora-ai) ──
  // agentCtx: slot hội thoại agent trả về qua context_patch — merge GENERIC (mọi key
  // non-null đè vào), bot không diễn giải từng field → Python thêm slot mới không phải sửa bot.
  // Key đã biết: subject_id, grade_level_id, goal, preferences, asked_preferences.
  agentCtx?: Record<string, unknown>;
  // Gia sư agent đã gợi ý (để agent hiểu "chi tiết cô A" các lượt sau).
  agentShownTutors?: { tutor_id: string; name?: string }[];
  // ── Welcome-back / session-memory (PH quay lại sau gap dài — xem message.handler.ts
  // shouldWelcomeBack/startWelcomeBack) ──
  // true = lượt trước VỪA hỏi "tiếp tục tìm như cũ hay tìm mới?" — lượt này đọc câu trả
  // lời để rẽ nhánh (handleWelcomeBackReply), KHÔNG xử lý như tin nhắn thường.
  awaitingWelcomeBack?: boolean;
  // Facts trích từ phiên CŨ (agent tóm tắt qua /api/v1/summarize-session) — dùng để PH
  // chọn "tiếp tục" thì tổng hợp lại thành 1 câu tìm luôn, không phải kể lại từ đầu.
  sessionMemory?: {
    subject?: string | null;
    grade?: number | null;
    goal?: string | null;
    budgetMax?: number | null;
    preferences?: string | null;
    tutorsShown: string[];
  };
}

export type OnboardingStep =
  | 'subject'
  | 'grade'
  | 'mode'
  | 'area'
  | 'purpose'
  | 'done';
