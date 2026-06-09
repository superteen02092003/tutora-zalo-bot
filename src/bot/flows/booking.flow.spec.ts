import { BookingFlow } from './booking.flow';
import { ConversationState } from '../state/conversation-state.enum';

describe('BookingFlow', () => {
  const beClient = {
    createBooking: jest.fn(),
    createBookingQR: jest.fn(),
    getTutorAvailability: jest.fn(),
  };
  const state = {
    getMatchingCandidates: jest.fn(),
    updateContext: jest.fn(),
    getContext: jest.fn(),
    transitionState: jest.fn(),
  };
  const zalo = {
    sendQuickReply: jest.fn(),
    sendInteractiveQuickReply: jest.fn(),
    sendText: jest.fn(),
    sendImage: jest.fn(),
    uploadImageBuffer: jest.fn(),
    sendUploadedImage: jest.fn(),
    sendZbsTemplate: jest.fn(),
  };
  const calendarImage = {
    generate: jest.fn(),
    getImage: jest.fn(),
  };
  const deepSeek = {
    parseSchedule: jest.fn(),
  };
  const config = {
    get: jest.fn(),
  };

  let flow: BookingFlow;

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockReturnValue('');
    calendarImage.generate.mockResolvedValue('calendar-1');
    calendarImage.getImage.mockReturnValue(Buffer.from('png'));
    deepSeek.parseSchedule.mockResolvedValue(null);
    zalo.uploadImageBuffer.mockResolvedValue('attachment-1');
    beClient.getTutorAvailability.mockResolvedValue({
      tutorId: 'tutor-1',
      tutorName: 'Tutor One',
      slots: [
        { dayOfWeek: 1, startHour: 17, endHour: 19 },
        { dayOfWeek: 3, startHour: 19, endHour: 21 },
      ],
    });
    flow = new BookingFlow(
      beClient as never,
      state as never,
      zalo as never,
      calendarImage as never,
      deepSeek as never,
      config as never,
    );
  });

  it('shows tutor rule and calendar then asks user to book a schedule', async () => {
    state.getMatchingCandidates.mockResolvedValue([
      {
        tutorId: 'tutor-1',
        fullName: 'Tutor One',
        requiredSessionsPerWeek: 2,
        requiredSessionDurationHours: 2,
        requiredTotalSessions: 8,
      },
    ]);

    await flow.handlePostback('zalo-1', 'select_tutor:tutor-1');

    expect(state.updateContext).toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({
        selectedTutorId: 'tutor-1',
        selectedTutorName: 'Tutor One',
        selectedPackageSessionCount: 8,
        requiredSessionsPerWeek: 2,
        requiredSessionDurationHours: 2,
        bookingStep: 'awaiting_schedule_confirm',
      }),
    );
    expect(zalo.sendText).toHaveBeenCalledWith(
      'zalo-1',
      expect.stringContaining('2 buổi/tuần'),
    );
    expect(beClient.getTutorAvailability).toHaveBeenCalledWith(
      'tutor-1',
      'Tutor One',
    );
    expect(state.updateContext).toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({
        selectedTutorAvailabilitySlots: [
          { dayOfWeek: 1, startHour: 17, endHour: 19 },
          { dayOfWeek: 3, startHour: 19, endHour: 21 },
        ],
        selectedTutorAvailabilityLoadedAt: expect.any(String),
      }),
    );
    expect(zalo.sendText).not.toHaveBeenCalledWith(
      'zalo-1',
      expect.stringContaining('Lịch rảnh 7 ngày của Tutor One'),
    );
    expect(zalo.uploadImageBuffer).toHaveBeenCalledWith(
      Buffer.from('png'),
      'tutor-1-calendar.png',
    );
    expect(zalo.sendUploadedImage).toHaveBeenCalledWith(
      'zalo-1',
      'attachment-1',
      expect.stringContaining('Tutor One'),
    );
    expect(zalo.sendQuickReply).toHaveBeenCalledWith(
      'zalo-1',
      expect.stringContaining('Đặt lịch'),
      [{ title: 'Đặt lịch', payload: 'confirm_tutor_schedule' }],
    );
  });

  it('asks for confirmation after valid schedule input', async () => {
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      parentId: 'parent-1',
      selectedTutorId: 'tutor-1',
      subjectId: 1,
      selectedPackageSessionCount: 8,
      requiredSessionsPerWeek: 2,
      requiredSessionDurationHours: 2,
      selectedTutorAvailabilitySlots: [
        { dayOfWeek: 1, startHour: 19, endHour: 21 },
        { dayOfWeek: 3, startHour: 19, endHour: 21 },
      ],
      selectedTutorAvailabilityLoadedAt: '2026-06-04T00:00:00.000Z',
      criteria: {
        subject: 'Toan',
        grade: 'Lop 9',
        locationDistrict: 'Quan 1',
        budgetMax: 250000,
      },
    });
    await flow.handleScheduleInput('zalo-1', 'Thu 2-4 19h-21h');

    expect(beClient.createBooking).not.toHaveBeenCalled();
    expect(state.updateContext).toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({
        bookingStep: 'awaiting_schedule_confirmation',
        pendingSchedule: JSON.stringify({
          sessionsPerWeek: 2,
          durationHours: 2,
          sessions: [
            { dayOfWeek: 1, startHour: 19, endHour: 21 },
            { dayOfWeek: 3, startHour: 19, endHour: 21 },
          ],
        }),
      }),
    );
    expect(zalo.sendQuickReply).toHaveBeenCalledWith(
      'zalo-1',
      expect.stringContaining('xác nhận'),
      [
        { title: 'Xác nhận', payload: 'booking_schedule_confirm' },
        { title: 'Chọn lại', payload: 'booking_schedule_redo' },
      ],
    );
  });

  it('creates booking after schedule confirmation', async () => {
    const pendingSchedule = JSON.stringify({
      sessionsPerWeek: 2,
      durationHours: 2,
      sessions: [
        { dayOfWeek: 1, startHour: 19, endHour: 21 },
        { dayOfWeek: 3, startHour: 19, endHour: 21 },
      ],
    });
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      parentId: 'parent-1',
      selectedTutorId: 'tutor-1',
      selectedTutorName: 'Tutor One',
      subjectId: 1,
      selectedPackageSessionCount: 8,
      pendingSchedule,
      criteria: {
        subject: 'Toan',
        grade: 'Lop 9',
        locationDistrict: 'Quan 1',
        budgetMax: 250000,
      },
    });
    beClient.createBooking.mockResolvedValue({
      bookingId: 10,
      finalPrice: 1600000,
    });

    await flow.handlePostback('zalo-1', 'booking_schedule_confirm');

    expect(beClient.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        parentId: 'parent-1',
        tutorId: 'tutor-1',
        subjectId: 1,
        sessionCount: 8,
        schedule: pendingSchedule,
      }),
    );
    expect(state.transitionState).toHaveBeenCalledWith(
      'zalo-1',
      ConversationState.BookingConfirm,
    );
  });

  it('asks user to re-enter schedule when it does not match tutor requirements', async () => {
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      selectedTutorId: 'tutor-1',
      selectedTutorName: 'Tutor One',
      requiredSessionsPerWeek: 2,
      requiredSessionDurationHours: 2,
      selectedTutorAvailabilitySlots: [
        { dayOfWeek: 1, startHour: 19, endHour: 21 },
        { dayOfWeek: 3, startHour: 19, endHour: 21 },
      ],
      selectedTutorAvailabilityLoadedAt: '2026-06-04T00:00:00.000Z',
    });

    await flow.handleScheduleInput('zalo-1', 'Thu 2 19h-20h');

    expect(beClient.createBooking).not.toHaveBeenCalled();
    expect(zalo.sendText).toHaveBeenCalledWith(
      'zalo-1',
      expect.stringContaining('2 tiếng'),
    );
  });

  it('asks user to re-enter schedule when selected time is outside tutor availability', async () => {
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      selectedTutorId: 'tutor-1',
      selectedTutorName: 'Tutor One',
      requiredSessionsPerWeek: 2,
      requiredSessionDurationHours: 2,
      selectedTutorAvailabilitySlots: [
        { dayOfWeek: 1, startHour: 17, endHour: 19 },
        { dayOfWeek: 5, startHour: 17, endHour: 19 },
      ],
      selectedTutorAvailabilityLoadedAt: '2026-06-04T00:00:00.000Z',
    });

    await flow.handleScheduleInput('zalo-1', 'Thu 2 va 6 19h-21h');

    expect(beClient.createBooking).not.toHaveBeenCalled();
    expect(state.updateContext).not.toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({
        bookingStep: 'awaiting_schedule_confirmation',
      }),
    );
    expect(zalo.sendText).toHaveBeenCalledWith(
      'zalo-1',
      expect.stringContaining('chưa nằm trong lịch rảnh'),
    );
  });

  it('refreshes calendar and asks user to re-enter when old context has no availability timestamp', async () => {
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      selectedTutorId: 'tutor-1',
      selectedTutorName: 'Tutor One',
      requiredSessionsPerWeek: 2,
      requiredSessionDurationHours: 2,
    });
    beClient.getTutorAvailability.mockResolvedValueOnce({
      tutorId: 'tutor-1',
      tutorName: 'Tutor One',
      slots: [
        { dayOfWeek: 1, startHour: 17, endHour: 19 },
        { dayOfWeek: 5, startHour: 17, endHour: 19 },
      ],
    });

    await flow.handleScheduleInput('zalo-1', 'Thu 2 va 6 19h-21h');

    expect(beClient.getTutorAvailability).toHaveBeenCalledWith(
      'tutor-1',
      'Tutor One',
    );
    expect(state.updateContext).toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({
        selectedTutorAvailabilitySlots: [
          { dayOfWeek: 1, startHour: 17, endHour: 19 },
          { dayOfWeek: 5, startHour: 17, endHour: 19 },
        ],
        selectedTutorAvailabilityLoadedAt: expect.any(String),
        bookingStep: 'awaiting_schedule_input',
      }),
    );
    expect(beClient.createBooking).not.toHaveBeenCalled();
    expect(zalo.sendText).toHaveBeenCalledWith(
      'zalo-1',
      expect.stringContaining('cập nhật lại lịch rảnh'),
    );
  });

  it('accepts ampersand-separated Vietnamese weekday input', async () => {
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      parentId: 'parent-1',
      selectedTutorId: 'tutor-1',
      subjectId: 1,
      selectedPackageSessionCount: 8,
      requiredSessionsPerWeek: 2,
      requiredSessionDurationHours: 2,
      selectedTutorAvailabilitySlots: [
        { dayOfWeek: 1, startHour: 17, endHour: 19 },
        { dayOfWeek: 5, startHour: 17, endHour: 19 },
      ],
      selectedTutorAvailabilityLoadedAt: '2026-06-04T00:00:00.000Z',
      criteria: {
        subject: 'Toan',
        grade: 'Lop 9',
        locationDistrict: 'Quan 1',
        budgetMax: 250000,
      },
    });
    beClient.createBooking.mockResolvedValue({
      bookingId: 10,
      finalPrice: 1600000,
    });

    await flow.handleScheduleInput('zalo-1', 'Thứ 2 & 6 từ 17h-19h');

    expect(beClient.createBooking).not.toHaveBeenCalled();
    expect(state.updateContext).toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({
        pendingSchedule: JSON.stringify({
          sessionsPerWeek: 2,
          durationHours: 2,
          sessions: [
            { dayOfWeek: 1, startHour: 17, endHour: 19 },
            { dayOfWeek: 5, startHour: 17, endHour: 19 },
          ],
        }),
      }),
    );
  });

  it('parses bare weekday numbers before calling DeepSeek', async () => {
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      parentId: 'parent-1',
      selectedTutorId: 'tutor-1',
      subjectId: 1,
      selectedPackageSessionCount: 12,
      requiredSessionsPerWeek: 3,
      requiredSessionDurationHours: 2,
      selectedTutorAvailabilitySlots: [
        { dayOfWeek: 1, startHour: 17, endHour: 19 },
        { dayOfWeek: 3, startHour: 17, endHour: 19 },
        { dayOfWeek: 5, startHour: 17, endHour: 19 },
      ],
      selectedTutorAvailabilityLoadedAt: '2026-06-04T00:00:00.000Z',
      criteria: {
        subject: 'Toan',
        grade: 'Lop 9',
        locationDistrict: 'Quan 1',
        budgetMax: 250000,
      },
    });

    await flow.handleScheduleInput('zalo-1', '2 4 6 17-19h');

    expect(deepSeek.parseSchedule).not.toHaveBeenCalled();
    expect(state.updateContext).toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({
        pendingSchedule: JSON.stringify({
          sessionsPerWeek: 3,
          durationHours: 2,
          sessions: [
            { dayOfWeek: 1, startHour: 17, endHour: 19 },
            { dayOfWeek: 3, startHour: 17, endHour: 19 },
            { dayOfWeek: 5, startHour: 17, endHour: 19 },
          ],
        }),
      }),
    );
  });

  it('uses DeepSeek parsed schedule for natural language input', async () => {
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      parentId: 'parent-1',
      selectedTutorId: 'tutor-1',
      subjectId: 1,
      selectedPackageSessionCount: 8,
      requiredSessionsPerWeek: 2,
      requiredSessionDurationHours: 2,
      selectedTutorAvailabilitySlots: [
        { dayOfWeek: 1, startHour: 17, endHour: 19 },
        { dayOfWeek: 5, startHour: 17, endHour: 19 },
      ],
      selectedTutorAvailabilityLoadedAt: '2026-06-04T00:00:00.000Z',
      criteria: {
        subject: 'Toan',
        grade: 'Lop 9',
        locationDistrict: 'Quan 1',
        budgetMax: 250000,
      },
    });
    deepSeek.parseSchedule.mockResolvedValue({
      sessions: [
        { dayOfWeek: 1, startHour: 17, endHour: 19 },
        { dayOfWeek: 5, startHour: 17, endHour: 19 },
      ],
    });
    beClient.createBooking.mockResolvedValue({
      bookingId: 10,
      finalPrice: 1600000,
    });

    await flow.handleScheduleInput('zalo-1', 'em ranh toi thu hai voi thu sau');

    expect(deepSeek.parseSchedule).toHaveBeenCalledWith(
      'em ranh toi thu hai voi thu sau',
      { sessionsPerWeek: 2, durationHours: 2 },
    );
    expect(beClient.createBooking).not.toHaveBeenCalled();
    expect(state.updateContext).toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({
        pendingSchedule: JSON.stringify({
          sessionsPerWeek: 2,
          durationHours: 2,
          sessions: [
            { dayOfWeek: 1, startHour: 17, endHour: 19 },
            { dayOfWeek: 5, startHour: 17, endHour: 19 },
          ],
        }),
      }),
    );
  });
});
