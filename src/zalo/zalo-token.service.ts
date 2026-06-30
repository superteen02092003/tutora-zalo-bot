import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { RedisService } from '../common/redis/redis.service';

// Bot đọc AccessToken từ Redis key của backend (zalo:oa:access_token).
// Backend là nơi duy nhất refresh token — tránh xung đột rotating RefreshToken.
const BACKEND_REDIS_KEY = 'zalo:oa:access_token';
const SEED_LIFETIME_MS = 23 * 60 * 60 * 1000;

@Injectable()
export class ZaloTokenService implements OnModuleInit {
  private readonly logger = new Logger(ZaloTokenService.name);
  private fallbackToken?: string;

  constructor(
    private readonly http: HttpService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.fallbackToken = this.config.get<string>('zalo.accessToken');
    const token = await this.getAccessToken();
    if (token) {
      this.logger.log('Zalo access token loaded from Redis (backend-managed).');
    } else {
      this.logger.warn('Zalo access token not found in Redis. Using env fallback.');
    }
  }

  /** Đọc AccessToken từ Redis (backend quản lý). Fallback sang env nếu Redis trống. */
  async getAccessToken(): Promise<string | undefined> {
    try {
      const token = await this.redis.getClient().get(BACKEND_REDIS_KEY);
      if (token) return token;
    } catch (error) {
      this.logger.warn(`Không đọc được token từ Redis: ${String(error)}`);
    }
    return this.fallbackToken;
  }
}
