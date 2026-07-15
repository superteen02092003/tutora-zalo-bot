import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

export type SupportedLang = 'vi' | 'en';

// Đủ thời gian PH mở Mini App + điền form, không quá dài để giảm rủi ro token rò rỉ qua URL.
const TOKEN_TTL_MS = 30 * 60 * 1000;

export interface VerifiedMiniAppToken {
  userId: string;
  lang: SupportedLang;
}

/**
 * Ký/xác thực token ngắn hạn nhúng trong deep link Mini App — KHÔNG verify access_token
 * Mini App qua Zalo server (bước cứng hơn, để sau nếu cần). Đủ dùng cho luồng nội bộ: chỉ
 * cần đảm bảo request POST /webhook/miniapp-search thực sự bắt nguồn từ link bot vừa gửi
 * cho ĐÚNG zaloUserId đó, trong thời gian ngắn.
 *
 * Format token: "<zaloUserIdB64url>.<expiryMs>.<lang>.<macHex>". `lang` được ký kèm để
 * Mini App submit lại đúng ngôn ngữ PH đang dùng (bot đã tự nhận diện lúc gửi nút) mà
 * không cần FE tự khai báo (client-supplied) — nguồn chân lý là ngôn ngữ tin nhắn PH gõ.
 */
@Injectable()
export class MiniAppTokenService {
  private readonly logger = new Logger(MiniAppTokenService.name);
  private readonly secret: string;

  constructor(config: ConfigService) {
    this.secret = config.get<string>('miniApp.linkSecret', '');
    if (!this.secret) {
      this.logger.warn(
        'MINI_APP_LINK_SECRET chưa cấu hình — mọi token Mini App sẽ bị coi là KHÔNG hợp lệ.',
      );
    }
  }

  sign(zaloUserId: string, lang: SupportedLang = 'vi'): string {
    const idB64 = Buffer.from(zaloUserId, 'utf8').toString('base64url');
    const expiry = Date.now() + TOKEN_TTL_MS;
    const mac = this.computeMac(idB64, expiry, lang);
    return `${idB64}.${expiry}.${lang}.${mac}`;
  }

  /** Trả về {userId, lang} nếu token hợp lệ + chưa hết hạn; null nếu không. */
  verify(token: string): VerifiedMiniAppToken | null {
    if (!this.secret) return null;
    const parts = token.split('.');
    if (parts.length !== 4) return null;
    const [idB64, expiryStr, langRaw, mac] = parts;
    const expiry = Number(expiryStr);
    if (!Number.isFinite(expiry) || Date.now() > expiry) return null;
    if (langRaw !== 'vi' && langRaw !== 'en') return null;
    const lang = langRaw as SupportedLang;

    const expectedMac = this.computeMac(idB64, expiry, lang);
    const a = Buffer.from(mac, 'hex');
    const b = Buffer.from(expectedMac, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    try {
      const userId = Buffer.from(idB64, 'base64url').toString('utf8');
      return { userId, lang };
    } catch {
      return null;
    }
  }

  private computeMac(idB64: string, expiry: number, lang: SupportedLang): string {
    return createHmac('sha256', this.secret).update(`${idB64}.${expiry}.${lang}`).digest('hex');
  }
}
