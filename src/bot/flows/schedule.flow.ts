import { Injectable, Logger } from '@nestjs/common';
import { BeClientService } from '../../be-client/be-client.service';
import { ZaloService } from '../../zalo/zalo.service';
import { ZnsService } from '../../zalo/zns.service';
import { ConversationStateService } from '../state/conversation-state.service';

const LESSON_DURATION_MINUTES = 90;

@Injectable()
export class ScheduleFlow {
  private readonly logger = new Logger(ScheduleFlow.name);

  constructor(
    private readonly beClient: BeClientService,
    private readonly state: ConversationStateService,
    private readonly zalo: ZaloService,
    private readonly zns: ZnsService,
  ) {}

  // ─── Reschedule ────────────────────────────────────────────────────────────

  async initiateReschedule(zaloUserId: string): Promise<void> {
    const context = await this.state.getContext(zaloUserId);

    if (!context.activeBookingId) {
      await this.zalo.sendText(zaloUserId, 'Bạn chưa có lịch học nào đang hoạt động.');
      return;
    }

    const booking = await this.beClient.getBooking(context.activeBookingId);
    const upcoming = booking.lessons.find((l) => l.status !== 'completed');

    if (!upcoming) {
      await this.zalo.sendText(zaloUserId, 'Không tìm thấy buổi học sắp tới để đổi lịch.');
      return;
    }

    await this.state.updateContext(zaloUserId, {
      activeFlow: 'reschedule',
      rescheduleStep: 'awaiting_new_time',
      pendingLessonId: upcoming.lessonId,
    });

    const currentTime = new Date(upcoming.scheduledStart).toLocaleString('vi-VN', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    await this.zalo.sendText(
      zaloUserId,
      `Buổi học hiện tại: ${currentTime}.\n\nVui lòng nhập thời gian mới (định dạng DD/MM HH:mm, ví dụ: 25/06 19:00).`,
    );
  }

  async handleRescheduleInput(zaloUserId: string, text: string): Promise<void> {
    const parsed = this.parseDateText(text);

    if (!parsed) {
      await this.zalo.sendText(
        zaloUserId,
        'Mình chưa hiểu thời gian bạn nhập. Vui lòng nhập theo định dạng DD/MM HH:mm (ví dụ: 25/06 19:00).',
      );
      return;
    }

    const newTimeStr = parsed.toLocaleString('vi-VN', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    await this.state.updateContext(zaloUserId, {
      rescheduleStep: 'awaiting_confirm',
      pendingRescheduleNewTime: parsed.toISOString(),
    });

    await this.zalo.sendQuickReply(
      zaloUserId,
      `Đổi lịch sang: ${newTimeStr}. Bạn xác nhận?`,
      [
        { title: 'Xác nhận', payload: 'reschedule_confirm' },
        { title: 'Hủy bỏ', payload: 'reschedule_abort' },
      ],
    );
  }

  async confirmReschedule(zaloUserId: string): Promise<void> {
    const context = await this.state.getContext(zaloUserId);

    if (!context.pendingLessonId || !context.pendingRescheduleNewTime) {
      await this.zalo.sendText(zaloUserId, 'Thông tin đổi lịch không đầy đủ. Vui lòng thử lại.');
      await this.clearActiveFlow(zaloUserId);
      return;
    }

    const newStart = new Date(context.pendingRescheduleNewTime);
    const newEnd = new Date(newStart.getTime() + LESSON_DURATION_MINUTES * 60 * 1000);

    const result = await this.beClient.rescheduleLesson(
      context.pendingLessonId,
      newStart,
      newEnd,
      context.parentId ?? zaloUserId,
    );

    await this.clearActiveFlow(zaloUserId);

    if (result.requiresTutorApproval) {
      await this.zalo.sendText(
        zaloUserId,
        'Yêu cầu đổi lịch đã được gửi đến gia sư. Bạn sẽ nhận thông báo khi gia sư phản hồi.',
      );
    } else {
      await this.zns.sendRescheduleConfirmed(zaloUserId, {
        lessonId: context.pendingLessonId,
        bookingId: context.activeBookingId ?? 0,
        scheduledStart: newStart.toISOString(),
        scheduledEnd: newEnd.toISOString(),
        status: 'rescheduled',
        isMakeup: true,
      });
    }
  }

  async abortReschedule(zaloUserId: string): Promise<void> {
    await this.clearActiveFlow(zaloUserId);
    await this.zalo.sendText(zaloUserId, 'Đã hủy yêu cầu đổi lịch.');
  }

  // ─── Cancel ────────────────────────────────────────────────────────────────

  async initiateCancel(zaloUserId: string): Promise<void> {
    const context = await this.state.getContext(zaloUserId);

    if (!context.activeBookingId) {
      await this.zalo.sendText(zaloUserId, 'Bạn chưa có lịch học nào đang hoạt động.');
      return;
    }

    await this.state.updateContext(zaloUserId, {
      activeFlow: 'cancel',
      cancelStep: 'awaiting_reason',
    });

    await this.zalo.sendQuickReply(
      zaloUserId,
      'Lý do hủy lịch?',
      [
        { title: 'Sai lịch', payload: 'cancel_reason:schedule_conflict' },
        { title: 'Chất lượng', payload: 'cancel_reason:quality' },
        { title: 'Lý do khác', payload: 'cancel_reason:other' },
      ],
    );
  }

  async handleCancelReason(zaloUserId: string, reason: string): Promise<void> {
    await this.state.updateContext(zaloUserId, {
      cancelStep: 'awaiting_confirm',
      cancelReason: reason,
    });

    await this.zalo.sendQuickReply(
      zaloUserId,
      'Xác nhận hủy lịch? Tiền hoàn sẽ được xử lý theo chính sách của Tutora.',
      [
        { title: 'Xác nhận hủy', payload: 'cancel_confirm' },
        { title: 'Giữ nguyên', payload: 'cancel_abort' },
      ],
    );
  }

  async confirmCancel(zaloUserId: string): Promise<void> {
    const context = await this.state.getContext(zaloUserId);

    if (!context.activeBookingId) {
      await this.clearActiveFlow(zaloUserId);
      return;
    }

    const result = await this.beClient.cancelBooking(
      context.activeBookingId,
      context.parentId ?? zaloUserId,
      context.cancelReason ?? 'other',
    );

    await this.clearActiveFlow(zaloUserId);
    await this.zalo.sendText(
      zaloUserId,
      `Lịch học đã được hủy. Số tiền hoàn: ${result.refundAmount.toLocaleString('vi-VN')} VND (${result.refundStatus}).`,
    );
  }

  async abortCancel(zaloUserId: string): Promise<void> {
    await this.clearActiveFlow(zaloUserId);
    await this.zalo.sendText(zaloUserId, 'Đã giữ nguyên lịch học.');
  }

  // ─── Dispute ───────────────────────────────────────────────────────────────

  async initiateDispute(zaloUserId: string): Promise<void> {
    const context = await this.state.getContext(zaloUserId);

    if (!context.activeBookingId) {
      await this.zalo.sendText(zaloUserId, 'Bạn chưa có lịch học nào đang hoạt động.');
      return;
    }

    await this.state.updateContext(zaloUserId, { activeFlow: 'dispute' });
    await this.zalo.sendText(
      zaloUserId,
      'Vui lòng mô tả vấn đề bạn đang gặp phải để Tutora hỗ trợ.',
    );
  }

  async submitDispute(zaloUserId: string, reason: string): Promise<void> {
    const context = await this.state.getContext(zaloUserId);

    await this.beClient.createDispute({
      bookingId: context.activeBookingId,
      createdBy: context.parentId ?? zaloUserId,
      reason,
      disputeType: 'general',
    });

    await this.clearActiveFlow(zaloUserId);
    await this.zalo.sendText(
      zaloUserId,
      'Khiếu nại của bạn đã được ghi nhận. Tutora sẽ xử lý trong vòng 24 giờ và thông báo cho bạn.',
    );
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async clearActiveFlow(zaloUserId: string): Promise<void> {
    await this.state.clearContextFields(zaloUserId, [
      'activeFlow',
      'rescheduleStep',
      'pendingLessonId',
      'pendingRescheduleNewTime',
      'cancelStep',
      'cancelReason',
    ]);
  }

  private parseDateText(text: string): Date | null {
    // Accept "DD/MM HH:mm" or "DD/MM/YYYY HH:mm"
    const match = text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s+(\d{1,2}):(\d{2})/);
    if (!match) return null;

    const [, day, month, year, hour, minute] = match;
    const y = year ? parseInt(year) : new Date().getFullYear();
    const date = new Date(y, parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));

    if (isNaN(date.getTime()) || date <= new Date()) return null;
    return date;
  }
}
