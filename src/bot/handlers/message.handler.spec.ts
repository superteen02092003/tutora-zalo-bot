import { ConfigService } from '@nestjs/config';
import { ConversationState } from '../state/conversation-state.enum';
import { MessageHandler } from './message.handler';

describe('MessageHandler', () => {
  const state = {
    getState: jest.fn(),
    getContext: jest.fn(),
    getMatchingCandidates: jest.fn(),
    updateContext: jest.fn(),
  };
  const zalo = {
    sendText: jest.fn(),
    sendNumberedList: jest.fn(),
  };
  const llmRouter = { decide: jest.fn() };
  const onboardingFlow = { start: jest.fn(), applySlot: jest.fn() };
  const agentHandler = { handle: jest.fn() };
  const ai = { summarizeSession: jest.fn() };
  const config = { get: jest.fn().mockReturnValue([]) } as unknown as ConfigService;

  let handler: MessageHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    state.getContext.mockResolvedValue({});
    state.getMatchingCandidates.mockResolvedValue([]);
    state.getState.mockResolvedValue(ConversationState.New);
    handler = new MessageHandler(
      state as never,
      zalo as never,
      llmRouter as never,
      onboardingFlow as never,
      agentHandler as never,
      ai as never,
      config,
    );
  });

  it('skips processing when botChatDisabled', async () => {
    state.getContext.mockResolvedValue({ botChatDisabled: true });

    await handler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: { text: 'hi' },
    } as never);

    expect(llmRouter.decide).not.toHaveBeenCalled();
  });

  it('routes start_onboarding to onboardingFlow.start()', async () => {
    llmRouter.decide.mockResolvedValue({ action: 'start_onboarding' });

    await handler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: { text: 'tôi muốn tìm gia sư' },
    } as never);

    expect(onboardingFlow.start).toHaveBeenCalledWith('zalo-1');
  });

  it('routes fill_slot to onboardingFlow.applySlot()', async () => {
    state.getState.mockResolvedValue(ConversationState.Onboarding);
    state.getContext.mockResolvedValue({ onboardingStep: 'grade' });
    llmRouter.decide.mockResolvedValue({ action: 'fill_slot', slot: 'grade', value: 'Lop 11' });

    await handler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: { text: 'con tôi học lớp 11' },
    } as never);

    expect(onboardingFlow.applySlot).toHaveBeenCalledWith('zalo-1', 'grade', 'Lop 11');
  });

  it('sends answer_question reply via zalo.sendText()', async () => {
    llmRouter.decide.mockResolvedValue({
      action: 'answer_question',
      reply: 'Tutora hỗ trợ dạy kèm tại nhà và online.',
    });

    await handler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: { text: 'Tutora có dạy online không?' },
    } as never);

    expect(zalo.sendText).toHaveBeenCalledWith('zalo-1', 'Tutora hỗ trợ dạy kèm tại nhà và online.');
    expect(onboardingFlow.applySlot).not.toHaveBeenCalled();
  });

  it('handles select_tutor by finding candidate and prompting package', async () => {
    state.getState.mockResolvedValue(ConversationState.Matched);
    state.getMatchingCandidates.mockResolvedValue([
      { tutorId: 't1', fullName: 'Nguyễn Minh Anh' },
    ]);
    llmRouter.decide.mockResolvedValue({ action: 'select_tutor', tutorName: 'Minh Anh' });
    state.updateContext.mockResolvedValue(undefined);

    await handler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: { text: 'chọn Minh Anh' },
    } as never);

    expect(state.updateContext).toHaveBeenCalledWith('zalo-1', {
      selectedTutorId: 't1',
      selectedTutorName: 'Nguyễn Minh Anh',
    });
    expect(zalo.sendNumberedList).toHaveBeenCalled();
  });

  it('sends error message when select_tutor name not found', async () => {
    state.getState.mockResolvedValue(ConversationState.Matched);
    state.getMatchingCandidates.mockResolvedValue([{ tutorId: 't1', fullName: 'Nguyễn Minh Anh' }]);
    llmRouter.decide.mockResolvedValue({ action: 'select_tutor', tutorName: 'Không Ai Cả' });

    await handler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: { text: 'chọn Không Ai Cả' },
    } as never);

    expect(zalo.sendText).toHaveBeenCalledWith('zalo-1', expect.stringContaining('Không Ai Cả'));
    expect(state.updateContext).not.toHaveBeenCalled();
  });
});
