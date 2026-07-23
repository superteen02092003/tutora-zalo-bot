import { Injectable, Logger } from '@nestjs/common';
import { ZaloWebhookEvent } from '../../webhook/zalo-event.dto';
import { getEventPayload, getZaloUserId } from '../../webhook/zalo-event.utils';

// Không còn payload nào để route thẳng — "onboarding:"/"select_tutor:" (luồng nút bấm cũ)
// đã bỏ 2026-07-18: OnboardingFlow xoá hẳn, "Đặt lịch" trên tutor card giờ mở thẳng URL
// Mini App (oa.open.url) thay vì postback (oa.query.hide), xem
// MiniAppButtonService.buildTutorDetailLink + ZaloService.sendTutorCard. Giữ handler này
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
