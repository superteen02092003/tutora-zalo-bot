import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { BeClientService } from './be-client.service';
import { SubjectCacheService } from './subject-cache.service';

@Module({
  imports: [HttpModule],
  providers: [BeClientService, SubjectCacheService],
  exports: [BeClientService, SubjectCacheService],
})
export class BeClientModule {}
