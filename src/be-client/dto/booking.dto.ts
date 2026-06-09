import { LessonDto } from './lesson.dto';

export interface BookingDto {
  bookingId: number;
  status: string;
  paymentStatus: string;
  escrowStatus: string;
  sessionCount: number;
  sessionsRemaining: number;
  depositAmount: number;
  remainingAmount: number;
  finalPrice: number;
  schedule: string;
  startDate?: string;
}

export interface BookingWithLessonsDto extends BookingDto {
  lessons: LessonDto[];
}

export interface CreateBookingPayload {
  parentId: string;
  studentId?: string;
  tutorId: string;
  subjectId: number;
  sessionCount: number;
  schedule: string;
  locationDistrict: string;
  teachingMode: string;
  depositAmount: number;
}

export interface CancellationResult {
  refundAmount: number;
  refundStatus: string;
  escrowStatus: string;
}
