import { Body, Controller, Headers, Post } from '@nestjs/common';
import type { BeEventDto } from '../be-client/dto';
import { WebhookService } from './webhook.service';

@Controller('internal')
export class BeEventsController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post('be-events')
  async handleBeEvent(
    @Body() body: BeEventDto,
    @Headers('x-be-event-secret') secret: string | undefined,
  ): Promise<{ ok: true; status: 'processed' | 'duplicate' }> {
    this.webhookService.verifyBeEventSecret(secret);
    const status = await this.webhookService.dispatchBeEvent(body);
    return { ok: true, status };
  }
}
