import { OnboardingFlow } from './onboarding.flow';
import { ConversationState } from '../state/conversation-state.enum';

describe('OnboardingFlow', () => {
  const beClient = {
    getUserByZaloId: jest.fn(),
    upsertZaloLead: jest.fn(),
    getSubjects: jest.fn(),
  };
  const state = {
    setContext: jest.fn(),
    setState: jest.fn(),
    getContext: jest.fn(),
    updateContext: jest.fn(),
  };
  const zalo = {
    sendQuickReply: jest.fn(),
    sendNumberedList: jest.fn(),
    sendText: jest.fn(),
  };
  const matchingFlow = {
    showMatches: jest.fn(),
  };

  let flow: OnboardingFlow;

  beforeEach(() => {
    jest.clearAllMocks();
    flow = new OnboardingFlow(
      beClient as never,
      state as never,
      zalo as never,
      matchingFlow as never,
    );
  });

  it('upserts a new Zalo lead and starts onboarding by asking for subject', async () => {
    beClient.getUserByZaloId.mockResolvedValue(null);
    beClient.upsertZaloLead.mockResolvedValue({
      userId: 'parent-1',
      zaloUserId: 'zalo-1',
    });
    state.getContext.mockResolvedValue({});

    await flow.start('zalo-1');

    expect(beClient.upsertZaloLead).toHaveBeenCalledWith(
      'zalo-1',
      undefined,
      undefined,
    );
    expect(state.setContext).toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({
        parentId: 'parent-1',
        onboardingStep: 'subject',
      }),
    );
    expect(state.setState).toHaveBeenCalledWith(
      'zalo-1',
      ConversationState.Onboarding,
    );
    expect(zalo.sendText).toHaveBeenCalledWith(
      'zalo-1',
      expect.stringContaining('môn gì'),
    );
  });

  it('applySlot subject advances to grade step', async () => {
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      preferredLanguage: 'vi',
      criteria: {},
    });

    await flow.applySlot('zalo-1', 'subject', 'Toan');

    expect(state.updateContext).toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({ onboardingStep: 'grade' }),
    );
    expect(zalo.sendText).toHaveBeenCalledWith(
      'zalo-1',
      expect.stringContaining('lớp mấy'),
    );
  });

  it('applySlot grade advances to mode step', async () => {
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      preferredLanguage: 'vi',
      criteria: { subject: 'Toan' },
    });

    await flow.applySlot('zalo-1', 'grade', 'Lop 11');

    expect(state.updateContext).toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({ onboardingStep: 'mode' }),
    );
    expect(zalo.sendQuickReply).toHaveBeenCalledWith(
      'zalo-1',
      expect.stringContaining('hình thức'),
      expect.any(Array),
    );
  });

  it('applySlot purpose triggers matching', async () => {
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      preferredLanguage: 'vi',
      criteria: {
        subject: 'Toan',
        grade: 'Lop 9',
        teachingMode: 'online',
      },
    });

    await flow.applySlot('zalo-1', 'purpose', 'exam_prep');

    expect(state.updateContext).toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({ onboardingStep: 'done' }),
    );
    expect(matchingFlow.showMatches).toHaveBeenCalledWith('zalo-1');
  });

  it('handlePostbackInput ignores stale payloads', async () => {
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      onboardingStep: 'grade',
    });

    await flow.handlePostbackInput('zalo-1', 'onboarding:subject:Toan');

    expect(state.updateContext).not.toHaveBeenCalled();
  });

  it('handlePostbackInput applies slot when step matches', async () => {
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      preferredLanguage: 'vi',
      onboardingStep: 'subject',
      criteria: {},
    });

    await flow.handlePostbackInput('zalo-1', 'onboarding:subject:Toan');

    expect(state.updateContext).toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({ onboardingStep: 'grade' }),
    );
  });
});
