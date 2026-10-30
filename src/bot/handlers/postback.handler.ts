import { Injectable, Logger } from '@nestjs/common';
import { ZaloWebhookEvent } from '../../webhook/zalo-event.dto';
import { getEventPayload, getZaloUserId } from '../../webhook/zalo-event.utils';

// Không còn payload nào để route thẳng — luồng nút bấm cũ (onboarding, tutor card, Mini App
// tìm gia sư) đã bỏ hết. Giữ handler này
// (đăng ký ở WebhookModule, WebhookService.dispatchZaloEvent case 'postback') chỉ để log
// nếu Zalo gửi 1 postback nào đó ta chưa biết tới, tránh vỡ dispatch nếu type event vẫn
// còn phát sinh từ phía Zalo (template button mặc định...).
@Injectable()
export class PostbackHandler {
  private readonly logger = new Logger(PostbackHandler.name);

  handle(event: ZaloWebhookEvent): void {
    const userId = getZaloUserId(event);
    const payload = getEventPayload(event);
    this.logger.debug(`Postback | user=${userId} | payload="${payload}"`);
    if (payload) {
      this.logger.warn(`Unhandled postback payload: "${payload}"`);
    }
  }
}
