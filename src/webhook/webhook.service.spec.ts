import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { WebhookService } from './webhook.service';

describe('WebhookService', () => {
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => {
      const values: Record<string, unknown> = {
        'zalo.webhookSecret': 'zalo-secret',
        'backend.eventSecret': 'be-secret',
        stubMode: false,
      };
      return values[key] ?? fallback;
    }),
  };

  const followHandler = { handle: jest.fn() };
  const postbackHandler = { handle: jest.fn() };
  const beEventHandler = { handle: jest.fn() };
  const conversationState = { tryClaimBeEvent: jest.fn() };
  const chatLog = { record: jest.fn() };

  let service: WebhookService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebhookService(
      config as never,
      followHandler as never,
      postbackHandler as never,
      beEventHandler as never,
      conversationState as never,
      chatLog as never,
    );
  });

  it('verifies valid Zalo signatures', () => {
    const rawBody = Buffer.from('{"event_name":"follow"}');
    const body = {
      event_name: 'follow',
      app_id: 'app-1',
      timestamp: '1700000000',
    };
    const mac = createHash('sha256')
      .update(
        body.app_id + rawBody.toString('utf8') + body.timestamp + 'zalo-secret',
      )
      .digest('hex');

    expect(() =>
      service.verifyZaloSignature(`mac=${mac}`, rawBody, body),
    ).not.toThrow();
  });

  it('rejects invalid Zalo signatures', () => {
    const rawBody = Buffer.from('{"event_name":"follow"}');
    const body = {
      event_name: 'follow',
      app_id: 'app-1',
      timestamp: '1700000000',
    };

    expect(() =>
      service.verifyZaloSignature('mac=bad-signature', rawBody, body),
    ).toThrow(UnauthorizedException);
  });

  it.each([
    'user_send_text',
    'user_send_image',
    'oa_send_text',
    'oa_send_list',
  ])('records %s to chat log without replying', async (eventName) => {
    const event = { event_name: eventName };
    await service.dispatchZaloEvent(event);

    expect(chatLog.record).toHaveBeenCalledWith(event);
    expect(followHandler.handle).not.toHaveBeenCalled();
    expect(postbackHandler.handle).not.toHaveBeenCalled();
  });

  it('does not record seen/received status events', async () => {
    await service.dispatchZaloEvent({ event_name: 'user_seen_message' });

    expect(chatLog.record).not.toHaveBeenCalled();
  });

  it('deduplicates BE events before handling', async () => {
    conversationState.tryClaimBeEvent.mockResolvedValue(false);

    const result = await service.dispatchBeEvent({
      eventId: 'event-1',
      occurredAt: new Date().toISOString(),
      dedupeKey: 'payment_confirmed:zalo-1:1',
      eventType: 'payment_confirmed',
      zaloUserId: 'zalo-1',
      payload: { bookingId: 1, amount: 100000 },
    });

    expect(result).toBe('duplicate');
    expect(beEventHandler.handle).not.toHaveBeenCalled();
  });
});
