import { Module } from '@nestjs/common';
import { DeepSeekService } from './deepseek.service';
import { LlmRouterService } from './llm-router.service';

@Module({
  providers: [DeepSeekService, LlmRouterService],
  exports: [DeepSeekService, LlmRouterService],
})
export class LlmModule {}
