import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { RedisService } from '../common/redis/redis.service';

const ZALO_OAUTH_URL = 'https://oauth.zaloapp.com/v4/oa/access_token';
const REDIS_KEY = 'zalo:oa:token';
const REFRESH_BUFFER_MS = 60 * 60 * 1000; // refresh khi token còn dưới 1h
const SEED_LIFETIME_MS = 23 * 60 * 60 * 1000; // token seed từ env coi như còn 23h
const DEFAULT_LIFETIME_S = 90000; // ~25h, dùng khi Zalo không trả expires_in

interface TokenState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

/**
 * Quản lý vòng đời Zalo OA access token.
 * - Lưu access/refresh token trong Redis (refresh token xoay vòng nên phải bền qua restart).
 * - Tự refresh on-demand trước khi hết hạn; gộp các lần refresh đồng thời.
 * - Seed lần đầu từ env (ZALO_OA_ACCESS_TOKEN / ZALO_OA_REFRESH_TOKEN).
 */
@Injectable()
export class ZaloTokenService implements OnModuleInit {
  private readonly logger = new Logger(ZaloTokenService.name);
  private readonly appId?: string;
  private readonly appSecret?: string;
  private state?: TokenState;
  private refreshPromise?: Promise<void>;

  constructor(
    private readonly http: HttpService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    this.appId = config.get<string>('zalo.appId');
    this.appSecret = config.get<string>('zalo.appSecret');
  }

  async onModuleInit(): Promise<void> {
    await this.loadState();
    if (!this.canRefresh()) {
      this.logger.warn(
        'Auto-refresh Zalo token CHƯA bật (thiếu ZALO_APP_ID / ZALO_APP_SECRET / refresh token). Token sẽ hết hạn sau ~25h.',
      );
    }
  }

  /** Trả về access token còn hiệu lực; tự refresh nếu sắp/đã hết hạn. */
  async getAccessToken(): Promise<string | undefined> {
    if (!this.state) await this.loadState();
    if (!this.state) return undefined; // chưa cấu hình token → caller chạy stub

    if (this.canRefresh() && Date.now() >= this.state.expiresAt - REFRESH_BUFFER_MS) {
      await this.refresh();
    }
    return this.state?.accessToken;
  }

  private canRefresh(): boolean {
    return Boolean(this.appId && this.appSecret && this.state?.refreshToken);
  }

  private async loadState(): Promise<void> {
    // Ưu tiên Redis — nơi lưu refresh token mới nhất sau mỗi lần xoay vòng.
    try {
      const raw = await this.redis.getClient().get(REDIS_KEY);
      if (raw) {
        this.state = JSON.parse(raw) as TokenState;
        return;
      }
    } catch (error) {
      this.logger.warn(`Không đọc được token từ Redis: ${String(error)}`);
    }

    // Lần đầu (Redis trống): seed từ env.
    const accessToken = this.config.get<string>('zalo.accessToken');
    const refreshToken = this.config.get<string>('zalo.refreshToken');
    if (accessToken) {
      this.state = {
        accessToken,
        refreshToken: refreshToken ?? '',
        expiresAt: Date.now() + SEED_LIFETIME_MS,
      };
      await this.persist();
      this.logger.log('Seed Zalo token từ env vào Redis.');
    }
  }

  private async refresh(): Promise<void> {
    // Gộp mọi lần refresh đồng thời vào 1 promise.
    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh().finally(() => {
        this.refreshPromise = undefined;
      });
    }
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<void> {
    if (!this.canRefresh() || !this.state) return;
    this.logger.log('Đang refresh Zalo access token...');
    try {
      const res = await lastValueFrom(
        this.http.post(
          ZALO_OAUTH_URL,
          new URLSearchParams({
            refresh_token: this.state.refreshToken,
            app_id: this.appId!,
            grant_type: 'refresh_token',
          }).toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              secret_key: this.appSecret!,
            },
          },
        ),
      );

      const data = res.data as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: string;
      };

      if (!data.access_token || !data.refresh_token) {
        this.logger.error(`Refresh token thất bại, giữ token cũ. Phản hồi: ${JSON.stringify(data)}`);
        return;
      }

      const lifetimeMs = (Number(data.expires_in) || DEFAULT_LIFETIME_S) * 1000;
      this.state = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + lifetimeMs,
      };
      await this.persist();
      this.logger.log(`Đã refresh Zalo token — hết hạn sau ~${Math.round(lifetimeMs / 3600000)}h.`);
    } catch (error) {
      this.logger.error(`Lỗi gọi API refresh Zalo token: ${String(error)}`);
    }
  }

  private async persist(): Promise<void> {
    if (!this.state) return;
    try {
      await this.redis.getClient().set(REDIS_KEY, JSON.stringify(this.state));
    } catch (error) {
      this.logger.warn(`Không lưu được token vào Redis: ${String(error)}`);
    }
  }
}
