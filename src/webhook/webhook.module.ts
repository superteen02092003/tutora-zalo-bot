import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { BeClientModule } from '../be-client/be-client.module';
import { BeEventHandler } from '../bot/handlers/be-event.handler';
import { FollowHandler } from '../bot/handlers/follow.handler';
import { MessageHandler } from '../bot/handlers/message.handler';
import { PostbackHandler } from '../bot/handlers/postback.handler';
import { ConversationStateModule } from '../bot/state/conversation-state.module';
import { AgentMatchingFlow } from '../bot/flows/agent-matching.flow';
import { MatchingFlow } from '../bot/flows/matching.flow';
import { OnboardingFlow } from '../bot/flows/onboarding.flow';
import { RedisModule } from '../common/redis/redis.module';
import { LlmModule } from '../llm/llm.module';
import { ZaloModule } from '../zalo/zalo.module';
import { BeEventsController } from './be-events.controller';
import { UserSerialQueue } from './user-serial-queue.service';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

@Module({
  imports: [AgentModule, BeClientModule, ConversationStateModule, LlmModule, RedisModule, ZaloModule],
  controllers: [WebhookController, BeEventsController],
  providers: [
    WebhookService,
    FollowHandler,
    MessageHandler,
    PostbackHandler,
    BeEventHandler,
    AgentMatchingFlow,
    OnboardingFlow,
    MatchingFlow,
    UserSerialQueue,
  ],
})
export class WebhookModule {}
