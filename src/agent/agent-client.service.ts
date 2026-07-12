import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { AgentRequestBody, AgentResponseBody } from './agent-client.types';

const METADATA_IDENTITY_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity';
// ID token Google cấp sống 1h; refetch sớm hơn 1 chút cho an toàn.
const ID_TOKEN_TTL_MS = 50 * 60 * 1000;

/**
 * Client gọi FastAPI AI agent (tutora-ai) — bộ não hội thoại matching.
 * Agent stateless: bot giữ history + context (Redis), gửi kèm mỗi lượt.
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

  /** Lỗi/timeout → throw; caller quyết định câu xin lỗi gửi user. */
  async chat(body: AgentRequestBody): Promise<AgentResponseBody> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/v1/agent`;
    const headers: Record<string, string> = { 'X-API-Key': this.apiKey };
    const idToken = await this.getIdToken();
    if (idToken) headers.Authorization = `Bearer ${idToken}`;

    const response = await lastValueFrom(
      this.http.post<AgentResponseBody>(url, body, {
        headers,
        // Agent gọi Gemini (trích slot + diễn đạt) + .NET search — có thể mất vài giây.
        timeout: 30_000,
      }),
    );
    return response.data;
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
