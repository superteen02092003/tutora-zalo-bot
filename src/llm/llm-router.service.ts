import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { SubjectCacheService } from '../be-client/subject-cache.service';
import { TutorCandidateDto } from '../be-client/dto';
import { ConversationContext } from '../bot/state/conversation-context.interface';
import { ConversationState } from '../bot/state/conversation-state.enum';
import { RouterDecision } from './llm-router.types';

@Injectable()
export class LlmRouterService {
  private readonly logger = new Logger(LlmRouterService.name);
  private readonly client?: OpenAI;
  private readonly model: string;

  constructor(
    config: ConfigService,
    private readonly subjectCache: SubjectCacheService,
  ) {
    const apiKey = config.get<string>('deepseek.apiKey');
    const baseURL = config.get<string>('deepseek.baseUrl');
    this.model = config.get<string>('deepseek.model', 'deepseek-v4-flash');
    if (apiKey && baseURL) {
      this.client = new OpenAI({ apiKey, baseURL });
    }
  }

  async decide(params: {
    message: string;
    state: ConversationState;
    context: ConversationContext;
    candidates: TutorCandidateDto[];
  }): Promise<RouterDecision> {
    if (!this.client) {
      return { action: 'unknown', reply: 'Xin lỗi, mình chưa hiểu ý bạn.' };
    }

    try {
      const subjectNames = await this.subjectCache.getNames();
      const history = (params.context.chatHistory ?? []).slice(-10);
      const response = await this.client.chat.completions.create({
        model: this.model,
        response_format: { type: 'json_object' },
        temperature: 0.1,
        messages: [
          { role: 'system', content: this.buildSystemPrompt({ ...params, subjectNames }) },
          ...history,
          { role: 'user', content: params.message },
        ],
      });
      return this.parseDecision(response.choices[0]?.message.content);
    } catch (error) {
      this.logger.error(`LLM router error: ${String(error)}`);
      return { action: 'unknown', reply: 'Mình gặp sự cố kỹ thuật. Bạn thử lại sau nhé.' };
    }
  }

  private buildSystemPrompt(params: {
    state: ConversationState;
    context: ConversationContext;
    candidates: TutorCandidateDto[];
    subjectNames: string[];
  }): string {
    const { state, context, candidates } = params;
    const currentQuestion = this.deriveCurrentQuestion(state, context);
    const collectedSlots = this.summarizeCollectedSlots(context);
    const candidateList =
      candidates.length > 0
        ? `Danh sách gia sư khả dụng: ${candidates.map((c) => c.fullName).join(', ')}.`
        : '';
    const tutorInfo = context.selectedTutorName
      ? `Gia sư đã chọn: ${context.selectedTutorName}.`
      : '';

    return `Bạn là bộ não định tuyến của chatbot Zalo OA Tutora — nền tảng gia sư tư nhân tại Việt Nam.
Nhiệm vụ: Phân tích tin nhắn phụ huynh và trả về đúng 1 JSON action.

QUAN TRỌNG: Trong luồng onboarding hiện tại, các bước chọn môn học, cấp học, lớp học, hình thức, và khu vực đều dùng NÚT BẤM — KHÔNG phải nhắn tự do. LLM chỉ được gọi ở bước mô tả tự do (freetext) hoặc các tình huống ngoài onboarding.

TRẠNG THÁI HỆ THỐNG:
- State: ${state}
${collectedSlots ? `- Đã thu thập: ${collectedSlots}` : ''}
${tutorInfo}
${candidateList}
${currentQuestion ? `- Câu hỏi đang chờ trả lời: "${currentQuestion}"` : ''}
- Ngôn ngữ trả lời: ${context.preferredLanguage === 'en' ? 'English' : 'Tiếng Việt có dấu'}

─────────────────────────────────────────
DANH SÁCH ACTION:
─────────────────────────────────────────

[A] User đang ở bước freetext (mô tả yêu cầu tự do) — step "freetext":
{"action":"fill_slot","slot":"freetext","value":"<nội dung mô tả của user>"}
Dùng khi state=Onboarding VÀ onboardingStep="freetext".
Nếu user muốn bỏ qua → {"action":"fill_slot","slot":"freetext","value":""}

[B] User muốn tìm gia sư VÀ cung cấp đủ thông tin trong 1 tin nhắn (subject, grade, mode, area, v.v.):
{"action":"bulk_fill_slots","slots":{"subject":"<giá trị>","grade":"<giá trị>","mode":"<giá trị>","area":"<giá trị>","purpose":"<giá trị nếu có>"}}
Chỉ điền các slot có thông tin rõ ràng, bỏ qua slot không có.

[B2] User muốn tìm gia sư nhưng KHÔNG cung cấp thông tin cụ thể nào:
{"action":"start_onboarding"}

[C] User chọn gia sư theo tên (state MATCHED, chưa có selectedTutor):
{"action":"select_tutor","tutorName":"<tên đúng như danh sách>"}

[D] User chọn gói buổi học (state MATCHED, đã có selectedTutor, chưa có selectedPackage):
{"action":"select_package","sessionCount":<4|8|12>}
Mapping: 1/ít/4 buổi → 4; 2/vừa/8 buổi → 8; 3/nhiều/12 buổi → 12

[D2] User chọn tần suất lịch học (state MATCHED, đã có selectedTutor VÀ selectedPackage):
{"action":"select_schedule","preset":"twice_weekly"|"three_weekly"}
Mapping: 1/2 buổi/tuần/ít → twice_weekly; 2/3 buổi/tuần/nhiều → three_weekly

[E] User muốn đổi/dời lịch học (state ACTIVE/BOOKED):
{"action":"initiate_reschedule"}

[F] User muốn hủy lịch (state ACTIVE/BOOKED):
{"action":"initiate_cancel"}

[G] User có khiếu nại / tranh chấp (state ACTIVE/BOOKED):
{"action":"initiate_dispute"}

[H] User hỏi trạng thái booking/lịch học:
{"action":"check_status"}

[I] Câu hỏi thông thường (về Tutora, gia sư, học phí, v.v.):
{"action":"answer_question","reply":"<câu trả lời theo ngôn ngữ đã chọn, ngắn gọn, thân thiện>"}

[J] Không xác định được:
{"action":"unknown","reply":"<câu hỏi lại hoặc gợi ý ngắn>"}

─────────────────────────────────────────
NGUYÊN TẮC QUAN TRỌNG:
─────────────────────────────────────────
0. TUYỆT ĐỐI KHÔNG TỰ BỊA THÔNG TIN. Chỉ điền slot khi user nói RÕ RÀNG. Nếu user chưa đề cập → KHÔNG được suy diễn, đoán mò, hay dùng giá trị mặc định. Ví dụ: user nói "Toán 12" → chỉ điền subject+grade, KHÔNG điền mode/area/purpose. User nói "tìm gia sư Toán" → chỉ điền subject, KHÔNG điền bất cứ thứ gì khác.
1. Nếu tin nhắn chứa TỪ 2 THÔNG TIN TRỞ LÊN (môn học, lớp, hình thức, khu vực, mục đích) → LUÔN dùng [B] (bulk_fill_slots), chỉ điền đúng các slot user đã nói, bỏ qua slot chưa có.
2. Chỉ dùng [A] (fill_slot) khi user trả lời đúng 1 thông tin cho câu hỏi đang chờ.
3. Nếu user đang trong onboarding mà hỏi câu hỏi ngoài lề → dùng [I], KHÔNG điền slot.
4. Chỉ dùng [B2] (start_onboarding) khi user muốn tìm gia sư nhưng không cung cấp bất kỳ thông tin nào.
5. Chỉ dùng [C] nếu tên trong tin nhắn khớp (tương đối) với tên trong danh sách gia sư.
6. Luôn trả về JSON hợp lệ với đúng cấu trúc của action đã chọn.
7. Không được tự suy luận rằng user đã chọn xong gia sư chỉ vì selectedTutorName tồn tại trong context.
8. Với action [I] (answer_question): chỉ trả lời dựa trên thông tin đã biết chắc về Tutora. Nếu không chắc → nói "mình chưa có thông tin về vấn đề này, bạn có thể liên hệ đội ngũ Tutora để được hỗ trợ nhé!" thay vì tự bịa.`;
  }

  private deriveCurrentQuestion(
    state: ConversationState,
    context: ConversationContext,
  ): string {
    if (state === ConversationState.Onboarding) {
      const map: Record<string, string> = {
        subject: '[NÚT BẤM] Bạn muốn học môn gì?',
        grade_group: '[NÚT BẤM] Học sinh đang học cấp mấy?',
        grade: '[NÚT BẤM] Học sinh đang học lớp mấy?',
        mode: '[NÚT BẤM] Bạn muốn học online, tại nhà, hay linh hoạt cả hai?',
        area: '[NÚT BẤM] Bạn đang ở thành phố nào?',
        freetext: 'Bạn có mô tả thêm về yêu cầu không? (tự do nhắn hoặc bỏ qua)',
      };
      return map[context.onboardingStep ?? ''] ?? '';
    }
    if (state === ConversationState.Matched) {
      if (context.selectedTutorId && context.selectedPackageSessionCount) {
        return `Bạn đã chọn ${context.selectedPackageSessionCount} buổi. Bạn muốn học mấy buổi mỗi tuần? (2 buổi/tuần hoặc 3 buổi/tuần)`;
      }
      if (context.selectedTutorId) {
        return `Bạn đã chọn ${context.selectedTutorName}. Muốn học gói 4, 8, hay 12 buổi?`;
      }
      return 'Bạn muốn chọn gia sư nào?';
    }
    return '';
  }

  private summarizeCollectedSlots(context: ConversationContext): string {
    const c = context.criteria;
    if (!c) return '';
    const parts: string[] = [];
    if (c.subject) parts.push(`môn ${c.subject}`);
    if (c.grade) parts.push(c.grade.replace('Lop ', 'lớp '));
    if (c.teachingMode) parts.push(c.teachingMode === 'online' ? 'online' : c.teachingMode === 'offline' ? 'tại nhà' : 'linh hoạt');
    if (c.locationDistrict) parts.push(c.locationDistrict);
    if (c.purpose) parts.push({ exam_prep: 'ôn thi', regular: 'học thêm', foundation: 'lấy nền', advanced: 'nâng cao' }[c.purpose] ?? c.purpose);
    return parts.join(', ');
  }

  private parseDecision(content?: string | null): RouterDecision {
    const fallback: RouterDecision = {
      action: 'unknown',
      reply: 'Mình chưa hiểu ý bạn. Bạn muốn tìm gia sư, đổi lịch, hay kiểm tra lịch học?',
    };

    if (!content) return fallback;

    try {
      const parsed = JSON.parse(content) as RouterDecision;
      if (!parsed?.action) return fallback;
      return parsed;
    } catch {
      this.logger.warn(`Failed to parse LLM router response: ${content}`);
      return fallback;
    }
  }
}
