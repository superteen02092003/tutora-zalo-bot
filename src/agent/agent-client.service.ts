import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { AgentRequestBody, AgentResponseBody } from './agent-client.types';

/**
 * Client gọi FastAPI AI agent (tutora-ai) — bộ não hội thoại matching.
 * Agent stateless: bot giữ history + context (Redis), gửi kèm mỗi lượt.
 */
@Injectable()
export class AgentClientService {
  private readonly logger = new Logger(AgentClientService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    this.baseUrl = config.get<string>('agent.baseUrl', 'http://localhost:8000');
    this.apiKey = config.get<string>('agent.apiKey', '');
  }

  /** Lỗi/timeout → throw; caller quyết định câu xin lỗi gửi user. */
  async chat(body: AgentRequestBody): Promise<AgentResponseBody> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/v1/agent`;
    const response = await lastValueFrom(
      this.http.post<AgentResponseBody>(url, body, {
        headers: { 'X-API-Key': this.apiKey },
        // Agent gọi Gemini (trích slot + diễn đạt) + .NET search — có thể mất vài giây.
        timeout: 30_000,
      }),
    );
    return response.data;
  }
}
