import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { AgentClientService } from './agent-client.service';

@Module({
  imports: [HttpModule],
  providers: [AgentClientService],
  exports: [AgentClientService],
})
export class AgentModule {}
