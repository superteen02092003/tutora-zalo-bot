import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { AiClientService } from './ai-client.service';
import { BeClientService } from './be-client.service';
import { SubjectCacheService } from './subject-cache.service';

@Module({
  imports: [HttpModule],
  providers: [BeClientService, SubjectCacheService, AiClientService],
  exports: [BeClientService, SubjectCacheService, AiClientService],
})
export class BeClientModule {}
