import { Body, Controller, Headers, Logger, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { UserSerialQueue } from './user-serial-queue.service';
import { WebhookService } from './webhook.service';
import type { RequestWithRawBody, ZaloWebhookEvent } from './zalo-event.dto';
import { getZaloUserId } from './zalo-event.utils';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly webhookService: WebhookService,
    private readonly queue: UserSerialQueue,
  ) {}

  @Post('zalo')
  handleZaloWebhook(
    @Body() body: ZaloWebhookEvent,
    @Headers('x-zevent-signature') signature: string | undefined,
    @Req() request: Request & RequestWithRawBody,
  ): { ok: true } {
    this.webhookService.verifyZaloSignature(signature, request.rawBody, body);

    // Ack ngay với 200 OK; xử lý event chạy ngầm để Zalo không bị timeout (408).
    // Xếp hàng theo userId để các tin của cùng một user chạy tuần tự, đúng thứ tự
    // — tránh race khi nhiều webhook tới gần nhau cùng đọc/ghi conversation state.
    const userId = getZaloUserId(body) ?? 'unknown';
    void this.queue
      .run(userId, () => this.webhookService.dispatchZaloEvent(body))
      .catch((error) =>
        this.logger.error(`dispatchZaloEvent failed: ${String(error)}`, (error as Error)?.stack),
      );

    return { ok: true };
  }
}
