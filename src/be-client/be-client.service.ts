import { Injectable } from '@nestjs/common';
import { MOCK_TUTORS } from './mock/tutors.mock';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosRequestConfig } from 'axios';
import { lastValueFrom } from 'rxjs';
import {
  BookingDto,
  BookingWithLessonsDto,
  CancellationResult,
  CreateBookingPayload,
  CreateDisputePayload,
  CreateDisputeResult,
  MatchCriteria,
  MatchTutorsResult,
  PaymentQrDto,
  RescheduleResult,
  SubjectDto,
  TutorAvailabilityDto,
  TutorAvailabilitySlot,
  UserDto,
} from './dto';

@Injectable()
export class BeClientService {
  private readonly baseUrl: string;
  private readonly internalKey?: string;
  private readonly stubMode: boolean;

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    this.baseUrl = config.get<string>('backend.baseUrl')!;
    this.internalKey = config.get<string>('backend.apiKey');
    this.stubMode = config.get<boolean>('stubMode', true);
  }

  async getTutorAvailability(tutorId: string, tutorName: string): Promise<TutorAvailabilityDto> {
    if (!this.stubMode) {
      return this.get<TutorAvailabilityDto>(`/internal/tutors/${tutorId}/availability`);
    }

    const demoSlots: Record<string, TutorAvailabilitySlot[]> = {
      'tutor-001': [
        { dayOfWeek: 1, startHour: 17, endHour: 19 },
        { dayOfWeek: 3, startHour: 17, endHour: 19 },
        { dayOfWeek: 5, startHour: 19, endHour: 21 },
      ],
      'tutor-002': [
        { dayOfWeek: 1, startHour: 19, endHour: 21 },
        { dayOfWeek: 3, startHour: 19, endHour: 21 },
        { dayOfWeek: 5, startHour: 19, endHour: 21 },
      ],
      'tutor-003': [
        { dayOfWeek: 2, startHour: 17, endHour: 20 },
        { dayOfWeek: 4, startHour: 17, endHour: 20 },
        { dayOfWeek: 6, startHour: 17, endHour: 20 },
      ],
    };
    const slots =
      demoSlots[tutorId] ??
      [
        { dayOfWeek: 1, startHour: 17, endHour: 19 },
        { dayOfWeek: 3, startHour: 17, endHour: 19 },
      ];
    return { tutorId, tutorName, slots };
  }

  async getSubjects(): Promise<SubjectDto[]> {
    if (!this.stubMode) {
      return this.get<SubjectDto[]>('/internal/subjects');
    }

    return [
      { subjectId: 1, name: 'Toán Học' },
      { subjectId: 2, name: 'Tiếng Anh' },
      { subjectId: 3, name: 'Vật Lý' },
      { subjectId: 4, name: 'Hóa Học' },
      { subjectId: 5, name: 'Ngữ văn' },
      { subjectId: 6, name: 'Sinh Học' },
      { subjectId: 7, name: 'Lịch Sử' },
      { subjectId: 8, name: 'Địa Lý' },
      { subjectId: 9, name: 'Tin Học' },
      { subjectId: 10, name: 'IELTS' },
    ];
  }

  async getUserByZaloId(zaloId: string): Promise<UserDto | null> {
    if (!this.stubMode) {
      return this.getNullable<UserDto>(`/internal/users/by-zalo/${zaloId}`);
    }

    // TODO: remove stub when BE implements GET /internal/users/by-zalo/:zaloId
    return null;
  }

  async upsertZaloLead(
    zaloUserId: string,
    fullName = 'Zalo Parent',
    avatarUrl?: string,
  ): Promise<UserDto> {
    if (!this.stubMode) {
      return this.post<UserDto>('/internal/users/zalo-lead', {
        zaloUserId,
        fullName,
        avatarUrl,
      });
    }

    // TODO: remove stub when BE implements POST /internal/users/zalo-lead
    return {
      userId: `parent-${zaloUserId}`,
      zaloUserId,
      fullName,
      primaryRole: 'parent',
      status: 1,
    };
  }

  async getActiveBookingByZaloId(zaloId: string): Promise<BookingDto | null> {
    if (!this.stubMode) {
      return this.getNullable<BookingDto>(
        `/internal/users/by-zalo/${zaloId}/active-booking`,
      );
    }

    // TODO: remove stub when BE implements GET /internal/users/by-zalo/:zaloId/active-booking
    return null;
  }

  async getMatchedTutors(criteria: MatchCriteria): Promise<MatchTutorsResult> {
    if (!this.stubMode) {
      return this.get<MatchTutorsResult>('/internal/tutors/match', {
        params: criteria,
      });
    }

    let candidates = [...MOCK_TUTORS];

    // Filter by subject
    if (criteria.subject) {
      const subjectLower = criteria.subject.toLowerCase();
      candidates = candidates.filter((t) =>
        t.subjects?.some((s: string) => s.toLowerCase().includes(subjectLower)),
      );
    }

    // Filter by grade
    if (criteria.grade) {
      candidates = candidates.filter((t) =>
        t.grades?.includes(criteria.grade),
      );
    }

    // Filter by gender preference
    if (criteria.genderPreference && criteria.genderPreference !== 'any') {
      candidates = candidates.filter((t) => t.gender === criteria.genderPreference);
    }

    // Sort: premium > pro > standard, then by rating
    const rankOrder: Record<string, number> = { premium: 3, pro: 2, standard: 1 };
    candidates.sort((a, b) => {
      const rankDiff = (rankOrder[b.subscriptionType] ?? 0) - (rankOrder[a.subscriptionType] ?? 0);
      return rankDiff !== 0 ? rankDiff : b.averageRating - a.averageRating;
    });

    return {
      subjectId: 1,
      candidates: candidates.slice(0, 5),
    };
  }

  async createBooking(payload: CreateBookingPayload): Promise<BookingDto> {
    if (!this.stubMode) {
      return this.post<BookingDto>('/internal/bookings', payload);
    }

    // TODO: remove stub when BE implements POST /internal/bookings
    return {
      bookingId: 1,
      status: 'pending_payment',
      paymentStatus: 'pending',
      escrowStatus: 'pending',
      sessionCount: 8,
      sessionsRemaining: 8,
      depositAmount: 400000,
      remainingAmount: 1200000,
      finalPrice: 1600000,
      schedule: '[]',
    };
  }

  async getBooking(bookingId: number): Promise<BookingWithLessonsDto> {
    if (!this.stubMode) {
      return this.get<BookingWithLessonsDto>(`/internal/bookings/${bookingId}`);
    }

    // TODO: remove stub when BE implements GET /internal/bookings/:id
    return {
      bookingId,
      status: 'booked',
      paymentStatus: 'paid',
      escrowStatus: 'held',
      sessionCount: 8,
      sessionsRemaining: 8,
      depositAmount: 400000,
      remainingAmount: 1200000,
      finalPrice: 1600000,
      schedule: '[]',
      lessons: [],
    };
  }

  async cancelBooking(
    bookingId: number,
    cancelledBy: string,
    reason: string,
  ): Promise<CancellationResult> {
    if (!this.stubMode) {
      return this.post<CancellationResult>(
        `/internal/bookings/${bookingId}/cancel`,
        { cancelledBy, reason },
      );
    }

    // TODO: remove stub when BE implements POST /internal/bookings/:id/cancel
    return {
      refundAmount: 400000,
      refundStatus: 'pending',
      escrowStatus: 'refund_pending',
    };
  }

  async rescheduleLesson(
    lessonId: number,
    newStart: Date,
    newEnd: Date,
    requestedBy: string,
    reason?: string,
  ): Promise<RescheduleResult> {
    if (!this.stubMode) {
      return this.post<RescheduleResult>(
        `/internal/lessons/${lessonId}/reschedule`,
        {
          newStart: newStart.toISOString(),
          newEnd: newEnd.toISOString(),
          requestedBy,
          reason,
        },
      );
    }

    // TODO: remove stub when BE implements POST /internal/lessons/:lessonId/reschedule
    return {
      lessonId,
      status: 'pending_tutor_approval',
      requiresTutorApproval: true,
    };
  }

  async respondReschedule(
    lessonId: number,
    tutorId: string,
    accept: boolean,
    reason?: string,
  ): Promise<void> {
    if (!this.stubMode) {
      await this.post<void>(
        `/internal/lessons/${lessonId}/reschedule/respond`,
        {
          tutorId,
          accept,
          reason,
        },
      );
      return;
    }

    // TODO: remove stub when BE implements POST /internal/lessons/:lessonId/reschedule/respond
  }

  async createBookingQR(bookingId: number): Promise<PaymentQrDto> {
    if (!this.stubMode) {
      return this.post<PaymentQrDto>(
        `/internal/payments/booking/${bookingId}/create-qr`,
        {},
      );
    }

    // TODO: remove stub when BE implements POST /internal/payments/booking/:bookingId/create-qr
    return {
      qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?data=tutora-booking-${bookingId}`,
      orderCode: bookingId,
      amount: 400000,
      expiredAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  async releasePayout(
    bookingId: number,
    round: 'first' | 'final',
    confirmedByParent: boolean,
  ): Promise<void> {
    if (!this.stubMode) {
      await this.post<void>(`/internal/payouts/booking/${bookingId}/release`, {
        round,
        confirmedByParent,
      });
      return;
    }

    // TODO: remove stub when BE implements POST /internal/payouts/booking/:bookingId/release
  }

  async createDispute(
    payload: CreateDisputePayload,
  ): Promise<CreateDisputeResult> {
    if (!this.stubMode) {
      return this.post<CreateDisputeResult>('/internal/disputes', payload);
    }

    // TODO: remove stub when BE implements POST /internal/disputes
    return {
      disputeId: 1,
      status: 'open',
    };
  }

  private async get<T>(path: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await lastValueFrom(
      this.http.get<T>(this.url(path), this.withAuth(config)),
    );
    return response.data;
  }

  private async getNullable<T>(
    path: string,
    config?: AxiosRequestConfig,
  ): Promise<T | null> {
    try {
      return await this.get<T>(path, config);
    } catch (error: unknown) {
      if (this.isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  private async post<T>(
    path: string,
    body: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const response = await lastValueFrom(
      this.http.post<T>(this.url(path), body, this.withAuth(config)),
    );
    return response.data;
  }

  private withAuth(config: AxiosRequestConfig = {}): AxiosRequestConfig {
    return {
      ...config,
      headers: {
        ...config.headers,
        'X-Internal-Key': this.internalKey ?? '',
      },
    };
  }

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}${path}`;
  }

  private isNotFound(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'response' in error &&
      (error as { response?: { status?: number } }).response?.status === 404
    );
  }
}
