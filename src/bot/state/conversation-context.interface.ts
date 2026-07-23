import { MatchCriteria, TutorAvailabilitySlot } from '../../be-client/dto';

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
  // agentCtx: tiêu chí tìm gia sư gần nhất từ Mini App form (search-direct, KHÔNG qua
  // chat/LLM) — chỉ dùng để prefill lại form khi PH mở lại Mini App sửa tiêu chí (xem
  // MiniAppController.getPrefill). Key: subject_id, grade_level_id, goal, preferences,
  // min_rate, max_rate, teaching_mode, city, tutor_gender, asked_preferences.
  agentCtx?: Record<string, unknown>;
}

export type OnboardingStep =
  | 'subject'
  | 'grade'
  | 'mode'
  | 'area'
  | 'purpose'
  | 'done';
