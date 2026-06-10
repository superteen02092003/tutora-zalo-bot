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
      const response = await this.client.chat.completions.create({
        model: this.model,
        response_format: { type: 'json_object' },
        temperature: 0.1,
        messages: [
          { role: 'system', content: this.buildSystemPrompt({ ...params, subjectNames }) },
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
    const { state, context, candidates, subjectNames } = params;
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

[A] User đang trả lời câu hỏi onboarding hiện tại:
{"action":"fill_slot","slot":"<tên slot>","value":"<giá trị>"}

Slot rules (chỉ fill slot đang được hỏi):
  • language → "vi" nếu user chọn Tiếng Việt/Vietnamese, "en" nếu user chọn English/tiếng Anh
  • subject  → PHẢI chọn đúng 1 trong danh sách (không được tự tạo giá trị khác): ${subjectNames.join(', ')}
  • grade    → "Lop X" với X = 1–12 (ví dụ user nói "lớp 11" → "Lop 11")
  • mode     → "online" (trực tuyến/online/qua video), "offline" (tại nhà/gặp trực tiếp/face-to-face), "both" (linh hoạt/cả hai/đều được)
  • area     → tên quận/huyện/thành phố nguyên văn (ví dụ "Bình Thạnh", "Quận 1", "Thủ Đức")
  • purpose  → "exam_prep" (ôn thi/thi vào 10/THPT quốc gia/thi đại học/luyện thi), "regular" (học thêm/học bình thường/theo chương trình), "foundation" (lấy lại nền/học lại từ đầu/mất căn bản), "advanced" (nâng cao/học sinh giỏi/HSG/phát triển tư duy)

[B] User muốn tìm gia sư (không đang trong onboarding):
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
1. Ưu tiên [A] nếu user đang trong onboarding VÀ tin nhắn có thể map vào slot hiện tại.
2. Nếu user đang trong onboarding mà hỏi câu hỏi ngoài lề → dùng [I], KHÔNG điền slot.
3. KHÔNG dùng [B] nếu user đang ở giữa onboarding (trừ khi user rõ ràng muốn bắt đầu lại với gia sư khác).
4. Chỉ dùng [C] nếu tên trong tin nhắn khớp (tương đối) với tên trong danh sách gia sư.
5. Luôn trả về JSON hợp lệ với đúng cấu trúc của action đã chọn.
6. CỰC KỲ QUAN TRỌNG — Nếu user nói muốn "tìm gia sư", "đặt gia sư", "tìm thầy/cô", "book tutor" và KHÔNG có activeBookingId → LUÔN dùng [B] (start_onboarding), bất kể selectedTutorName có trong context hay không. selectedTutorName là dữ liệu tạm từ session trước, không có nghĩa user đã hoàn tất booking.
7. Không được tự suy luận rằng user đã chọn xong gia sư chỉ vì selectedTutorName tồn tại trong context.`;
  }

  private deriveCurrentQuestion(
    state: ConversationState,
    context: ConversationContext,
  ): string {
    if (state === ConversationState.Onboarding) {
      const map: Record<string, string> = {
        language: 'Bạn muốn dùng Tiếng Việt hay English?',
        subject: 'Bạn muốn học môn nào?',
        grade: 'Học sinh đang học lớp mấy?',
        mode: 'Bạn muốn học online, tại nhà, hay linh hoạt cả hai?',
        area: 'Bạn muốn học khu vực quận/huyện nào?',
        purpose: 'Mục tiêu học là gì? (ôn thi / học thêm / lấy lại nền / nâng cao)',
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
