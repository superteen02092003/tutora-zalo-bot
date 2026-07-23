import { ConfigService } from '@nestjs/config';
import { MessageHandler } from './message.handler';

describe('MessageHandler', () => {
  const state = {
    getContext: jest.fn(),
    updateContext: jest.fn(),
  };
  const zalo = {
    sendText: jest.fn(),
  };
  const miniAppButton = { sendSearchButton: jest.fn() };
  const config = {
    get: jest.fn((key: string, defaultValue?: unknown) =>
      key === 'adminZaloUserIds' ? [] : defaultValue,
    ),
  } as unknown as ConfigService;

  let handler: MessageHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    state.getContext.mockResolvedValue({});
    handler = new MessageHandler(
      state as never,
      zalo as never,
      miniAppButton as never,
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

    expect(miniAppButton.sendSearchButton).not.toHaveBeenCalled();
  });

  it('sends Mini App search button for a trigger phrase', async () => {
    state.getContext.mockResolvedValue({ preferredLanguage: 'vi' });

    await handler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: { text: 'tìm gia sư' },
    });

    expect(miniAppButton.sendSearchButton).toHaveBeenCalledWith('zalo-1', 'vi');
  });

  it('sends Mini App search button for free-text messages too (no more chat/LLM matching)', async () => {
    await handler.handle({
      event_name: 'user_send_text',
      sender: { id: 'zalo-1' },
      message: { text: 'tìm gia sư Toán lớp 8 ôn thi' },
    });

    expect(miniAppButton.sendSearchButton).toHaveBeenCalledWith('zalo-1', 'vi');
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

  it('handles /botchat admin command without opening the Mini App button', async () => {
    const adminConfig = {
      get: jest.fn((key: string, defaultValue?: unknown) =>
        key === 'adminZaloUserIds' ? ['admin-1'] : defaultValue,
      ),
    } as unknown as ConfigService;
    const adminHandler = new MessageHandler(
      state as never,
      zalo as never,
      miniAppButton as never,
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
    expect(miniAppButton.sendSearchButton).not.toHaveBeenCalled();
  });
});
