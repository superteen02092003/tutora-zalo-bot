import { BadRequestException, Injectable } from '@nestjs/common';
import { RedisService } from '../../common/redis/redis.service';
import { ConversationContext } from './conversation-context.interface';
import { ConversationState } from './conversation-state.enum';

export interface ConversationRecord {
  state: ConversationState;
  context: ConversationContext;
  updatedAt: string;
}

export const CONVERSATION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const MATCHING_TTL_SECONDS = 60 * 60;
export const BE_EVENT_TTL_SECONDS = 3 * 24 * 60 * 60;

const ALLOWED_TRANSITIONS: Record<ConversationState, ConversationState[]> = {
  [ConversationState.New]: [ConversationState.Onboarding],
  [ConversationState.Onboarding]: [
    ConversationState.Matched,
    ConversationState.New,
  ],
  [ConversationState.Matched]: [
    ConversationState.BookingConfirm,
    ConversationState.Onboarding,
  ],
  [ConversationState.BookingConfirm]: [
    ConversationState.Booked,
    ConversationState.Matched,
    ConversationState.New,
  ],
  [ConversationState.Booked]: [
    ConversationState.Active,
    ConversationState.Onboarding,
  ],
  [ConversationState.Active]: [
    ConversationState.Onboarding,
    ConversationState.Matched,
  ],
};

@Injectable()
export class ConversationStateService {
  constructor(private readonly redisService: RedisService) {}

  async getState(zaloUserId: string): Promise<ConversationState> {
    const record = await this.getRecord(zaloUserId);
    return record?.state ?? ConversationState.New;
  }

  async getConversation(zaloUserId: string): Promise<ConversationRecord> {
    const record = await this.getRecord(zaloUserId);
    return (
      record ?? {
        state: ConversationState.New,
        context: { zaloUserId },
        updatedAt: new Date().toISOString(),
      }
    );
  }

  async setState(zaloUserId: string, state: ConversationState): Promise<void> {
    const record = await this.getRecord(zaloUserId);
    await this.setRecord(zaloUserId, {
      state,
      context: record?.context ?? { zaloUserId },
      updatedAt: new Date().toISOString(),
    });
  }

  async transitionState(
    zaloUserId: string,
    nextState: ConversationState,
  ): Promise<void> {
    const currentState = await this.getState(zaloUserId);

    if (currentState === nextState) {
      return;
    }

    if (!ALLOWED_TRANSITIONS[currentState].includes(nextState)) {
      throw new BadRequestException(
        `Invalid conversation transition: ${currentState} -> ${nextState}`,
      );
    }

    await this.setState(zaloUserId, nextState);
  }

  async getContext<T extends ConversationContext = ConversationContext>(
    zaloUserId: string,
  ): Promise<T> {
    const record = await this.getRecord(zaloUserId);
    return (record?.context ?? { zaloUserId }) as T;
  }

  async setContext<T extends ConversationContext>(
    zaloUserId: string,
    context: T,
  ): Promise<void> {
    const record = await this.getRecord(zaloUserId);
    await this.setRecord(zaloUserId, {
      state: record?.state ?? ConversationState.New,
      context,
      updatedAt: new Date().toISOString(),
    });
  }

  async updateContext<T extends ConversationContext>(
    zaloUserId: string,
    partial: Partial<T>,
  ): Promise<T> {
    const context = await this.getContext<T>(zaloUserId);
    const nextContext = { ...context, ...partial, zaloUserId } as T;
    await this.setContext(zaloUserId, nextContext);
    return nextContext;
  }

  async clearContextFields(
    zaloUserId: string,
    fields: Array<keyof ConversationContext>,
  ): Promise<ConversationContext> {
    const context = await this.getContext(zaloUserId);
    const nextContext = { ...context };

    for (const field of fields) {
      delete nextContext[field];
    }

    await this.setContext(zaloUserId, nextContext);
    return nextContext;
  }

  async resetConversation(zaloUserId: string): Promise<void> {
    const client = this.redisService.getClient();
    await client.del(this.conversationKey(zaloUserId));
    await client.del(this.messageCountKey(zaloUserId));
    await client.del(this.matchingKey(zaloUserId));
  }

  async resetMsgCount(zaloUserId: string): Promise<void> {
    await this.redisService.getClient().del(this.messageCountKey(zaloUserId));
  }

  async incrementMsgCount(zaloUserId: string): Promise<number> {
    const client = this.redisService.getClient();
    const key = this.messageCountKey(zaloUserId);
    const count = await client.incr(key);
    await client.expire(key, CONVERSATION_TTL_SECONDS);
    return count;
  }

  async setMatchingCandidates<T>(
    zaloUserId: string,
    candidates: T[],
  ): Promise<void> {
    await this.redisService
      .getClient()
      .set(
        this.matchingKey(zaloUserId),
        JSON.stringify(candidates),
        'EX',
        MATCHING_TTL_SECONDS,
      );
  }

  async getMatchingCandidates<T>(zaloUserId: string): Promise<T[]> {
    const raw = await this.redisService
      .getClient()
      .get(this.matchingKey(zaloUserId));
    return raw ? (JSON.parse(raw) as T[]) : [];
  }

  async clearMatchingCandidates(zaloUserId: string): Promise<void> {
    await this.redisService.getClient().del(this.matchingKey(zaloUserId));
  }

  async tryClaimBeEvent(eventId: string): Promise<boolean> {
    const result = await this.redisService
      .getClient()
      .set(`be-event:${eventId}`, '1', 'EX', BE_EVENT_TTL_SECONDS, 'NX');
    return result === 'OK';
  }

  async getLastActivity(zaloUserId: string): Promise<Date | null> {
    const record = await this.getRecord(zaloUserId);
    return record?.updatedAt ? new Date(record.updatedAt) : null;
  }

  private async getRecord(
    zaloUserId: string,
  ): Promise<ConversationRecord | null> {
    const raw = await this.redisService
      .getClient()
      .get(this.conversationKey(zaloUserId));
    return raw ? (JSON.parse(raw) as ConversationRecord) : null;
  }

  private async setRecord(
    zaloUserId: string,
    record: ConversationRecord,
  ): Promise<void> {
    await this.redisService
      .getClient()
      .set(
        this.conversationKey(zaloUserId),
        JSON.stringify(record),
        'EX',
        CONVERSATION_TTL_SECONDS,
      );
  }

  private conversationKey(zaloUserId: string): string {
    return `conversation:${zaloUserId}`;
  }

  private messageCountKey(zaloUserId: string): string {
    return `conversation:${zaloUserId}:msgs`;
  }

  private matchingKey(zaloUserId: string): string {
    return `matching:${zaloUserId}:candidates`;
  }
}
