import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import {
  AgentChatRequestBody,
  AgentChatResponseBody,
  DirectSearchRequestBody,
  DirectSearchResponseBody,
} from './agent-client.types';

const METADATA_IDENTITY_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity';
// ID token Google cấp sống 1h; refetch sớm hơn 1 chút cho an toàn.
const ID_TOKEN_TTL_MS = 50 * 60 * 1000;

/**
 * Client gọi FastAPI AI agent (tutora-ai). 2 nhóm method:
 * - searchDirect: KHÔNG qua LLM — Mini App form gửi tiêu chí đã rõ (id thật).
 * - chat: CÓ LLM (POST /api/v1/agent, channel="zalo") — tin nhắn tự do trong ZaloOA. Hồi
 *   sinh lại 2026-08-02 sau khi bị bỏ 2026-07-19 cùng AgentMatchingFlow: matching THẬT vẫn
 *   chỉ qua Mini App (xem MiniAppSearchFlow), nhưng chat tự do cần LLM trả lời tự nhiên thay
 *   vì luôn chỉ bắn nút — xem MessageHandler.
 */
@Injectable()
export class AgentClientService {
  private readonly logger = new Logger(AgentClientService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  // Bật khi agent chỉ cho phép gọi qua Google IAM (Cloud Run service-to-service,
  // KHÔNG --allow-unauthenticated) — bot tự lấy identity token qua metadata server.
  // Chỉ hoạt động khi bot THẬT SỰ chạy trên GCP (Cloud Run/GCE); local dev để false.
  private readonly useIamAuth: boolean;
  private idTokenCache?: { token: string; expiresAt: number };

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    this.baseUrl = config.get<string>('agent.baseUrl', 'http://localhost:8000');
    this.apiKey = config.get<string>('agent.apiKey', '');
    this.useIamAuth = config.get<boolean>('agent.useIamAuth', false);
  }

  /** Search THẲNG, KHÔNG qua hội thoại (xem DirectSearchRequestBody) — Mini App hiển thị
   * kết quả ngay trong form + nút "tìm gia sư khác" (exclude_tutor_ids). */
  async searchDirect(
    body: DirectSearchRequestBody,
  ): Promise<DirectSearchResponseBody> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/v1/tutors/search-direct`;
    const response = await lastValueFrom(
      this.http.post<DirectSearchResponseBody>(url, body, {
        headers: await this.authHeaders(),
        timeout: 20_000,
      }),
    );
    return response.data;
  }

  /** Hội thoại CÓ LLM — stateless phía tutora-ai, bot PHẢI tự giữ và gửi lại history/
   * context/shown_tutors mỗi lượt (xem ConversationContext.chatHistory/agentCtx/shownTutors).
   * Timeout dài hơn searchDirect vì gọi Gemini (trích slot + diễn đạt câu trả lời). */
  async chat(body: AgentChatRequestBody): Promise<AgentChatResponseBody> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/v1/agent`;
    const response = await lastValueFrom(
      this.http.post<AgentChatResponseBody>(url, body, {
        headers: await this.authHeaders(),
        timeout: 30_000,
      }),
    );
    return response.data;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'X-API-Key': this.apiKey };
    const idToken = await this.getIdToken();
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    return headers;
  }

  /** Google identity token cho audience = chính agent's URL. Cache tới gần hết hạn. */
  private async getIdToken(): Promise<string | undefined> {
    if (!this.useIamAuth) return undefined;
    if (this.idTokenCache && Date.now() < this.idTokenCache.expiresAt) {
      return this.idTokenCache.token;
    }
    try {
      const audience = encodeURIComponent(this.baseUrl.replace(/\/$/, ''));
      const res = await lastValueFrom(
        this.http.get<string>(`${METADATA_IDENTITY_URL}?audience=${audience}`, {
          headers: { 'Metadata-Flavor': 'Google' },
          timeout: 5000,
        }),
      );
      const token = String(res.data);
      this.idTokenCache = { token, expiresAt: Date.now() + ID_TOKEN_TTL_MS };
      return token;
    } catch (error) {
      // Không phải lỗi giả — nếu agent yêu cầu IAM mà không lấy được token, request
      // sau đó sẽ bị 403. Log rõ để dễ debug (thường do KHÔNG chạy trên GCP/thiếu quyền).
      this.logger.error(
        `Không lấy được Google identity token (metadata server) — chỉ hoạt động khi ` +
          `chạy trên GCP với service account đủ quyền: ${String(error)}`,
      );
      return undefined;
    }
  }
}
