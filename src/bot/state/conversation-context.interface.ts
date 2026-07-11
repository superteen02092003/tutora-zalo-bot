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
}

export type OnboardingStep =
  | 'language'
  | 'subject'
  | 'grade'
  | 'mode'
  | 'area'
  | 'purpose'
  | 'done';
