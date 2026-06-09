import { ConversationStateService } from './conversation-state.service';
import { ConversationState } from './conversation-state.enum';

class FakeRedisClient {
  private readonly store = new Map<string, string>();
  readonly expires = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<'OK' | null> {
    if (args.includes('NX') && this.store.has(key)) {
      return null;
    }

    this.store.set(key, value);

    const exIndex = args.indexOf('EX');
    if (exIndex >= 0) {
      this.expires.set(key, Number(args[exIndex + 1]));
    }

    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async incr(key: string): Promise<number> {
    const nextValue = Number(this.store.get(key) ?? '0') + 1;
    this.store.set(key, String(nextValue));
    return nextValue;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.expires.set(key, seconds);
    return 1;
  }
}

describe('ConversationStateService', () => {
  let service: ConversationStateService;
  let redis: FakeRedisClient;

  beforeEach(() => {
    redis = new FakeRedisClient();
    service = new ConversationStateService({
      getClient: () => redis,
    } as never);
  });

  it('defaults to NEW state', async () => {
    await expect(service.getState('zalo-1')).resolves.toBe(
      ConversationState.New,
    );
  });

  it('updates context while preserving zaloUserId', async () => {
    await service.updateContext('zalo-1', { parentId: 'parent-1' });

    await expect(service.getContext('zalo-1')).resolves.toMatchObject({
      zaloUserId: 'zalo-1',
      parentId: 'parent-1',
    });
  });

  it('returns full conversation records', async () => {
    await service.setState('zalo-1', ConversationState.Onboarding);
    await service.updateContext('zalo-1', { parentId: 'parent-1' });

    await expect(service.getConversation('zalo-1')).resolves.toMatchObject({
      state: ConversationState.Onboarding,
      context: {
        zaloUserId: 'zalo-1',
        parentId: 'parent-1',
      },
    });
  });

  it('allows valid transitions', async () => {
    await service.transitionState('zalo-1', ConversationState.Onboarding);
    await service.transitionState('zalo-1', ConversationState.Matched);

    await expect(service.getState('zalo-1')).resolves.toBe(
      ConversationState.Matched,
    );
  });

  it('rejects invalid transitions', async () => {
    await expect(
      service.transitionState('zalo-1', ConversationState.Active),
    ).rejects.toThrow('Invalid conversation transition');
  });

  it('increments and resets message count', async () => {
    await expect(service.incrementMsgCount('zalo-1')).resolves.toBe(1);
    await expect(service.incrementMsgCount('zalo-1')).resolves.toBe(2);

    await service.resetMsgCount('zalo-1');

    await expect(service.incrementMsgCount('zalo-1')).resolves.toBe(1);
  });

  it('stores and clears matching candidates', async () => {
    await service.setMatchingCandidates('zalo-1', [{ tutorId: 'tutor-1' }]);

    await expect(service.getMatchingCandidates('zalo-1')).resolves.toEqual([
      { tutorId: 'tutor-1' },
    ]);

    await service.clearMatchingCandidates('zalo-1');

    await expect(service.getMatchingCandidates('zalo-1')).resolves.toEqual([]);
  });

  it('claims BE events only once', async () => {
    await expect(service.tryClaimBeEvent('event-1')).resolves.toBe(true);
    await expect(service.tryClaimBeEvent('event-1')).resolves.toBe(false);
  });
});
