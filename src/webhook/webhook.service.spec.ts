import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
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
  const messageHandler = { handle: jest.fn() };
  const postbackHandler = { handle: jest.fn() };
  const beEventHandler = { handle: jest.fn() };
  const conversationState = { tryClaimBeEvent: jest.fn() };

  let service: WebhookService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebhookService(
      config as never,
      followHandler as never,
      messageHandler as never,
      postbackHandler as never,
      beEventHandler as never,
      conversationState as never,
    );
  });

  it('verifies valid Zalo HMAC signatures', () => {
    const rawBody = Buffer.from('{"event_name":"follow"}');
    const signature = createHmac('sha256', 'zalo-secret')
      .update(rawBody)
      .digest('hex');

    expect(() => service.verifyZaloSignature(signature, rawBody)).not.toThrow();
  });

  it('rejects invalid Zalo HMAC signatures', () => {
    expect(() =>
      service.verifyZaloSignature('bad-signature', Buffer.from('{}')),
    ).toThrow(UnauthorizedException);
  });

  it('dispatches Zalo message events', async () => {
    await service.dispatchZaloEvent({ event_name: 'user_send_text' });

    expect(messageHandler.handle).toHaveBeenCalledWith({
      event_name: 'user_send_text',
    });
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
