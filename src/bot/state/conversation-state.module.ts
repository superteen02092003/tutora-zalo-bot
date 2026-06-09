import { Module } from '@nestjs/common';
import { RedisModule } from '../../common/redis/redis.module';
import { ConversationStateService } from './conversation-state.service';

@Module({
  imports: [RedisModule],
  providers: [ConversationStateService],
  exports: [ConversationStateService],
})
export class ConversationStateModule {}
