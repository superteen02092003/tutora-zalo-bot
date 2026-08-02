import { ConfigService } from '@nestjs/config';
import { MessageHandler } from './message.handler';

describe('MessageHandler', () => {
  const state = {
    getContext: jest.fn(),
    updateContext: jest.fn(),
  };
  const zalo = {
    sendText: jest.fn(),
    sendQuickReply: jest.fn(),
    sendTutorCard: jest.fn(),
  };
  const miniAppButton = {
    sendSearchButton: jest.fn(),
    buildTutorDetailLink: jest.fn((tutorId: string, openBooking = false) =>
      `https://zalo.me/s/mini-app/tutor-detail/${tutorId}${openBooking ? '?openBooking=1' : ''}`,
    ),
  };
  const agentClient = {
    chat: jest.fn(),
  };
  const config = {
    get: jest.fn((key: string, defaultValue?: unknown) =>
      key === 'adminZaloUserIds' ? [] : defaultValue,
    ),
  } as unknown as ConfigService;

  const baseAgentResponse = {
    reply: 'Dạ em chào anh/chị ạ!',
    tutors: [],
    handoff_to_booking: false,
    reopen_mini_app: false,
    reopen_mini_app_fresh: false,
    awaiting_confirmation: false,
    confirm_type: null,
    suggestions: [],
    context_patch: null,
  };

  let handler: MessageHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    state.getContext.mockResolvedValue({});
    agentClient.chat.mockResolvedValue({ ...baseAgentResponse });
    handler = new MessageHandler(
      state as never,
      zalo as never,
      miniAppButton as never,
      agentClient as never,
      config,
    );
  });

  it('skips processing when botChatDisabled', async () => {
    state.getContext.mockResolvedValue({ botChatDisabled: true });

    await handler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: { text: 'hi' },
    });

    expect(agentClient.chat).not.toHaveBeenCalled();
    expect(miniAppButton.sendSearchButton).not.toHaveBeenCalled();
  });

  it('sends the Mini App button directly for non-text messages (no agent call)', async () => {
    await handler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: {},
    });

    expect(agentClient.chat).not.toHaveBeenCalled();
    expect(miniAppButton.sendSearchButton).toHaveBeenCalledWith('zalo-1', 'vi');
  });

  it('calls the agent for free-text messages and replies with its natural text', async () => {
    state.getContext.mockResolvedValue({ preferredLanguage: 'vi' });

    await handler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: { text: 'Con em học lớp 8, cần tìm gia sư Toán' },
    });

    expect(agentClient.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Con em học lớp 8, cần tìm gia sư Toán',
        channel: 'zalo',
        history: [],
        shown_tutors: [],
        context: expect.objectContaining({ preferred_language: 'vi' }),
      }),
    );
    expect(zalo.sendText).toHaveBeenCalledWith('zalo-1', baseAgentResponse.reply);
    expect(miniAppButton.sendSearchButton).not.toHaveBeenCalled();
  });

  it('sends quick-reply buttons instead of plain text when the agent returns suggestions', async () => {
    agentClient.chat.mockResolvedValue({
      ...baseAgentResponse,
      reply: 'Anh/chị muốn tìm gia sư cho lớp mấy ạ?',
      suggestions: ['Lớp 8', 'Lớp 9'],
    });

    await handler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: { text: 'tìm gia sư' },
    });

    expect(zalo.sendQuickReply).toHaveBeenCalledWith(
      'zalo-1',
      'Anh/chị muốn tìm gia sư cho lớp mấy ạ?',
      [
        { title: 'Lớp 8', payload: 'Lớp 8' },
        { title: 'Lớp 9', payload: 'Lớp 9' },
      ],
    );
    expect(zalo.sendText).not.toHaveBeenCalled();
  });

  it('opens the Mini App (fresh) when the agent asks to reopen it', async () => {
    agentClient.chat.mockResolvedValue({
      ...baseAgentResponse,
      reopen_mini_app: true,
      reopen_mini_app_fresh: true,
    });

    await handler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: { text: 'em muốn đổi nhu cầu khác hẳn' },
    });

    expect(miniAppButton.sendSearchButton).toHaveBeenCalledWith(
      'zalo-1',
      'vi',
      true,
    );
  });

  it('renders up to 3 tutor cards and tracks them as shownTutors', async () => {
    const tutors = Array.from({ length: 4 }, (_, i) => ({
      tutorId: `t${i}`,
      fullName: `Gia sư ${i}`,
    }));
    agentClient.chat.mockResolvedValue({ ...baseAgentResponse, tutors });

    await handler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: { text: 'gợi ý gia sư cho em' },
    });

    expect(zalo.sendTutorCard).toHaveBeenCalledTimes(3);
    expect(state.updateContext).toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({
        shownTutors: [
          { tutor_id: 't0', name: 'Gia sư 0' },
          { tutor_id: 't1', name: 'Gia sư 1' },
          { tutor_id: 't2', name: 'Gia sư 2' },
          { tutor_id: 't3', name: 'Gia sư 3' },
        ],
      }),
    );
  });

  it('persists chatHistory (capped) and merges context_patch into agentCtx', async () => {
    state.getContext.mockResolvedValue({
      preferredLanguage: 'vi',
      agentCtx: { subject_id: 5 },
      chatHistory: [{ role: 'user', content: 'lượt trước' }],
    });
    agentClient.chat.mockResolvedValue({
      ...baseAgentResponse,
      context_patch: { grade_level_id: 8 },
    });

    await handler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: { text: 'lớp 8 ạ' },
    });

    expect(state.updateContext).toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({
        chatHistory: [
          { role: 'user', content: 'lượt trước' },
          { role: 'user', content: 'lớp 8 ạ' },
          { role: 'assistant', content: baseAgentResponse.reply },
        ],
        agentCtx: { subject_id: 5, grade_level_id: 8 },
      }),
    );
  });

  it('falls back to the Mini App button when the agent call fails', async () => {
    agentClient.chat.mockRejectedValue(new Error('timeout'));

    await handler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: { text: 'tìm gia sư Toán lớp 8 ôn thi' },
    });

    expect(miniAppButton.sendSearchButton).toHaveBeenCalledWith('zalo-1', 'vi');
    expect(zalo.sendText).not.toHaveBeenCalled();
    expect(state.updateContext).not.toHaveBeenCalledWith(
      'zalo-1',
      expect.objectContaining({ chatHistory: expect.anything() }),
    );
  });

  it('auto-detects Vietnamese and persists preferredLanguage when it changes', async () => {
    state.getContext.mockResolvedValue({});

    await handler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: { text: 'Xin chào, tôi cần tìm gia sư' },
    });

    expect(state.updateContext).toHaveBeenCalledWith('zalo-1', {
      preferredLanguage: 'vi',
    });
  });

  it('handles /botchat admin command without calling the agent', async () => {
    const adminConfig = {
      get: jest.fn((key: string, defaultValue?: unknown) =>
        key === 'adminZaloUserIds' ? ['admin-1'] : defaultValue,
      ),
    } as unknown as ConfigService;
    const adminHandler = new MessageHandler(
      state as never,
      zalo as never,
      miniAppButton as never,
      agentClient as never,
      adminConfig,
    );

    await adminHandler.handle({
      event_name: 'user_send_text',
      sender: { id: 'admin-1' },
      message: { text: '/botchat off zalo-2' },
    });

    expect(state.updateContext).toHaveBeenCalledWith('zalo-2', {
      botChatDisabled: true,
    });
    expect(agentClient.chat).not.toHaveBeenCalled();
    expect(miniAppButton.sendSearchButton).not.toHaveBeenCalled();
  });
});
