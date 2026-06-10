import { Module } from '@nestjs/common';
import { BeClientModule } from '../be-client/be-client.module';
import { DeepSeekService } from './deepseek.service';
import { LlmRouterService } from './llm-router.service';

@Module({
  imports: [BeClientModule],
  providers: [DeepSeekService, LlmRouterService],
  exports: [DeepSeekService, LlmRouterService],
})
export class LlmModule {}
