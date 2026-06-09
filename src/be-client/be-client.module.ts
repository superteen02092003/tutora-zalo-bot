import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { BeClientService } from './be-client.service';

@Module({
  imports: [HttpModule],
  providers: [BeClientService],
  exports: [BeClientService],
})
export class BeClientModule {}
