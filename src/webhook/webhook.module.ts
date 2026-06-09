import { Module } from '@nestjs/common';
import { BeClientModule } from '../be-client/be-client.module';
import { BeEventHandler } from '../bot/handlers/be-event.handler';
import { FollowHandler } from '../bot/handlers/follow.handler';
import { MessageHandler } from '../bot/handlers/message.handler';
import { PostbackHandler } from '../bot/handlers/postback.handler';
import { ConversationStateModule } from '../bot/state/conversation-state.module';
import { LlmModule } from '../llm/llm.module';
import { ZaloModule } from '../zalo/zalo.module';
import { BeEventsController } from './be-events.controller';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

@Module({
  imports: [BeClientModule, ConversationStateModule, LlmModule, ZaloModule],
  controllers: [WebhookController, BeEventsController],
  providers: [
    WebhookService,
    FollowHandler,
    MessageHandler,
    PostbackHandler,
    BeEventHandler,
  ],
})
export class WebhookModule {}
