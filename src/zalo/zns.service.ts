import { Injectable } from '@nestjs/common';
import { BookingDto, LessonDto } from '../be-client/dto';
import { ZaloService } from './zalo.service';

export interface LessonReportDto {
  lessonId: number;
  lessonContent: string;
  homework: string;
  tutorNotes?: string;
}

@Injectable()
export class ZnsService {
  constructor(private readonly zaloService: ZaloService) {}

  async sendBookingConfirmed(
    zaloUserId: string,
    booking: BookingDto,
    tutorName: string,
  ): Promise<void> {
    await this.zaloService.sendText(
      zaloUserId,
      `Đặt lịch thành công với ${tutorName}. Mã booking: ${booking.bookingId}.`,
    );
  }

  async sendSessionReminder(
    zaloUserId: string,
    lesson: LessonDto,
    hoursAhead: 24 | 1,
  ): Promise<void> {
    await this.zaloService.sendText(
      zaloUserId,
      `Nhắc lịch: buổi học #${lesson.lessonId} sẽ bắt đầu trong ${hoursAhead} giờ.`,
    );
  }

  async sendRescheduleConfirmed(
    zaloUserId: string,
    lesson: LessonDto,
  ): Promise<void> {
    await this.zaloService.sendText(
      zaloUserId,
      `Lịch học #${lesson.lessonId} đã được cập nhật sang ${lesson.scheduledStart}.`,
    );
  }

  async sendSessionReport(
    zaloUserId: string,
    report: LessonReportDto,
  ): Promise<void> {
    await this.zaloService.sendText(
      zaloUserId,
      `Báo cáo buổi học #${report.lessonId}: ${report.lessonContent}. Bài tập: ${report.homework}.`,
    );
  }

  async sendPayoutRequest(
    zaloUserId: string,
    amount: number,
    round: 'first' | 'final',
  ): Promise<void> {
    const roundLabel = round === 'first' ? 'đợt 1 (50%)' : 'đợt cuối (100%)';
    const autoReleaseNote =
      round === 'final' ? ' Nếu không có phản hồi trong 24 giờ, Tutora sẽ tự động giải ngân.' : '';
    await this.zaloService.sendQuickReply(
      zaloUserId,
      `Gia sư yêu cầu giải ngân ${roundLabel}, số tiền ${amount.toLocaleString('vi-VN')} VND.${autoReleaseNote}`,
      [
        { title: 'Đồng ý', payload: `payout_confirm:${round}` },
        { title: 'Khiếu nại', payload: `payout_dispute:${round}` },
      ],
    );
  }

  async sendRenewalReminder(
    zaloUserId: string,
    sessionsLeft: number,
  ): Promise<void> {
    await this.zaloService.sendQuickReply(
      zaloUserId,
      `Gói học còn ${sessionsLeft} buổi.`,
      [
        { title: 'Gia hạn', payload: 'renewal:extend' },
        { title: 'Đổi gia sư', payload: 'renewal:replace_tutor' },
      ],
    );
  }
}
