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
  findTutorStep?: 'awaiting_subject' | 'awaiting_grade' | 'awaiting_gender' | 'awaiting_criteria' | 'awaiting_confirm';
  subject?: string;
  grade?: string;
  tutorGender?: 'male' | 'female' | 'any';
  personalCriteria?: string;
}

export type OnboardingStep =
  | 'language'
  | 'subject'
  | 'grade'
  | 'mode'
  | 'area'
  | 'purpose'
  | 'done';
