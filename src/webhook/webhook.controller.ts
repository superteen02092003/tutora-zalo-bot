import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { WebhookService } from './webhook.service';
import type { RequestWithRawBody, ZaloWebhookEvent } from './zalo-event.dto';

@Controller('webhook')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post('zalo')
  async handleZaloWebhook(
    @Body() body: ZaloWebhookEvent,
    @Headers('x-zalooa-signature') signature: string | undefined,
    @Req() request: Request & RequestWithRawBody,
  ): Promise<{ ok: true }> {
    this.webhookService.verifyZaloSignature(signature, request.rawBody);
    await this.webhookService.dispatchZaloEvent(body);
    return { ok: true };
  }
}
