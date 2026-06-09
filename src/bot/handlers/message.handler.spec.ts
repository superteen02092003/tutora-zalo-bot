import { MessageHandler } from './message.handler';
import { ConversationState } from '../state/conversation-state.enum';

describe('MessageHandler', () => {
  const state = {
    getState: jest.fn(),
    getContext: jest.fn(),
    getMatchingCandidates: jest.fn(),
  };
  const onboardingFlow = {
    start: jest.fn(),
    handlePostbackInput: jest.fn(),
    applySlot: jest.fn(),
  };
  const bookingFlow = {
    handlePostback: jest.fn(),
    selectTutorByName: jest.fn(),
    selectPackageByCount: jest.fn(),
    promptCurrentStep: jest.fn(),
  };
  const scheduleFlow = {
    handleRescheduleInput: jest.fn(),
    handleCancelReason: jest.fn(),
    submitDispute: jest.fn(),
    initiateReschedule: jest.fn(),
    initiateCancel: jest.fn(),
    initiateDispute: jest.fn(),
  };
  const replacementTutorFlow = {
    handlePostback: jest.fn(),
  };
  const beClient = {
    getActiveBookingByZaloId: jest.fn(),
    getBooking: jest.fn(),
  };
  const llmRouter = {
    decide: jest.fn(),
  };
  const zalo = {
    sendText: jest.fn(),
    sendQuickReply: jest.fn(),
  };

  let handler: MessageHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    state.getContext.mockResolvedValue({ zaloUserId: 'zalo-1' });
    state.getMatchingCandidates.mockResolvedValue([]);
    handler = new MessageHandler(
      state as never,
      onboardingFlow as never,
      bookingFlow as never,
      scheduleFlow as never,
      replacementTutorFlow as never,
      beClient as never,
      llmRouter as never,
      zalo as never,
    );
  });

  it('starts onboarding for NEW state regardless of message', async () => {
    state.getState.mockResolvedValue(ConversationState.New);

    await handler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: { text: 'hi' },
    } as never);

    expect(onboardingFlow.start).toHaveBeenCalledWith('zalo-1');
    expect(llmRouter.decide).not.toHaveBeenCalled();
  });

  it('routes onboarding: postback directly without LLM', async () => {
    state.getState.mockResolvedValue(ConversationState.Onboarding);

    await handler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: { text: '' },
      postback: { data: 'onboarding:grade:Lop 11' } as never,
    } as never);

    expect(onboardingFlow.handlePostbackInput).toHaveBeenCalledWith('zalo-1', 'onboarding:grade:Lop 11');
    expect(llmRouter.decide).not.toHaveBeenCalled();
  });

  it('dispatches fill_slot to onboardingFlow.applySlot when in correct step', async () => {
    state.getState.mockResolvedValue(ConversationState.Onboarding);
    state.getContext.mockResolvedValue({ zaloUserId: 'zalo-1', onboardingStep: 'grade' });
    llmRouter.decide.mockResolvedValue({ action: 'fill_slot', slot: 'grade', value: 'Lop 11' });

    await handler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: { text: 'con tôi học lớp 11' },
    } as never);

    expect(onboardingFlow.applySlot).toHaveBeenCalledWith('zalo-1', 'grade', 'Lop 11');
  });

  it('dispatches select_tutor to bookingFlow.selectTutorByName', async () => {
    state.getState.mockResolvedValue(ConversationState.Matched);
    state.getContext.mockResolvedValue({ zaloUserId: 'zalo-1' });
    llmRouter.decide.mockResolvedValue({ action: 'select_tutor', tutorName: 'Nguyen Minh Anh' });

    await handler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: { text: 'chọn Nguyễn Minh Anh' },
    } as never);

    expect(bookingFlow.selectTutorByName).toHaveBeenCalledWith('zalo-1', 'Nguyen Minh Anh');
  });

  it('routes active sub-flow (reschedule awaiting time) deterministically', async () => {
    state.getState.mockResolvedValue(ConversationState.Active);
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      activeFlow: 'reschedule',
      rescheduleStep: 'awaiting_new_time',
    });

    await handler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: { text: '25/06 19:00' },
    } as never);

    expect(scheduleFlow.handleRescheduleInput).toHaveBeenCalledWith('zalo-1', '25/06 19:00');
    expect(llmRouter.decide).not.toHaveBeenCalled();
  });

  it('sends answer_question reply directly', async () => {
    state.getState.mockResolvedValue(ConversationState.Onboarding);
    state.getContext.mockResolvedValue({ zaloUserId: 'zalo-1', onboardingStep: 'subject' });
    llmRouter.decide.mockResolvedValue({ action: 'answer_question', reply: 'Tutora hỗ trợ dạy kèm tại nhà và online.' });

    await handler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: { text: 'Tutora có dạy online không?' },
    } as never);

    expect(zalo.sendText).toHaveBeenCalledWith('zalo-1', 'Tutora hỗ trợ dạy kèm tại nhà và online.');
    expect(onboardingFlow.applySlot).not.toHaveBeenCalled();
  });
});
