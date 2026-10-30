import { Module } from '@nestjs/common';
import { BeClientModule } from '../be-client/be-client.module';
import { BeEventHandler } from '../bot/handlers/be-event.handler';
import { FollowHandler } from '../bot/handlers/follow.handler';
import { PostbackHandler } from '../bot/handlers/postback.handler';
import { ConversationStateModule } from '../bot/state/conversation-state.module';
import { ChatLogModule } from '../chat-log/chat-log.module';
import { RedisModule } from '../common/redis/redis.module';
import { ZaloModule } from '../zalo/zalo.module';
import { BeEventsController } from './be-events.controller';
import { UserSerialQueue } from './user-serial-queue.service';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

@Module({
  imports: [
    BeClientModule,
    ChatLogModule,
    ConversationStateModule,
    RedisModule,
    ZaloModule,
  ],
  controllers: [WebhookController, BeEventsController],
  providers: [
    WebhookService,
    FollowHandler,
    PostbackHandler,
    BeEventHandler,
    UserSerialQueue,
  ],
})
export class WebhookModule {}
