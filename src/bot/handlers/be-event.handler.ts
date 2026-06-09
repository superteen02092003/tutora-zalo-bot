import { Injectable, Logger } from '@nestjs/common';
import { BeEventDto } from '../../be-client/dto';

@Injectable()
export class BeEventHandler {
  private readonly logger = new Logger(BeEventHandler.name);

  async handle(event: BeEventDto): Promise<void> {
    // TODO: implement BE event handling here
    this.logger.log(`BE event received: ${event.eventType} for user ${event.zaloUserId}`);
  }
}
