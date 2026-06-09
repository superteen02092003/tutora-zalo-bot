import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.get<string>('redis.url')!, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  getClient(): Redis {
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }
}
