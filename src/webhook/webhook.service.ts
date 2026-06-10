import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { BeEventDto } from '../be-client/dto';
import { BeEventHandler } from '../bot/handlers/be-event.handler';
import { FollowHandler } from '../bot/handlers/follow.handler';
import { MessageHandler } from '../bot/handlers/message.handler';
import { PostbackHandler } from '../bot/handlers/postback.handler';
import { ConversationStateService } from '../bot/state/conversation-state.service';
import { ZaloWebhookEvent } from './zalo-event.dto';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly zaloWebhookSecret?: string;
  private readonly beEventSecret?: string;
  private readonly stubMode: boolean;

  constructor(
    config: ConfigService,
    private readonly followHandler: FollowHandler,
    private readonly messageHandler: MessageHandler,
    private readonly postbackHandler: PostbackHandler,
    private readonly beEventHandler: BeEventHandler,
    private readonly conversationState: ConversationStateService,
  ) {
    this.zaloWebhookSecret = config.get<string>('zalo.webhookSecret');
    this.beEventSecret = config.get<string>('backend.eventSecret');
    this.stubMode = config.get<boolean>('stubMode', true);
  }

  verifyZaloSignature(
    signature: string | undefined,
    rawBody: Buffer | undefined,
    body: ZaloWebhookEvent,
  ): void {
    if (this.stubMode && !this.zaloWebhookSecret) {
      return;
    }

    if (!this.zaloWebhookSecret || !signature || !rawBody) {
      throw new UnauthorizedException('Missing Zalo webhook signature');
    }

    // Zalo OA signature: SHA256(appId + data + timestamp + OASecretKey)
    // header format: "mac=<hash>"; data = raw request body string.
    const mac = signature.startsWith('mac=') ? signature.slice(4) : signature;
    const appId = String(body.app_id ?? '');
    const timestamp = String(body.timestamp ?? '');
    const expectedSignature = createHash('sha256')
      .update(appId + rawBody.toString('utf8') + timestamp + this.zaloWebhookSecret)
      .digest('hex');

    if (!this.safeEqual(mac, expectedSignature)) {
      this.logger.warn(
        `Zalo signature mismatch | received=${mac} expected=${expectedSignature} appId=${appId} ts=${timestamp}`,
      );
      throw new UnauthorizedException('Invalid Zalo webhook signature');
    }
  }

  async dispatchZaloEvent(event: ZaloWebhookEvent): Promise<void> {
    const eventType = event.event_name ?? event.eventName;
    const userId = event.sender?.id ?? event.follower?.id ?? 'unknown';
    const text = event.message?.text ?? '';
    const postbackData = (event.postback as any)?.data ?? '';
    const quickReplyPayload = event.message?.quick_reply?.payload ?? '';

    this.logger.log(
      `Zalo event: ${eventType} | user=${userId}` +
      ` | text="${text}"` +
      (postbackData ? ` | postback.data="${postbackData}"` : '') +
      (quickReplyPayload ? ` | quick_reply.payload="${quickReplyPayload}"` : ''),
    );

    switch (eventType) {
      case 'follow':
        await this.followHandler.handle(event);
        break;
      case 'user_send_text':
      case 'user_send_image':
      case 'user_send_sticker':
        await this.messageHandler.handle(event);
        break;
      case 'postback':
        await this.postbackHandler.handle(event);
        break;
      case 'oa_send_text':
      case 'unfollow':
        this.logger.debug(`Ignoring Zalo event type: ${eventType}`);
        break;
      default:
        this.logger.warn(`Unknown Zalo event type: ${eventType ?? 'missing'} | raw: ${JSON.stringify(event).slice(0, 200)}`);
    }
  }

  verifyBeEventSecret(secret: string | undefined): void {
    if (this.stubMode && !this.beEventSecret) {
      return;
    }

    if (
      !this.beEventSecret ||
      !secret ||
      !this.safeEqual(secret, this.beEventSecret)
    ) {
      throw new ForbiddenException('Invalid BE event secret');
    }
  }

  async dispatchBeEvent(event: BeEventDto): Promise<'processed' | 'duplicate'> {
    const claimed = await this.conversationState.tryClaimBeEvent(event.eventId);

    if (!claimed) {
      return 'duplicate';
    }

    await this.beEventHandler.handle(event);
    return 'processed';
  }

  private safeEqual(input: string, expected: string): boolean {
    const inputBuffer = Buffer.from(input);
    const expectedBuffer = Buffer.from(expected);

    if (inputBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(inputBuffer, expectedBuffer);
  }
}
