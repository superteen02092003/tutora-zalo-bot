import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';

interface AiRankResult {
  tutor_id: string;
  similarity: number;
  city?: string;
  district?: string;
  teaching_mode?: string;
  price_min?: number;
  price_max?: number;
  average_rating?: number;
}

interface AiRecommendResponse {
  results: AiRankResult[];
  total: number;
}

// ── Agent (hội thoại) — khớp AgentRequest/AgentResponse của tutora-ai ──
export interface AgentHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentContext {
  subject_id?: number;
  grade_level_id?: number;
  teaching_mode?: string;
  city?: string;
}

export interface AgentShownTutor {
  tutor_id: string;
  name?: string;
}

export interface AgentRequest {
  history?: AgentHistoryMessage[];
  message: string;
  channel?: 'zalo' | 'web';
  context?: AgentContext;
  shown_tutors?: AgentShownTutor[];
}

export interface AgentContextPatch {
  subject_id?: number | null;
  grade_level_id?: number | null;
}

export interface AgentResponse {
  reply: string;
  tutors: Record<string, unknown>[]; // nguyên shape .NET recommend -> render card
  handoff_to_booking: boolean;
  awaiting_confirmation: boolean;
  confirm_type: 'context_change' | 'booking' | null;
  suggestions: string[];
  // Môn/lớp mới sau khi đổi giữa chat -> lưu vào context để turn sau gửi đúng subject_id.
  context_patch?: AgentContextPatch | null;
}

@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name);
  private readonly baseUrl: string | undefined;
  private readonly apiKey: string | undefined;

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    this.baseUrl = config.get<string>('aiService.url');
    this.apiKey = config.get<string>('aiService.key');
  }

  /**
   * Rank candidate tutors by semantic relevance to the query using tutora-ai.
   *
   * @param query     Free-text description of what the user wants.
   * @param candidateIds  IDs returned by the .NET hard-filter step.
   * @param topK      Maximum number of results to return (default 10).
   * @returns         Ordered list of tutor_ids (most relevant first).
   *                  On any error → returns candidateIds unchanged (graceful degradation).
   */
  async rankCandidates(
    query: string,
    candidateIds: string[],
    topK = 10,
  ): Promise<string[]> {
    if (!this.baseUrl || !this.apiKey) {
      this.logger.warn('AiClientService: AI_SERVICE_URL or AI_SERVICE_KEY not configured — skipping ranking');
      return candidateIds;
    }

    if (candidateIds.length === 0) {
      return candidateIds;
    }

    try {
      const url = `${this.baseUrl.replace(/\/$/, '')}/api/v1/tutors/recommend`;
      const response = await lastValueFrom(
        this.http.post<AiRecommendResponse>(
          url,
          { query, candidate_ids: candidateIds, top_k: topK },
          {
            headers: { 'X-API-Key': this.apiKey },
            timeout: 8_000,
          },
        ),
      );

      const ranked = response.data?.results ?? [];
      if (ranked.length === 0) {
        return candidateIds;
      }

      const rankedIds = ranked.map((r) => r.tutor_id);

      // Append any candidates not returned by AI (preserve them at the end)
      const rankedSet = new Set(rankedIds);
      const remainder = candidateIds.filter((id) => !rankedSet.has(id));

      return [...rankedIds, ...remainder];
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AiClientService: ranking failed, falling back to original order. Error: ${msg}`);
      return candidateIds;
    }
  }

  /**
   * Hội thoại với agent tutora-ai (tìm gia sư / hỏi chi tiết / lịch / confirm).
   * Stateless: NestJS giữ history + shown_tutors, gửi kèm mỗi lượt.
   *
   * @returns AgentResponse, hoặc null nếu AI service lỗi/chưa cấu hình
   *          (caller fallback graceful — không để bot chết câm).
   */
  async askAgent(req: AgentRequest): Promise<AgentResponse | null> {
    if (!this.baseUrl || !this.apiKey) {
      this.logger.warn('AiClientService.askAgent: AI_SERVICE_URL/KEY chưa cấu hình');
      return null;
    }
    try {
      const url = `${this.baseUrl.replace(/\/$/, '')}/api/v1/agent`;
      const response = await lastValueFrom(
        this.http.post<AgentResponse>(
          url,
          { channel: 'zalo', ...req },
          {
            headers: { 'X-API-Key': this.apiKey },
            timeout: 30_000, // agent loop nhiều vòng tool -> rộng hơn rank (8s)
          },
        ),
      );
      return response.data;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AiClientService.askAgent failed: ${msg}`);
      return null;
    }
  }
}
