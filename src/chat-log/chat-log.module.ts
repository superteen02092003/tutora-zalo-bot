import { Module } from '@nestjs/common';
import { ChatLogService } from './chat-log.service';

@Module({
  providers: [ChatLogService],
  exports: [ChatLogService],
})
export class ChatLogModule {}
