export type BeEventType =
  | 'payment_confirmed'
  | 'payment_expired'
  | 'first_session_started'
  | 'session_reminder_24h'
  | 'session_reminder_1h'
  | 'session_report_ready'
  | 'tutor_accepted'
  | 'tutor_noshow'
  | 'tutor_declined'
  | 'reschedule_accepted'
  | 'reschedule_rejected'
  | 'parent_unresponsive'
  | 'payout_ready'
  | 'renewal_reminder';

export interface BeEventDto {
  eventId: string;
  occurredAt: string;
  dedupeKey: string;
  eventType: BeEventType;
  zaloUserId: string;
  payload: BeEventPayload;
}

export type BeEventPayload =
  | PaymentEventPayload
  | FirstSessionStartedPayload
  | SessionReminderPayload
  | SessionReportReadyPayload
  | RescheduleAcceptedPayload
  | RescheduleRejectedPayload
  | TutorAcceptedPayload
  | TutorDeclinedPayload
  | TutorNoShowPayload
  | ParentUnresponsivePayload
  | PayoutReadyPayload
  | RenewalReminderPayload;

export interface PaymentEventPayload {
  bookingId: number;
  amount: number;
}

export interface FirstSessionStartedPayload {
  lessonId: number;
  bookingId: number;
}

export interface SessionReminderPayload {
  lessonId: number;
  bookingId: number;
  scheduledStart: string;
  scheduledEnd: string;
  tutorName: string;
}

export interface SessionReportReadyPayload {
  lessonId: number;
  lessonContent: string;
  homework: string;
  tutorNotes?: string;
}

export interface RescheduleAcceptedPayload {
  lessonId: number;
  newStart: string;
  newEnd: string;
  role: 'parent' | 'tutor';
}

export interface RescheduleRejectedPayload {
  lessonId: number;
  reason?: string;
}

export interface TutorAcceptedPayload {
  bookingId: number;
  tutorName: string;
}

export interface TutorDeclinedPayload {
  bookingId: number;
  tutorName: string;
  reason?: string;
}

export interface TutorNoShowPayload {
  lessonId: number;
  scheduledStart: string;
}

export interface ParentUnresponsivePayload {
  bookingId: number;
  reminderCount: 1 | 2 | 3;
}

export interface PayoutReadyPayload {
  bookingId: number;
  round: 'first' | 'final';
  amount: number;
}

export interface RenewalReminderPayload {
  bookingId: number;
  sessionsLeft: number;
  tutorName: string;
}
