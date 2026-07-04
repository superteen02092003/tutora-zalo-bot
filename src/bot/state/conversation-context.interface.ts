import { MatchCriteria, TutorAvailabilitySlot } from '../../be-client/dto';

export interface ConversationContext {
  zaloUserId: string;
  preferredLanguage?: 'vi' | 'en';
  parentId?: string;
  selectedTutorId?: string;
  selectedTutorName?: string;
  subjectId?: number;
  gradeLevelId?: number;
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
  /** Tracks which grade group (cap1/cap2/cap3) was selected in step 2a */
  gradeGroup?: 'cap1' | 'cap2' | 'cap3';
  /** Stores the free-text requirement description from step 5 */
  freetextQuery?: string;
  /** Counts consecutive invalid (free-text) inputs during button-only steps */
  invalidInputCount?: number;
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
  // ── Agent hội thoại (tutora-ai stateless) ──
  // Lịch sử chat với agent (NestJS giữ, gửi kèm mỗi lượt). Giới hạn ~10 lượt gần nhất.
  agentHistory?: { role: 'user' | 'assistant'; content: string }[];
  // Gia sư agent vừa gợi ý -> để lượt sau agent trả lời "chi tiết gia sư A".
  agentShownTutors?: { tutor_id: string; name?: string }[];
  // Agent vừa hỏi xác nhận (đổi ngữ cảnh / booking) -> lượt sau là câu trả lời confirm.
  agentAwaitingConfirm?: 'context_change' | 'booking';
  findTutorStep?: 'awaiting_subject' | 'awaiting_grade' | 'awaiting_gender' | 'awaiting_criteria' | 'awaiting_confirm';
  subject?: string;
  grade?: string;
  tutorGender?: 'male' | 'female' | 'any';
  personalCriteria?: string;
}

export type OnboardingStep =
  | 'subject'      // step 1: subject button options
  | 'grade_group'  // step 2a: Cấp 1 / Cấp 2 / Cấp 3 buttons
  | 'grade'        // step 2b: specific grade buttons within group
  | 'mode'         // step 3: online / offline / both buttons
  | 'area'         // step 4: city buttons + free-text if "Tỉnh khác"
  | 'freetext'     // step 5: optional free-text description (can skip)
  | 'done';
