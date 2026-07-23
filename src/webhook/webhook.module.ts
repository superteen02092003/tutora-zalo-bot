import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { BeClientModule } from '../be-client/be-client.module';
import { BeEventHandler } from '../bot/handlers/be-event.handler';
import { FollowHandler } from '../bot/handlers/follow.handler';
import { MessageHandler } from '../bot/handlers/message.handler';
import { PostbackHandler } from '../bot/handlers/postback.handler';
import { ConversationStateModule } from '../bot/state/conversation-state.module';
import { MiniAppSearchFlow } from '../bot/flows/mini-app-search.flow';
import { RedisModule } from '../common/redis/redis.module';
import { MiniAppTokenService } from '../mini-app/mini-app-token.service';
import { MiniAppButtonService } from '../mini-app/mini-app-button.service';
import { ZaloModule } from '../zalo/zalo.module';
import { BeEventsController } from './be-events.controller';
import { MiniAppController } from './mini-app.controller';
import { UserSerialQueue } from './user-serial-queue.service';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

@Module({
  imports: [
    AgentModule,
    BeClientModule,
    ConversationStateModule,
    RedisModule,
    ZaloModule,
  ],
  controllers: [WebhookController, BeEventsController, MiniAppController],
  providers: [
    WebhookService,
    FollowHandler,
    MessageHandler,
    PostbackHandler,
    BeEventHandler,
    MiniAppSearchFlow,
    MiniAppTokenService,
    MiniAppButtonService,
    UserSerialQueue,
  ],
})
export class WebhookModule {}
