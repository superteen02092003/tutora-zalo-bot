import { OnboardingFlow } from './onboarding.flow';
import { ConversationState } from '../state/conversation-state.enum';

describe('OnboardingFlow', () => {
  const beClient = {
    getUserByZaloId: jest.fn(),
    upsertZaloLead: jest.fn(),
    getSubjects: jest.fn(),
    getMatchedTutors: jest.fn(),
  };
  const subjectCache = {
    getSubjects: jest.fn(),
    getNames: jest.fn(),
    normalize: jest.fn(),
  };
  const aiClient = {
    rankCandidates: jest.fn(),
  };
  const state = {
    setContext: jest.fn(),
    setState: jest.fn(),
    getContext: jest.fn(),
    updateContext: jest.fn(),
    setMatchingCandidates: jest.fn(),
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
    subjectCache.getSubjects.mockResolvedValue([
      { subjectId: 1, name: 'Toán Học' },
      { subjectId: 2, name: 'Tiếng Anh' },
    ]);
    flow = new OnboardingFlow(
      beClient as never,
      subjectCache as never,
      aiClient as never,
      state as never,
      zalo as never,
      matchingFlow as never,
    );
  });

  it('upserts a new Zalo lead and starts with subject selection', async () => {
    beClient.getUserByZaloId.mockResolvedValue(null);
    beClient.upsertZaloLead.mockResolvedValue({
      userId: 'parent-1',
      zaloUserId: 'zalo-1',
    });

    await flow.start('zalo-1');

    expect(beClient.upsertZaloLead).toHaveBeenCalledWith('zalo-1', undefined, undefined);
    expect(state.setContext).toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({
        parentId: 'parent-1',
        onboardingStep: 'subject',
        invalidInputCount: 0,
      }),
    );
    expect(state.setState).toHaveBeenCalledWith('zalo-1', ConversationState.Onboarding);
    expect(zalo.sendQuickReply).toHaveBeenCalledWith(
      'zalo-1',
      expect.stringContaining('môn gì'),
      expect.arrayContaining([
        expect.objectContaining({ payload: expect.stringContaining('onboarding:subject:') }),
      ]),
    );
  });

  it('applySlot subject advances to grade_group step', async () => {
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      preferredLanguage: 'vi',
      criteria: {},
    });

    await flow.applySlot('zalo-1', 'subject', '1:Toán Học');

    expect(state.updateContext).toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({ onboardingStep: 'grade_group' }),
    );
    expect(zalo.sendQuickReply).toHaveBeenCalledWith(
      'zalo-1',
      expect.stringContaining('cấp mấy'),
      expect.arrayContaining([
        expect.objectContaining({ payload: 'onboarding:grade_group:cap1' }),
        expect.objectContaining({ payload: 'onboarding:grade_group:cap2' }),
        expect.objectContaining({ payload: 'onboarding:grade_group:cap3' }),
      ]),
    );
  });

  it('applySlot grade_group advances to grade step with correct options', async () => {
    state.getContext.mockResolvedValue({ zaloUserId: 'zalo-1' });

    await flow.applySlot('zalo-1', 'grade_group', 'cap2');

    expect(state.updateContext).toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({ gradeGroup: 'cap2', onboardingStep: 'grade' }),
    );
    expect(zalo.sendQuickReply).toHaveBeenCalledWith(
      'zalo-1',
      expect.stringContaining('lớp mấy'),
      expect.arrayContaining([
        expect.objectContaining({ payload: 'onboarding:grade:6' }),
        expect.objectContaining({ payload: 'onboarding:grade:7' }),
        expect.objectContaining({ payload: 'onboarding:grade:8' }),
        expect.objectContaining({ payload: 'onboarding:grade:9' }),
      ]),
    );
  });

  it('applySlot grade advances to mode step', async () => {
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      criteria: { subject: 'Toán Học', grade: '' },
    });

    await flow.applySlot('zalo-1', 'grade', '9');

    expect(state.updateContext).toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({ onboardingStep: 'mode' }),
    );
    expect(zalo.sendQuickReply).toHaveBeenCalledWith(
      'zalo-1',
      expect.stringContaining('hình thức'),
      expect.arrayContaining([
        expect.objectContaining({ payload: 'onboarding:mode:online' }),
        expect.objectContaining({ payload: 'onboarding:mode:offline' }),
        expect.objectContaining({ payload: 'onboarding:mode:both' }),
      ]),
    );
  });

  it('applySlot mode=online skips area and goes to freetext', async () => {
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      criteria: { subject: 'Toán Học', grade: 'Lop 9', teachingMode: 'online' },
    });

    await flow.applySlot('zalo-1', 'mode', 'online');

    expect(state.updateContext).toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({ onboardingStep: 'freetext' }),
    );
    expect(zalo.sendText).toHaveBeenCalledWith(
      'zalo-1',
      expect.stringContaining('mô tả thêm'),
    );
  });

  it('applySlot mode=offline asks for city', async () => {
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      criteria: { subject: 'Toán Học', grade: 'Lop 9', teachingMode: 'offline' },
    });

    await flow.applySlot('zalo-1', 'mode', 'offline');

    expect(state.updateContext).toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({ onboardingStep: 'area' }),
    );
    expect(zalo.sendQuickReply).toHaveBeenCalledWith(
      'zalo-1',
      expect.stringContaining('thành phố'),
      expect.arrayContaining([
        expect.objectContaining({ payload: 'onboarding:area:TP.HCM' }),
        expect.objectContaining({ payload: 'onboarding:area:other' }),
      ]),
    );
  });

  it('applySlot area=other prompts for free-text city name', async () => {
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      criteria: { subject: 'Toán Học', grade: 'Lop 9', teachingMode: 'offline' },
    });

    await flow.applySlot('zalo-1', 'area', 'other');

    // Step stays 'area', no further transition yet
    expect(state.updateContext).not.toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({ onboardingStep: 'freetext' }),
    );
    expect(zalo.sendText).toHaveBeenCalledWith(
      'zalo-1',
      expect.stringContaining('tỉnh/thành phố'),
    );
  });

  it('applySlot area with real city advances to freetext', async () => {
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      criteria: { subject: 'Toán Học', grade: 'Lop 9', teachingMode: 'offline' },
    });

    await flow.applySlot('zalo-1', 'area', 'TP.HCM');

    expect(state.updateContext).toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({ onboardingStep: 'freetext' }),
    );
  });

  it('applySlot freetext stores query and triggers matching', async () => {
    const criteria = { subject: 'Toán Học', grade: 'Lop 9', teachingMode: 'online' as const };
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      criteria,
      freetextQuery: undefined,
    });
    beClient.getMatchedTutors.mockResolvedValue({
      subjectId: 1,
      candidates: [{ tutorId: 't1', fullName: 'Nguyễn A', averageRating: 4.5, totalReviews: 10, completedHours: 100, hourlyRate: 200000, subscriptionType: 'pro', teachingMode: 'online' }],
    });
    aiClient.rankCandidates.mockResolvedValue(['t1']);
    matchingFlow.showMatches.mockResolvedValue(undefined);

    await flow.applySlot('zalo-1', 'freetext', 'gia sư kiên nhẫn');

    expect(state.updateContext).toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({ freetextQuery: 'gia sư kiên nhẫn' }),
    );
    expect(matchingFlow.showMatches).toHaveBeenCalledWith('zalo-1', expect.any(Array));
  });

  it('applySlot freetext with "bỏ qua" skips storing query', async () => {
    const criteria = { subject: 'Toán Học', grade: 'Lop 9', teachingMode: 'online' as const };
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      criteria,
    });
    beClient.getMatchedTutors.mockResolvedValue({ subjectId: 1, candidates: [] });
    aiClient.rankCandidates.mockResolvedValue([]);
    matchingFlow.showMatches.mockResolvedValue(undefined);

    await flow.applySlot('zalo-1', 'freetext', 'bỏ qua');

    // Should NOT store freetextQuery
    expect(state.updateContext).not.toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({ freetextQuery: expect.anything() }),
    );
    expect(matchingFlow.showMatches).toHaveBeenCalled();
  });

  it('handleInvalidInput sends reminder and resends buttons', async () => {
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      onboardingStep: 'mode',
      invalidInputCount: 0,
    });

    await flow.handleInvalidInput('zalo-1');

    expect(zalo.sendText).toHaveBeenCalledWith(
      'zalo-1',
      expect.stringContaining('nhấn chọn'),
    );
    expect(zalo.sendQuickReply).toHaveBeenCalledWith(
      'zalo-1',
      expect.stringContaining('hình thức'),
      expect.any(Array),
    );
  });

  it('handleInvalidInput escalates to CS after 3 consecutive invalid inputs', async () => {
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      onboardingStep: 'mode',
      invalidInputCount: 2,
    });

    await flow.handleInvalidInput('zalo-1');

    expect(zalo.sendText).toHaveBeenCalledWith(
      'zalo-1',
      expect.stringContaining('nhân viên tư vấn'),
    );
    expect(state.updateContext).toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({ botChatDisabled: true }),
    );
  });

  it('handlePostbackInput ignores stale payloads', async () => {
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      onboardingStep: 'grade',
    });

    await flow.handlePostbackInput('zalo-1', 'onboarding:subject:1:Toán Học');

    // updateContext should NOT be called for slot advance (stale payload ignored)
    expect(state.updateContext).not.toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({ onboardingStep: 'grade_group' }),
    );
  });

  it('handlePostbackInput applies slot when step matches', async () => {
    state.getContext.mockResolvedValue({
      zaloUserId: 'zalo-1',
      preferredLanguage: 'vi',
      onboardingStep: 'subject',
      criteria: {},
    });

    await flow.handlePostbackInput('zalo-1', 'onboarding:subject:1:Toán Học');

    expect(state.updateContext).toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({ onboardingStep: 'grade_group' }),
    );
  });

  it('isButtonOnlyStep correctly identifies steps', () => {
    expect(flow.isButtonOnlyStep('subject')).toBe(true);
    expect(flow.isButtonOnlyStep('grade_group')).toBe(true);
    expect(flow.isButtonOnlyStep('grade')).toBe(true);
    expect(flow.isButtonOnlyStep('mode')).toBe(true);
    expect(flow.isButtonOnlyStep('area')).toBe(true);
    expect(flow.isButtonOnlyStep('freetext')).toBe(false);
    expect(flow.isButtonOnlyStep('done')).toBe(false);
  });
});
