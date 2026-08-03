import { Injectable, Logger } from '@nestjs/common';
import { ZaloWebhookEvent } from '../../webhook/zalo-event.dto';
import { getZaloUserId } from '../../webhook/zalo-event.utils';
import { ZaloService } from '../../zalo/zalo.service';

@Injectable()
export class FollowHandler {
  private readonly logger = new Logger(FollowHandler.name);

  constructor(private readonly zalo: ZaloService) {}

  async handle(event: ZaloWebhookEvent): Promise<void> {
    const zaloUserId = getZaloUserId(event);
    this.logger.log(`Follow event received, zaloUserId=${zaloUserId}`);

    if (!zaloUserId) {
      this.logger.warn(
        `Follow event missing sender id: ${JSON.stringify(event)}`,
      );
      return;
    }

    await this.zalo.sendText(zaloUserId, 'Chào mừng bạn đến với Tutora!');
  }
}
