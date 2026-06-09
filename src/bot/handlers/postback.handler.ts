import { Injectable, Logger } from '@nestjs/common';
import { ZaloWebhookEvent } from '../../webhook/zalo-event.dto';
import { getEventPayload, getZaloUserId } from '../../webhook/zalo-event.utils';

@Injectable()
export class PostbackHandler {
  private readonly logger = new Logger(PostbackHandler.name);

  async handle(event: ZaloWebhookEvent): Promise<void> {
    const zaloUserId = getZaloUserId(event);
    const payload = getEventPayload(event);

    if (!zaloUserId) {
      this.logger.warn(`Postback event missing sender id: ${JSON.stringify(event)}`);
      return;
    }

    // TODO: implement postback routing here
    this.logger.debug(`Postback | user=${zaloUserId} | payload="${payload}"`);
  }
}
