export type ParsedIntentName =
  | 'book_tutor'
  | 'reschedule'
  | 'cancel'
  | 'check_status'
  | 'general_question'
  | 'unknown';

export interface ParsedIntent {
  intent: ParsedIntentName;
  confidence: number;
  entities: Record<string, unknown>;
}

export interface ParsedScheduleSession {
  dayOfWeek: number;
  startHour: number;
  endHour: number;
}

export interface ParsedSchedule {
  sessions: ParsedScheduleSession[];
}
