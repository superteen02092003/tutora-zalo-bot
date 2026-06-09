import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { RedisModule } from '../common/redis/redis.module';
import { CalendarController } from './calendar.controller';
import { CalendarImageService } from './calendar-image.service';
import { TutorCardImageService } from './tutor-card-image.service';
import { ZaloService } from './zalo.service';
import { ZnsService } from './zns.service';

@Module({
  imports: [HttpModule, RedisModule],
  controllers: [CalendarController],
  providers: [ZaloService, ZnsService, CalendarImageService, TutorCardImageService],
  exports: [ZaloService, ZnsService, CalendarImageService, TutorCardImageService],
})
export class ZaloModule {}
