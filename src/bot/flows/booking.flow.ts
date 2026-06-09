import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BeClientService } from '../../be-client/be-client.service';
import { TutorAvailabilityDto, TutorCandidateDto } from '../../be-client/dto';
import { DeepSeekService } from '../../llm/deepseek.service';
import { ParsedSchedule } from '../../llm/llm.types';
import { CalendarImageService } from '../../zalo/calendar-image.service';
import { ZaloService } from '../../zalo/zalo.service';
import { ConversationState } from '../state/conversation-state.enum';
import { ConversationStateService } from '../state/conversation-state.service';

@Injectable()
export class BookingFlow {
  private readonly logger = new Logger(BookingFlow.name);
  private readonly appPublicUrl: string;
  private readonly zbsPaymentTemplateId: string;

  constructor(
    private readonly beClient: BeClientService,
    private readonly state: ConversationStateService,
    private readonly zalo: ZaloService,
    private readonly calendarImage: CalendarImageService,
    private readonly deepSeek: DeepSeekService,
    config: ConfigService,
  ) {
    this.appPublicUrl = config.get<string>('appPublicUrl', '');
    this.zbsPaymentTemplateId = config.get<string>('zbs.paymentTemplateId', '');
  }

  // ── Postback routing (deterministic, button clicks) ──────────────────────

  async handlePostback(zaloUserId: string, payload: string): Promise<void> {
    if (payload.startsWith('select_tutor:')) {
      await this.selectTutor(zaloUserId, payload.split(':')[1]);
      return;
    }
    if (payload === 'confirm_tutor_schedule') {
      await this.promptScheduleInput(zaloUserId);
      return;
    }
    if (payload === 'booking_schedule_confirm') {
      await this.confirmPendingSchedule(zaloUserId);
      return;
    }
    if (payload === 'booking_schedule_redo') {
      await this.promptScheduleInput(zaloUserId);
    }
  }

  // ── LLM-driven public entry points ───────────────────────────────────────

  // Called when LLM extracts: { action: 'select_tutor', tutorName: '...' }
  async selectTutorByName(zaloUserId: string, tutorName: string): Promise<void> {
    const candidates =
      await this.state.getMatchingCandidates<TutorCandidateDto>(zaloUserId);

    const normalize = (s: string) =>
      s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

    const normalized = normalize(tutorName);
    const selected = candidates.find((c) => {
      const full = normalize(c.fullName);
      const words = full.split(/\s+/);
      return (
        full === normalized ||
        normalized.includes(full) ||
        full.includes(normalized) ||
        words.some((w) => w === normalized)
      );
    });

    if (!selected) {
      await this.promptTutorSelection(zaloUserId);
      return;
    }
    await this.selectTutor(zaloUserId, selected.tutorId);
  }

  // Called when LLM extracts: { action: 'select_package', sessionCount: 12 }
  async selectPackageByCount(
    zaloUserId: string,
    sessionCount: 4 | 8 | 12,
  ): Promise<void> {
    await this.promptCurrentStep(zaloUserId);
  }

  // ── State helpers ─────────────────────────────────────────────────────────

  async promptCurrentStep(zaloUserId: string): Promise<void> {
    const context = await this.state.getContext(zaloUserId);

    if (context.bookingStep === 'awaiting_schedule_input') {
      await this.sendScheduleInputPrompt(zaloUserId, context);
      return;
    }

    if (context.selectedTutorId) {
      const tutorName = context.selectedTutorName ?? this.copy(context, {
        vi: 'gia sư đã chọn',
        en: 'the selected tutor',
      });
      await this.zalo.sendQuickReply(
        zaloUserId,
        this.copy(context, {
          vi: `Bạn đang chọn ${tutorName}. Bấm Đặt lịch để chọn khung giờ học phù hợp.`,
          en: `You are choosing ${tutorName}. Tap Book schedule to choose suitable time slots.`,
        }),
        [
          {
            title: this.isEnglish(context) ? 'Book schedule' : 'Đặt lịch',
            payload: 'confirm_tutor_schedule',
          },
        ],
      );
      return;
    }

    await this.promptTutorSelection(zaloUserId);
  }

  async promptTutorSelection(zaloUserId: string): Promise<void> {
    const candidates =
      await this.state.getMatchingCandidates<TutorCandidateDto>(zaloUserId);

    if (!candidates.length) {
      await this.zalo.sendText(
        zaloUserId,
        'Mình chưa có danh sách gia sư khả dụng. Để mình tìm lại cho bạn nhé.',
      );
      return;
    }

    const tutorNames = candidates
      .slice(0, 3)
      .map((c) => c.fullName)
      .join(', ');

    await this.zalo.sendText(
      zaloUserId,
      `Mình đã tìm được vài gia sư phù hợp: ${tutorNames}. Bạn có thể bấm chọn trên thẻ hoặc nhắn tên gia sư để mình đi tiếp.`,
    );
  }

  async startRenewal(zaloUserId: string): Promise<void> {
    const context = await this.state.getContext(zaloUserId);
    if (!context.selectedTutorId) {
      await this.zalo.sendText(
        zaloUserId,
        'Không tìm thấy thông tin gia sư trước đó. Mình sẽ tìm lại danh sách gia sư mới cho bạn.',
      );
      return;
    }
    const tutorName = context.selectedTutorName ?? 'gia sư hiện tại';
    await this.zalo.sendQuickReply(
      zaloUserId,
      `Gia hạn với ${tutorName}. Bạn muốn đăng ký gói mấy buổi?`,
      [
        { title: '4 buổi', payload: 'package:4' },
        { title: '8 buổi', payload: 'package:8' },
        { title: '12 buổi', payload: 'package:12' },
      ],
    );
  }

  // ── Private flow steps ────────────────────────────────────────────────────

  private async selectTutor(zaloUserId: string, tutorId: string): Promise<void> {
    const candidates =
      await this.state.getMatchingCandidates<TutorCandidateDto>(zaloUserId);
    const selected = candidates.find((c) => c.tutorId === tutorId);
    const context = await this.state.getContext(zaloUserId);

    if (!selected) {
      await this.zalo.sendText(
        zaloUserId,
        this.copy(context, {
          vi: 'Lựa chọn gia sư đã hết hạn. Mình sẽ tìm lại danh sách mới cho bạn.',
          en: 'This tutor selection has expired. I will search for a new tutor list for you.',
        }),
      );
      return;
    }

    const requirement = this.getTutorRequirement(selected);
    await this.state.updateContext(zaloUserId, {
      selectedTutorId: selected.tutorId,
      selectedTutorName: selected.fullName,
      selectedPackageSessionCount: requirement.totalSessions,
      requiredSessionsPerWeek: requirement.sessionsPerWeek,
      requiredSessionDurationHours: requirement.durationHours,
      bookingStep: 'awaiting_schedule_confirm',
    });

    await this.zalo.sendText(
      zaloUserId,
      this.copy(context, {
        vi: `Gia sư ${selected.fullName} yêu cầu dạy ${requirement.sessionsPerWeek} buổi/tuần, mỗi buổi ${requirement.durationHours} tiếng.`,
        en: `${selected.fullName} requires ${requirement.sessionsPerWeek} sessions per week, ${requirement.durationHours} hours per session.`,
      }),
    );

    const availability = await this.sendTutorCalendar(
      zaloUserId,
      selected.tutorId,
      selected.fullName,
    );
    if (availability) {
      await this.state.updateContext(zaloUserId, {
        selectedTutorAvailabilitySlots: availability.slots,
        selectedTutorAvailabilityLoadedAt: new Date().toISOString(),
      });
    }

    await this.zalo.sendQuickReply(
      zaloUserId,
      this.copy(context, {
        vi: 'Mời anh/chị xem lịch rảnh của gia sư. Nếu phù hợp, bấm Đặt lịch để chọn khung giờ học.',
        en: 'Please review the tutor availability. If it works for you, tap Book schedule to choose your time slots.',
      }),
      [
        {
          title: this.isEnglish(context) ? 'Book schedule' : 'Đặt lịch',
          payload: 'confirm_tutor_schedule',
        },
      ],
    );
  }

  async promptScheduleInput(zaloUserId: string): Promise<void> {
    const context = await this.state.getContext(zaloUserId);
    if (!context.selectedTutorId || !context.requiredSessionsPerWeek || !context.requiredSessionDurationHours) {
      await this.zalo.sendText(
        zaloUserId,
        this.copy(context, {
          vi: 'Thông tin gia sư chưa đủ. Mình sẽ tìm lại danh sách gia sư cho bạn.',
          en: 'Tutor information is incomplete. I will search for tutors again for you.',
        }),
      );
      await this.state.transitionState(zaloUserId, ConversationState.Onboarding);
      return;
    }

    if (!context.selectedTutorAvailabilityLoadedAt) {
      await this.zalo.sendText(
        zaloUserId,
        this.copy(context, {
          vi: 'Mình cập nhật lại lịch rảnh mới nhất của gia sư trước khi anh/chị chọn giờ nhé.',
          en: 'I will refresh the tutor’s latest availability before you choose time slots.',
        }),
      );
      const availability = await this.sendTutorCalendar(
        zaloUserId,
        context.selectedTutorId,
        context.selectedTutorName ?? 'Gia su',
      );
      if (availability) {
        await this.state.updateContext(zaloUserId, {
          selectedTutorAvailabilitySlots: availability.slots,
          selectedTutorAvailabilityLoadedAt: new Date().toISOString(),
        });
      }
    }

    await this.state.updateContext(zaloUserId, {
      bookingStep: 'awaiting_schedule_input',
    });
    await this.sendScheduleInputPrompt(zaloUserId, context);
  }

  async handleScheduleInput(zaloUserId: string, text: string): Promise<void> {
    const context = await this.state.getContext(zaloUserId);
    const requirement = {
      sessionsPerWeek: context.requiredSessionsPerWeek ?? 0,
      durationHours: context.requiredSessionDurationHours ?? 0,
    };
    if (context.selectedTutorId && !context.selectedTutorAvailabilityLoadedAt) {
      await this.zalo.sendText(
        zaloUserId,
        this.copy(context, {
          vi: 'Mình cập nhật lại lịch rảnh mới nhất của gia sư trước khi kiểm tra lịch anh/chị chọn nhé.',
          en: 'I will refresh the tutor’s latest availability before checking your selected schedule.',
        }),
      );
      const availability = await this.sendTutorCalendar(
        zaloUserId,
        context.selectedTutorId,
        context.selectedTutorName ?? 'Gia su',
      );
      if (availability) {
        await this.state.updateContext(zaloUserId, {
          selectedTutorAvailabilitySlots: availability.slots,
          selectedTutorAvailabilityLoadedAt: new Date().toISOString(),
          bookingStep: 'awaiting_schedule_input',
        });
      }
      await this.sendScheduleInputPrompt(zaloUserId, context);
      return;
    }
    const parsedByRules = this.parseScheduleWithRules(text);
    const parsed =
      parsedByRules.sessions.length > 0
        ? parsedByRules
        : (await this.deepSeek.parseSchedule(text, requirement)) ?? parsedByRules;
    this.logger.debug(
      `Parsed schedule for ${zaloUserId}: ${JSON.stringify(parsed)}`,
    );
    const validation = this.validateParsedSchedule(parsed, requirement, context);

    if (!validation.ok) {
      await this.zalo.sendText(zaloUserId, validation.message);
      await this.sendScheduleInputPrompt(zaloUserId, context);
      return;
    }
    const availabilitySlots = await this.getAvailabilitySlotsForValidation(
      zaloUserId,
      context,
    );
    const availabilityValidation = this.validateScheduleAvailability(
      validation.schedule.sessions,
      availabilitySlots,
      context,
    );
    if (!availabilityValidation.ok) {
      await this.zalo.sendText(zaloUserId, availabilityValidation.message);
      await this.sendScheduleInputPrompt(zaloUserId, context);
      return;
    }

    const schedule = JSON.stringify(validation.schedule);
    await this.state.updateContext(zaloUserId, {
      pendingSchedule: schedule,
      bookingStep: 'awaiting_schedule_confirmation',
    });
    await this.zalo.sendQuickReply(
      zaloUserId,
      this.copy(context, {
        vi: `Anh/chị xác nhận đặt lịch này nhé?\n${this.formatScheduleSummary(validation.schedule, context)}`,
        en: `Please confirm this schedule:\n${this.formatScheduleSummary(validation.schedule, context)}`,
      }),
      [
        {
          title: this.isEnglish(context) ? 'Confirm' : 'Xác nhận',
          payload: 'booking_schedule_confirm',
        },
        {
          title: this.isEnglish(context) ? 'Choose again' : 'Chọn lại',
          payload: 'booking_schedule_redo',
        },
      ],
    );
  }

  async confirmPendingSchedule(zaloUserId: string): Promise<void> {
    const context = await this.state.getContext(zaloUserId);
    if (!context.pendingSchedule) {
      await this.promptScheduleInput(zaloUserId);
      return;
    }

    await this.createBookingWithSchedule(zaloUserId, context.pendingSchedule);
  }

  private async createBookingWithSchedule(
    zaloUserId: string,
    schedule: string,
  ): Promise<void> {
    const context = await this.state.getContext(zaloUserId);

    if (
      !context.parentId ||
      !context.selectedTutorId ||
      !context.subjectId ||
      !context.selectedPackageSessionCount ||
      !context.criteria
    ) {
      await this.zalo.sendText(
        zaloUserId,
        this.copy(context, {
          vi: 'Thông tin đặt lịch chưa đủ. Mình sẽ bắt đầu lại bước tìm gia sư.',
          en: 'Booking information is incomplete. I will restart the tutor search step.',
        }),
      );
      await this.state.transitionState(zaloUserId, ConversationState.Onboarding);
      return;
    }

    const booking = await this.beClient.createBooking({
      parentId: context.parentId,
      tutorId: context.selectedTutorId,
      subjectId: context.subjectId,
      sessionCount: context.selectedPackageSessionCount,
      schedule,
      locationDistrict: context.criteria.locationDistrict,
      teachingMode: 'online',
      depositAmount: 400000,
    });

    await this.state.updateContext(zaloUserId, {
      selectedSchedule: schedule,
      pendingSchedule: undefined,
      pendingBookingId: booking.bookingId,
      paymentRetryCount: 0,
      bookingStep: undefined,
    });
    await this.state.transitionState(zaloUserId, ConversationState.BookingConfirm);

    const tutorName = context.selectedTutorName ?? 'Gia su';
    await this.zalo.sendText(
      zaloUserId,
      this.copy(context, {
        vi: `Đã gửi yêu cầu đến ${tutorName}. Tutora sẽ thông báo ngay khi gia sư xác nhận.`,
        en: `Your request has been sent to ${tutorName}. Tutora will notify you as soon as the tutor confirms.`,
      }),
    );
    this.scheduleSimulatedTutorAcceptance(
      zaloUserId,
      booking.bookingId,
      tutorName,
    );
  }

  private scheduleSimulatedTutorAcceptance(
    zaloUserId: string,
    bookingId: number,
    tutorName: string,
  ): void {
    const timer = setTimeout(() => {
      void this.sendSimulatedTutorAcceptedPayment(
        zaloUserId,
        bookingId,
        tutorName,
      );
    }, 5000);
    timer.unref?.();
  }

  private async sendSimulatedTutorAcceptedPayment(
    zaloUserId: string,
    bookingId: number,
    tutorName: string,
  ): Promise<void> {
    try {
      const qr = await this.beClient.createBookingQR(bookingId);
      await this.state.updateContext(zaloUserId, {
        paymentRetryCount: 0,
      });
      const sentZbsTemplate = await this.trySendZbsPaymentTemplate(
        zaloUserId,
        bookingId,
        tutorName,
        qr,
      );
      if (sentZbsTemplate) {
        return;
      }
      await this.zalo.sendText(
        zaloUserId,
        this.copy(await this.state.getContext(zaloUserId), {
          vi: `${tutorName} đã xác nhận lịch dạy. Anh/chị vui lòng thanh toán đặt cọc để hoàn tất đặt lịch.\nMã đơn: ${qr.orderCode}\nSố tiền: ${qr.amount.toLocaleString('vi-VN')} VND\nHết hạn: ${new Date(qr.expiredAt).toLocaleString('vi-VN')}`,
          en: `${tutorName} has confirmed the schedule. Please pay the deposit to complete the booking.\nOrder code: ${qr.orderCode}\nAmount: ${qr.amount.toLocaleString('vi-VN')} VND\nExpires at: ${new Date(qr.expiredAt).toLocaleString('vi-VN')}`,
        }),
      );
      try {
        await this.zalo.sendImage(zaloUserId, qr.qrCodeUrl);
      } catch (error) {
        this.logger.warn(
          `Failed to send QR image for booking ${bookingId}: ${String(error)}`,
        );
        await this.zalo.sendText(
          zaloUserId,
          this.copy(await this.state.getContext(zaloUserId), {
            vi: `Link QR thanh toán: ${qr.qrCodeUrl}`,
            en: `Payment QR link: ${qr.qrCodeUrl}`,
          }),
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to send simulated payment info for booking ${bookingId}: ${String(error)}`,
      );
      await this.zalo.sendText(
        zaloUserId,
        this.copy(await this.state.getContext(zaloUserId), {
          vi: `${tutorName} đã xác nhận lịch dạy, nhưng hiện chưa tạo được thông tin thanh toán. Anh/chị thử lại sau hoặc liên hệ CS Tutora.`,
          en: `${tutorName} has confirmed the schedule, but payment information could not be created yet. Please try again later or contact Tutora support.`,
        }),
      );
    }
  }

  private async trySendZbsPaymentTemplate(
    zaloUserId: string,
    bookingId: number,
    tutorName: string,
    qr: {
      orderCode: number;
      amount: number;
      expiredAt: string;
      qrCodeUrl: string;
    },
  ): Promise<boolean> {
    if (!this.zbsPaymentTemplateId) {
      return false;
    }

    try {
      await this.zalo.sendZbsTemplate(zaloUserId, this.zbsPaymentTemplateId, {
        customer_name: 'Anh/chi',
        order_code: String(qr.orderCode),
        payment_status: 'Cho thanh toan',
        cost: `${qr.amount.toLocaleString('vi-VN')} VND`,
        note: `Dat coc booking #${bookingId} voi ${tutorName}. Het han ${new Date(qr.expiredAt).toLocaleString('vi-VN')}`,
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `Falling back from ZBS payment template for booking ${bookingId}: ${String(error)}`,
      );
      return false;
    }
  }

  private async sendScheduleInputPrompt(
    zaloUserId: string,
    context: {
      preferredLanguage?: 'vi' | 'en';
      requiredSessionsPerWeek?: number;
      requiredSessionDurationHours?: number;
    },
  ): Promise<void> {
    const sessionsPerWeek = context.requiredSessionsPerWeek ?? 0;
    const durationHours = context.requiredSessionDurationHours ?? 0;
    const viDays =
      sessionsPerWeek >= 3 ? 'Thứ 2, Thứ 4 và Thứ 6' : 'Thứ 2 và Thứ 4';
    const enDays =
      sessionsPerWeek >= 3 ? 'Mon, Wed and Fri' : 'Mon and Wed';
    await this.zalo.sendText(
      zaloUserId,
      this.copy(context, {
        vi: `Mời anh/chị chọn lịch dạy phù hợp: ${sessionsPerWeek} buổi/tuần, mỗi buổi ${durationHours} tiếng.\nVí dụ: ${viDays} ${19}h-${19 + durationHours}h`,
        en: `Please choose a suitable schedule: ${sessionsPerWeek} sessions/week, ${durationHours} hours per session.\nExample: ${enDays} ${19}:00-${19 + durationHours}:00`,
      }),
    );
  }

  private async sendTutorCalendar(
    zaloUserId: string,
    tutorId: string,
    tutorName: string,
  ): Promise<TutorAvailabilityDto | undefined> {
    let availability: TutorAvailabilityDto | undefined;

    try {
      availability = await this.beClient.getTutorAvailability(tutorId, tutorName);
      const imageId = await this.calendarImage.generate(availability);
      if (this.appPublicUrl) {
        const imageUrl = `${this.appPublicUrl}/calendar/${imageId}.png`;
        this.logger.log(`Calendar image URL for ${tutorId}: ${imageUrl}`);
      }
      const image = this.calendarImage.getImage(imageId);
      if (!image) {
        throw new Error(`Calendar image ${imageId} expired before upload`);
      }
      const attachmentId = await this.zalo.uploadImageBuffer(image, `${tutorId}-calendar.png`);
      await this.zalo.sendUploadedImage(
        zaloUserId,
        attachmentId,
        `Lịch rảnh của ${tutorName}:`,
      );
      return availability;
    } catch (error) {
      this.logger.error(`Failed to send calendar for tutor ${tutorId}: ${String(error)}`);
      if (availability) {
        await this.zalo.sendText(
          zaloUserId,
          this.formatAvailabilityText(availability),
        );
      }
      // Non-fatal — continue booking flow without calendar
      return availability;
    }
  }
  private getTutorRequirement(tutor: TutorCandidateDto): {
    sessionsPerWeek: number;
    durationHours: number;
    totalSessions: number;
  } {
    const sessionsPerWeek = tutor.requiredSessionsPerWeek ?? 2;
    const durationHours = tutor.requiredSessionDurationHours ?? 2;
    return {
      sessionsPerWeek,
      durationHours,
      totalSessions: tutor.requiredTotalSessions ?? sessionsPerWeek * 4,
    };
  }

  private parseScheduleWithRules(text: string): ParsedSchedule {
    const normalized = this.normalizeText(text);
    const time = normalized.match(/(\d{1,2})\s*(?:(?:h|g|:)\s*(?:\d{2})?)?\s*-\s*(\d{1,2})\s*(?:h|g|:)\s*(?:\d{2})?/);
    if (!time) {
      return { sessions: [] };
    }

    const startHour = Number(time[1]);
    const endHour = Number(time[2]);
    const days = this.parseScheduleDays(normalized);

    return {
      sessions: days.map((dayOfWeek) => ({ dayOfWeek, startHour, endHour })),
    };
  }

  private validateParsedSchedule(
    parsed: ParsedSchedule,
    requirement: { sessionsPerWeek: number; durationHours: number },
    context: { preferredLanguage?: 'vi' | 'en' },
  ):
    | { ok: true; schedule: { sessions: Array<{ dayOfWeek: number; startHour: number; endHour: number }>; sessionsPerWeek: number; durationHours: number } }
    | { ok: false; message: string } {
    const sessions = parsed.sessions.filter(
      (session) =>
        session.dayOfWeek >= 1 &&
        session.dayOfWeek <= 7 &&
        session.startHour >= 0 &&
        session.endHour <= 24 &&
        session.endHour > session.startHour,
    );

    if (!sessions.length) {
      return {
        ok: false,
        message: this.copy(context, {
          vi: 'Mình chưa nhận ra lịch học. Anh/chị có thể nhập tự nhiên, ví dụ: Thứ 2 và Thứ 6 từ 17h đến 19h.',
          en: 'I could not understand the schedule. You can type naturally, for example: Monday and Friday from 5pm to 7pm.',
        }),
      };
    }

    const uniqueDays = new Set(sessions.map((session) => session.dayOfWeek));
    if (uniqueDays.size !== requirement.sessionsPerWeek) {
      return {
        ok: false,
        message: this.copy(context, {
          vi: `Gia sư yêu cầu ${requirement.sessionsPerWeek} buổi/tuần, nhưng anh/chị đang chọn ${uniqueDays.size} buổi. Anh/chị chọn lại giúp mình nhé.`,
          en: `The tutor requires ${requirement.sessionsPerWeek} sessions per week, but you selected ${uniqueDays.size}. Please choose again.`,
        }),
      };
    }

    const invalidDuration = sessions.find(
      (session) => session.endHour - session.startHour !== requirement.durationHours,
    );
    if (invalidDuration) {
      const duration = invalidDuration.endHour - invalidDuration.startHour;
      return {
        ok: false,
        message: this.copy(context, {
          vi: `Gia sư yêu cầu mỗi buổi ${requirement.durationHours} tiếng, nhưng có khung giờ anh/chị chọn là ${duration} tiếng. Anh/chị chọn lại giúp mình nhé.`,
          en: `The tutor requires ${requirement.durationHours} hours per session, but one selected slot is ${duration} hours. Please choose again.`,
        }),
      };
    }

    return {
      ok: true,
      schedule: {
        sessionsPerWeek: requirement.sessionsPerWeek,
        durationHours: requirement.durationHours,
        sessions,
      },
    };
  }

  private validateScheduleAvailability(
    sessions: Array<{ dayOfWeek: number; startHour: number; endHour: number }>,
    availabilitySlots: Array<{ dayOfWeek: number; startHour: number; endHour: number }>,
    context: { preferredLanguage?: 'vi' | 'en' },
  ): { ok: true } | { ok: false; message: string } {
    if (!availabilitySlots.length) {
      return {
        ok: false,
        message: this.copy(context, {
          vi: 'Mình chưa có dữ liệu lịch rảnh của gia sư. Anh/chị bấm Đặt lịch lại giúp mình nhé.',
          en: 'I do not have the tutor availability data yet. Please tap Book schedule again.',
        }),
      };
    }

    const unavailable = sessions.find(
      (session) =>
        !availabilitySlots.some(
          (slot) =>
            slot.dayOfWeek === session.dayOfWeek &&
            slot.startHour <= session.startHour &&
            slot.endHour >= session.endHour,
        ),
    );

    if (unavailable) {
      return {
        ok: false,
        message: this.copy(context, {
          vi: `Khung ${this.formatScheduleSession(unavailable, context)} chưa nằm trong lịch rảnh của gia sư. Anh/chị chọn lại khung giờ có trong lịch rảnh giúp mình nhé.`,
          en: `${this.formatScheduleSession(unavailable, context)} is not in the tutor’s available slots. Please choose a time shown in the availability calendar.`,
        }),
      };
    }

    return { ok: true };
  }

  private async getAvailabilitySlotsForValidation(
    zaloUserId: string,
    context: {
      selectedTutorAvailabilitySlots?: Array<{ dayOfWeek: number; startHour: number; endHour: number }>;
      selectedTutorAvailabilityLoadedAt?: string;
      selectedTutorId?: string;
      selectedTutorName?: string;
    },
  ): Promise<Array<{ dayOfWeek: number; startHour: number; endHour: number }>> {
    if (
      context.selectedTutorAvailabilitySlots?.length &&
      context.selectedTutorAvailabilityLoadedAt
    ) {
      return context.selectedTutorAvailabilitySlots;
    }

    if (!context.selectedTutorId) {
      return [];
    }

    try {
      const availability = await this.beClient.getTutorAvailability(
        context.selectedTutorId,
        context.selectedTutorName ?? 'Gia su',
      );
      await this.state.updateContext(zaloUserId, {
        selectedTutorAvailabilitySlots: availability.slots,
        selectedTutorAvailabilityLoadedAt: new Date().toISOString(),
      });
      return availability.slots;
    } catch (error) {
      this.logger.error(
        `Failed to reload availability for ${context.selectedTutorId}: ${String(error)}`,
      );
      return [];
    }
  }

  private formatScheduleSummary(schedule: {
    sessions: Array<{ dayOfWeek: number; startHour: number; endHour: number }>;
    sessionsPerWeek: number;
    durationHours: number;
  }, context?: { preferredLanguage?: 'vi' | 'en' }): string {
    const sessions = schedule.sessions
      .map((session) => this.formatScheduleSession(session, context))
      .join('\n');

    return [
      this.copy(context, {
        vi: `${schedule.sessionsPerWeek} buổi/tuần, mỗi buổi ${schedule.durationHours} tiếng`,
        en: `${schedule.sessionsPerWeek} sessions/week, ${schedule.durationHours} hours per session`,
      }),
      sessions,
    ].join('\n');
  }

  private formatScheduleSession(session: {
    dayOfWeek: number;
    startHour: number;
    endHour: number;
  }, context?: { preferredLanguage?: 'vi' | 'en' }): string {
    const dayNames: Record<number, string> = this.isEnglish(context)
      ? {
          1: 'Monday',
          2: 'Tuesday',
          3: 'Wednesday',
          4: 'Thursday',
          5: 'Friday',
          6: 'Saturday',
          7: 'Sunday',
        }
      : {
          1: 'Thứ 2',
          2: 'Thứ 3',
          3: 'Thứ 4',
          4: 'Thứ 5',
          5: 'Thứ 6',
          6: 'Thứ 7',
          7: 'Chủ nhật',
        };

    const fallback = this.isEnglish(context)
      ? `Day ${session.dayOfWeek}`
      : `Thứ ${session.dayOfWeek + 1}`;
    const time = this.isEnglish(context)
      ? `${session.startHour}:00-${session.endHour}:00`
      : `${session.startHour}h-${session.endHour}h`;

    return `${dayNames[session.dayOfWeek] ?? fallback} ${time}`;
  }

  private isEnglish(context?: { preferredLanguage?: 'vi' | 'en' }): boolean {
    return context?.preferredLanguage === 'en';
  }

  private copy(
    context: { preferredLanguage?: 'vi' | 'en' } | undefined,
    messages: { vi: string; en: string },
  ): string {
    return this.isEnglish(context) ? messages.en : messages.vi;
  }

  private parseScheduleDays(normalizedText: string): number[] {
    const days = new Set<number>();
    const compact = normalizedText.replace(/chu nhat/g, 'cn');

    if (compact.includes('cn')) {
      days.add(7);
    }

    const dayMatches = compact.matchAll(
      /(?:thu|t)\s*((?:[2-7]\s*(?:(?:[-,&])|(?:va)|v)?\s*)+)/g,
    );
    for (const match of dayMatches) {
      for (const value of match[1].match(/[2-7]/g) ?? []) {
        days.add(Number(value) - 1);
      }
    }

    if (!days.size) {
      const beforeTime = compact.split(/\d{1,2}\s*(?:(?:h|g|:)\s*(?:\d{2})?)?\s*-\s*\d{1,2}\s*(?:h|g|:)\s*(?:\d{2})?/)[0];
      const bareDays = beforeTime.match(/\b[2-7]\b/g) ?? [];
      for (const value of bareDays) {
        days.add(Number(value) - 1);
      }
    }

    return [...days].sort((a, b) => a - b);
  }

  private normalizeText(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
  private formatAvailabilityText(availability: TutorAvailabilityDto): string {
    const dayNames: Record<number, string> = {
      1: 'Thứ 2',
      2: 'Thứ 3',
      3: 'Thứ 4',
      4: 'Thứ 5',
      5: 'Thứ 6',
      6: 'Thứ 7',
      7: 'Chủ nhật',
    };
    const grouped = new Map<number, string[]>();

    for (const slot of availability.slots) {
      const slots = grouped.get(slot.dayOfWeek) ?? [];
      slots.push(`${slot.startHour}h-${slot.endHour}h`);
      grouped.set(slot.dayOfWeek, slots);
    }

    const lines = [
      `Lịch rảnh 7 ngày của ${availability.tutorName}:`,
      ...[1, 2, 3, 4, 5, 6, 7].map((day) => {
        const slots = grouped.get(day);
        return `${dayNames[day]}: ${slots?.length ? slots.join(', ') : 'Chưa có khung rảnh'}`;
      }),
      '',
      'Bạn có thể xem lịch rồi chọn khung giờ học ở bước tiếp theo.',
    ];

    return lines.join('\n');
  }
}
