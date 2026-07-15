import { Body, Controller, Logger, Post, Get, Query } from '@nestjs/common';
import { MiniAppSearchFlow } from '../bot/flows/mini-app-search.flow';
import type {
  MiniAppSearchSubmission,
  MiniAppSearchResultsRequest,
  MiniAppSearchResultsResponse,
} from '../bot/flows/mini-app-search.flow';
import { MiniAppTokenService } from '../mini-app/mini-app-token.service';
import { ConversationStateService } from '../bot/state/conversation-state.service';
import { UserSerialQueue } from './user-serial-queue.service';

/** Dữ liệu điền sẵn khi PH mở lại Mini App để CHỈNH SỬA tiêu chí (đã có agentCtx từ lượt
 * search trước) — map ngược snake_case (agentCtx) sang camelCase (payload wizard hiểu). */
export interface MiniAppPrefillResponse {
  ok: boolean;
  subjectId?: number;
  gradeLevelId?: number;
  goal?: string;
  minRate?: number;
  maxRate?: number;
  teachingMode?: 'online' | 'offline' | 'both';
  city?: string;
  tutorGender?: 'male' | 'female';
}

/**
 * Nhận form Mini App submit — xác thực khác hẳn Zalo webhook (không có chữ ký HMAC
 * kiểu Zalo vì nguồn không phải Zalo server mà là Mini App client): tin cậy bằng chính
 * token ngắn hạn nhúng trong deep link lúc bot gửi nút (xem MiniAppTokenService).
 *
 * KHÔNG ack-ngay-rồi-xử-lý-ngầm như /webhook/zalo — Mini App cần biết kết quả thật (thành
 * công/lỗi) để hiện màn hình phù hợp trước khi đóng, nên await xử lý xong mới trả response.
 */
@Controller('webhook')
export class MiniAppController {
  private readonly logger = new Logger(MiniAppController.name);

  constructor(
    private readonly miniAppSearchFlow: MiniAppSearchFlow,
    private readonly tokenService: MiniAppTokenService,
    private readonly state: ConversationStateService,
    private readonly queue: UserSerialQueue,
  ) {}

  /** PH mở lại Mini App để SỬA tiêu chí (vd từ nút "reopen_mini_app" giữa chat) — trả về
   * agentCtx hiện có để wizard điền sẵn thay vì bắt điền lại từ đầu. Không có gì để điền
   * sẵn (lần đầu tìm) → trả {ok:true} không kèm field nào, wizard hiện form trống bình thường. */
  @Get('miniapp-search/prefill')
  async getPrefill(@Query('token') token: string): Promise<MiniAppPrefillResponse> {
    const verified = this.tokenService.verify(token);
    if (!verified) {
      return { ok: false };
    }
    const context = await this.state.getContext(verified.userId);
    const ctx = context.agentCtx ?? {};
    return {
      ok: true,
      subjectId: typeof ctx.subject_id === 'number' ? ctx.subject_id : undefined,
      gradeLevelId: typeof ctx.grade_level_id === 'number' ? ctx.grade_level_id : undefined,
      goal: typeof ctx.goal === 'string' ? ctx.goal : undefined,
      minRate: typeof ctx.min_rate === 'number' ? ctx.min_rate : undefined,
      maxRate: typeof ctx.max_rate === 'number' ? ctx.max_rate : undefined,
      teachingMode:
        ctx.teaching_mode === 'online' || ctx.teaching_mode === 'offline' || ctx.teaching_mode === 'both'
          ? ctx.teaching_mode
          : undefined,
      city: typeof ctx.city === 'string' ? ctx.city : undefined,
      tutorGender: ctx.tutor_gender === 'male' || ctx.tutor_gender === 'female' ? ctx.tutor_gender : undefined,
    };
  }

  @Post('miniapp-search')
  async handleSubmit(
    @Body() body: MiniAppSearchSubmission,
  ): Promise<{ ok: boolean; error?: string }> {
    // Giải mã token TRƯỚC để lấy zaloUserId làm key hàng đợi (tránh race với tin nhắn
    // chat cùng lúc của cùng user — dùng chung UserSerialQueue với webhook Zalo).
    const verified = this.tokenService.verify(body.token);
    if (!verified) {
      this.logger.warn('Mini App submit với token không hợp lệ/hết hạn.');
      return { ok: false, error: 'invalid_or_expired_token' };
    }
    const { userId } = verified;
    try {
      return await this.queue.run(userId, () => this.miniAppSearchFlow.handleFormSubmit(body));
    } catch (error) {
      this.logger.error(`Xử lý Mini App submit lỗi cho user=${userId}: ${String(error)}`);
      return { ok: false, error: 'internal_error' };
    }
  }

  /** Search THẲNG + trả kết quả NGAY cho Mini App render inline (list gọn kiểu Preply) —
   * khác /miniapp-search: KHÔNG chờ user quay lại Zalo chat mới thấy gia sư. Cùng dùng cho
   * lượt tìm đầu VÀ nút "Tìm gia sư khác" (excludeTutorIds). */
  @Post('miniapp-search/results')
  async getResults(
    @Body() body: MiniAppSearchResultsRequest,
  ): Promise<MiniAppSearchResultsResponse> {
    const verified = this.tokenService.verify(body.token);
    if (!verified) {
      this.logger.warn('Mini App getResults với token không hợp lệ/hết hạn.');
      return { ok: false, error: 'invalid_or_expired_token' };
    }
    const { userId } = verified;
    try {
      return await this.queue.run(userId, () => this.miniAppSearchFlow.getResults(body));
    } catch (error) {
      this.logger.error(`Xử lý Mini App getResults lỗi cho user=${userId}: ${String(error)}`);
      return { ok: false, error: 'internal_error' };
    }
  }
}
