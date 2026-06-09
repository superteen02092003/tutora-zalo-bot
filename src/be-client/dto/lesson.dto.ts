export interface LessonDto {
  lessonId: number;
  bookingId: number;
  scheduledStart: string;
  scheduledEnd: string;
  status: string;
  isTutorPresent?: boolean;
  isStudentPresent?: boolean;
  isMakeup: boolean;
}

export interface RescheduleResult {
  lessonId: number;
  status: string;
  requiresTutorApproval: boolean;
}
