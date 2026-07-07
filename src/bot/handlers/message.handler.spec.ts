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
  const agentMatchingFlow = { handle: jest.fn() };
  // aiMatching.enabled=false trong suite này → đường llm-router/onboarding cũ giữ nguyên.
  const config = {
    get: jest.fn((key: string, defaultValue?: unknown) =>
      key === 'aiMatching.enabled' ? false : key === 'adminZaloUserIds' ? [] : defaultValue,
    ),
  } as unknown as ConfigService;
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
      agentMatchingFlow as never,
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

  it('routes free text to agentMatchingFlow when AI matching flag is on', async () => {
    const aiConfig = {
      get: jest.fn((key: string, defaultValue?: unknown) =>
        key === 'aiMatching.enabled' ? true : key === 'adminZaloUserIds' ? [] : defaultValue,
      ),
    } as unknown as ConfigService;
    const aiHandler = new MessageHandler(
      state as never,
      zalo as never,
      llmRouter as never,
      onboardingFlow as never,
      agentMatchingFlow as never,
      aiConfig,
    );

    await aiHandler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: { text: 'tìm gia sư Toán lớp 8 ôn thi' },
    } as never);

    expect(agentMatchingFlow.handle).toHaveBeenCalledWith('zalo-1', 'tìm gia sư Toán lớp 8 ôn thi');
    expect(llmRouter.decide).not.toHaveBeenCalled();
    expect(onboardingFlow.start).not.toHaveBeenCalled();
  });

  it('keeps booking funnel on llm-router path even when AI matching flag is on', async () => {
    state.getContext.mockResolvedValue({ selectedTutorId: 't1' });
    llmRouter.decide.mockResolvedValue({ action: 'select_package', sessionCount: 8 });
    state.updateContext.mockResolvedValue({ preferredLanguage: 'vi' });
    const aiConfig = {
      get: jest.fn((key: string, defaultValue?: unknown) =>
        key === 'aiMatching.enabled' ? true : key === 'adminZaloUserIds' ? [] : defaultValue,
      ),
    } as unknown as ConfigService;
    const aiHandler = new MessageHandler(
      state as never,
      zalo as never,
      llmRouter as never,
      onboardingFlow as never,
      agentMatchingFlow as never,
      aiConfig,
    );

    await aiHandler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: { text: '8 buổi' },
    } as never);

    expect(agentMatchingFlow.handle).not.toHaveBeenCalled();
    expect(llmRouter.decide).toHaveBeenCalled();
  });

  it('sends error message when select_tutor name not found', async () => {
    state.getState.mockResolvedValue(ConversationState.Matched);
    // preferredLanguage đặt sẵn 'vi' để auto-detect ngôn ngữ không gọi updateContext
    // (assertion dưới kiểm tra KHÔNG update context khi chọn sai tên).
    state.getContext.mockResolvedValue({ preferredLanguage: 'vi' });
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
