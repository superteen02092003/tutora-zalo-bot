import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { RedisService } from '../common/redis/redis.service';

const ZALO_OAUTH_URL = 'https://oauth.zaloapp.com/v4/oa/access_token';
const REDIS_KEY = 'zalo:oa:token';
// Zalo OA access_token CHỈ sống 1h (không phải ~25h như code cũ giả định — đây là bug
// gốc gây lỗi "-216 expired" liên tục: token seed từ env bị coi là còn hạn rất lâu trong
// khi thực tế Zalo đã hết hạn từ lâu). Nguồn: developers.zalo.me (access token 1h,
// refresh token single-use ~3 tháng).
const ACCESS_TOKEN_LIFETIME_MS = 60 * 60 * 1000; // 1h — đúng thực tế Zalo OA
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh khi còn dưới 5' (không thể >= lifetime)
// Seed từ .env: KHÔNG biết token đã tồn tại bao lâu trước khi dán vào .env → coi như đã
// hết hạn ngay, buộc refresh thật ở lần gọi đầu tiên thay vì tin token seed còn sống lâu.
const SEED_LIFETIME_MS = 0;
const DEFAULT_LIFETIME_S = ACCESS_TOKEN_LIFETIME_MS / 1000; // fallback khi Zalo không trả expires_in

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
    await this.loadState();
    if (!this.canRefresh()) {
      this.logger.warn(
        'Auto-refresh Zalo token CHƯA bật (thiếu ZALO_APP_ID / ZALO_APP_SECRET / refresh token). ' +
        'Access token Zalo OA chỉ sống ~1h — không tự refresh sẽ hết hạn rất nhanh.',
      );
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
