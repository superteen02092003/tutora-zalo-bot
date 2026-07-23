import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MiniAppTokenService, SupportedLang } from './mini-app-token.service';
import { ZaloService } from '../zalo/zalo.service';

/** Gửi nút mở Mini App tìm gia sư — dùng bởi MessageHandler cho mọi tin nhắn (chatbot chỉ
 * còn vai trò điều hướng, không còn matching qua chat/LLM). */
@Injectable()
export class MiniAppButtonService {
  private readonly logger = new Logger(MiniAppButtonService.name);
  private readonly miniAppId: string;
  private readonly devVersion: string;

  constructor(
    private readonly zalo: ZaloService,
    private readonly tokenService: MiniAppTokenService,
    config: ConfigService,
  ) {
    this.miniAppId = config.get<string>('miniApp.id', '');
    this.devVersion = config.get<string>('miniApp.devVersion', '');
  }

  /** Gửi 1 tin nhắn kèm nút mở Mini App — KHÔNG gọi agent, không hỏi gì qua chat.
   * `lang` = context.preferredLanguage bot đã tự nhận diện từ tin nhắn PH vừa gõ.
   * `fresh` = true khi PH muốn NHU CẦU KHÁC HẲN (agent.reopen_mini_app_fresh) — Mini App
   * PHẢI để form trống cho PH điền lại, KHÔNG được tự auto-skip qua kết quả cũ dù prefill
   * còn dữ liệu (xem MiniAppSearchFormPage.tsx). Bug thật 2026-07-14: thiếu cờ này khiến
   * chọn "nhu cầu khác" vẫn tự hiện lại kết quả CŨ trước khi PH kịp điền gì mới. */
  async sendSearchButton(
    userId: string,
    lang: SupportedLang = 'vi',
    fresh = false,
  ): Promise<void> {
    if (!this.miniAppId) {
      this.logger.error(
        'ZALO_MINI_APP_ID chưa cấu hình — không gửi được nút Mini App.',
      );
      await this.zalo.sendText(
        userId,
        lang === 'en'
          ? 'Sorry, tutor search is under maintenance — please try again in a few minutes!'
          : 'Dạ hệ thống tìm gia sư đang bảo trì, anh/chị thử lại giúp em sau ít phút nhé!',
      );
      return;
    }
    // Ký token kèm lang — Mini App KHÔNG có secret để tự giải mã token, nên gửi lang RIÊNG
    // qua query param (?lang=) để FE biết render form ngôn ngữ nào; token vẫn giữ lang bên
    // trong để handleFormSubmit lấy lại đúng ngôn ngữ lúc chọn trigger message trả lời.
    const token = this.tokenService.sign(userId, lang);
    // path KHÔNG kèm basename "/zapps/{id}" — BrowserRouter basename tự thêm khi navigate(path).
    // Trỏ tới form nhập tiêu chí riêng (MiniAppSearchFormPage), KHÔNG dùng /tutor-search
    // (trang đó là listing/live-filter, không phù hợp làm form nhập liệu 1 lượt).
    const devParams = this.devVersion
      ? `&env=DEVELOPMENT&version=${encodeURIComponent(this.devVersion)}`
      : '';
    const freshParam = fresh ? '&fresh=1' : '';
    const deepLink = `https://zalo.me/s/${this.miniAppId}/?path=${encodeURIComponent('/mini-app-search')}&token=${encodeURIComponent(token)}&lang=${lang}${freshParam}${devParams}`;
    const card =
      lang === 'en'
        ? {
            title: 'Find the right tutor for your child',
            subtitle: 'Fill in a quick form so we can find the best match!',
            buttonTitle: 'Fill in tutor search form',
          }
        : {
            title: 'Tìm gia sư phù hợp cho bé',
            subtitle: 'Điền nhanh thông tin để em tìm đúng gia sư cho bé nhé!',
            buttonTitle: 'Điền thông tin tìm gia sư',
          };
    await this.zalo.sendInteractiveListCard(userId, [
      {
        title: card.title,
        subtitle: card.subtitle,
        buttons: [{ title: card.buttonTitle, type: 'url', payload: deepLink }],
      },
    ]);
  }

  /** Deep link mở thẳng trang chi tiết gia sư trong Mini App (route /tutor-detail/:id có
   * sẵn, xem Tutora-FE/src/pages/TutorDetail/TutorDetailPage.tsx). Dùng cho nút "Xem chi
   * tiết"/"Đặt lịch" trên tutor card — thay thế hẳn luồng postback select_tutor: + hỏi gói
   * qua chat text (2026-07-18: bỏ DeepSeek/executeDecision, PH đặt lịch qua UI BookingModal
   * đã có sẵn thay vì chọn gói/lịch bằng chat tự do). `openBooking=1` khiến TutorDetailPage
   * tự mở BookingModal ngay khi trang load xong (xem useEffect đọc searchParams). */
  buildTutorDetailLink(tutorId: string, openBooking = false): string {
    const devParams = this.devVersion
      ? `&env=DEVELOPMENT&version=${encodeURIComponent(this.devVersion)}`
      : '';
    const path = `/tutor-detail/${tutorId}${openBooking ? '?openBooking=1' : ''}`;
    return `https://zalo.me/s/${this.miniAppId}/?path=${encodeURIComponent(path)}${devParams}`;
  }
}
