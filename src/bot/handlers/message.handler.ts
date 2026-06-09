import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BeClientService } from '../../be-client/be-client.service';
import { ZaloWebhookEvent } from '../../webhook/zalo-event.dto';
import { getMessageText, getZaloUserId } from '../../webhook/zalo-event.utils';
import { ZaloService } from '../../zalo/zalo.service';
import { ConversationContext } from '../state/conversation-context.interface';
import { ConversationStateService } from '../state/conversation-state.service';

@Injectable()
export class MessageHandler {
  private readonly logger = new Logger(MessageHandler.name);
  private readonly adminUserIds: Set<string>;

  constructor(
    private readonly state: ConversationStateService,
    private readonly zalo: ZaloService,
    private readonly beClient: BeClientService,
    config: ConfigService,
  ) {
    this.adminUserIds = new Set(config.get<string[]>('adminZaloUserIds') ?? []);
  }

  async handle(event: ZaloWebhookEvent): Promise<void> {
    const zaloUserId = getZaloUserId(event);
    if (!zaloUserId) {
      this.logger.warn(`Message event missing sender id: ${JSON.stringify(event)}`);
      return;
    }

    const messageText = getMessageText(event);
    this.logger.debug(`Message | user=${zaloUserId} | text="${messageText}"`);

    // ── Admin commands ──────────────────────────────────────────────────────
    if (this.adminUserIds.has(zaloUserId)) {
      const handled = await this.handleAdminCommand(zaloUserId, messageText);
      if (handled) return;
    }

    // ── Tìm gia sư trigger ─────────────────────────────────────────────────
    if (
      messageText === '#timgiasu' ||
      messageText === 'onboarding:start' ||
      messageText === 'Tìm gia sư'
    ) {
      await this.state.updateContext(zaloUserId, {
        findTutorStep: 'awaiting_subject',
        subject: undefined,
        grade: undefined,
        tutorGender: undefined,
        personalCriteria: undefined,
      });
      await this.zalo.sendText(zaloUserId, 'Hiện tại anh/chị cần tìm gia sư dạy môn nào ạ?');
      return;
    }

    // ── Find tutor flow ────────────────────────────────────────────────────
    const context = await this.state.getContext(zaloUserId);

    if (context.findTutorStep) {
      await this.handleFindTutorFlow(zaloUserId, messageText, context);
      return;
    }
  }

  private async handleFindTutorFlow(
    zaloUserId: string,
    text: string,
    context: ConversationContext,
  ): Promise<void> {
    switch (context.findTutorStep) {
      case 'awaiting_subject': {
        await this.state.updateContext(zaloUserId, {
          subject: text,
          findTutorStep: 'awaiting_grade',
        });
        await this.zalo.sendText(zaloUserId, 'Học sinh đang học lớp mấy ạ? (ví dụ: 5, 9, 11)');
        break;
      }

      case 'awaiting_grade': {
        await this.state.updateContext(zaloUserId, {
          grade: text,
          findTutorStep: 'awaiting_gender',
        });
        await this.zalo.sendInteractiveQuickReply(
          zaloUserId,
          'Anh/chị có yêu cầu về giới tính gia sư không?',
          [
            { title: 'Nam', payload: 'gender:male' },
            { title: 'Nữ', payload: 'gender:female' },
            { title: 'Không yêu cầu', payload: 'gender:any' },
          ],
        );
        break;
      }

      case 'awaiting_gender': {
        let tutorGender: 'male' | 'female' | 'any' = 'any';
        if (text === 'gender:male' || text.toLowerCase().includes('nam')) tutorGender = 'male';
        else if (text === 'gender:female' || text.toLowerCase().includes('nữ')) tutorGender = 'female';

        await this.state.updateContext(zaloUserId, {
          tutorGender,
          findTutorStep: 'awaiting_criteria',
        });
        await this.zalo.sendText(
          zaloUserId,
          'Anh/chị có tiêu chí gì thêm không? (ví dụ: kinh nghiệm, phong cách dạy, khu vực...)\nNếu không có thể nhắn "Không".',
        );
        break;
      }

      case 'awaiting_criteria': {
        const criteria = text.toLowerCase() === 'không' || text === 'ko' ? '' : text;
        await this.state.updateContext(zaloUserId, {
          personalCriteria: criteria,
          findTutorStep: 'awaiting_confirm',
        });
        await this.sendSummary(zaloUserId, { ...context, personalCriteria: criteria });
        break;
      }

      case 'awaiting_confirm': {
        const confirmed = ['ok', 'đúng', 'xác nhận', 'yes', 'oke', 'chính xác', 'đúng rồi'].some(
          (kw) => text.toLowerCase().includes(kw),
        );
        if (confirmed) {
          await this.state.updateContext(zaloUserId, { findTutorStep: undefined });
          await this.zalo.sendText(zaloUserId, 'Tutora đang tìm gia sư phù hợp cho anh/chị, vui lòng chờ trong giây lát...');
          await this.suggestTutors(zaloUserId, context);
        } else {
          await this.state.updateContext(zaloUserId, { findTutorStep: 'awaiting_subject' });
          await this.zalo.sendText(zaloUserId, 'Anh/chị muốn thay đổi thông tin. Vui lòng nhập lại môn học:');
        }
        break;
      }
    }
  }

  private async sendSummary(zaloUserId: string, context: ConversationContext): Promise<void> {
    const genderLabel =
      context.tutorGender === 'male' ? 'Nam' :
      context.tutorGender === 'female' ? 'Nữ' : 'Không yêu cầu';

    const summary = [
      `📚 Môn học: ${context.subject}`,
      `🎓 Lớp: ${context.grade}`,
      `👤 Giới tính gia sư: ${genderLabel}`,
      context.personalCriteria ? `📝 Tiêu chí thêm: ${context.personalCriteria}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    await this.zalo.sendText(
      zaloUserId,
      `Tutora xin xác nhận lại thông tin:\n\n${summary}\n\nThông tin đúng không ạ? (nhắn "OK" để xác nhận hoặc nhắn khác để nhập lại)`,
    );
  }

  private async suggestTutors(zaloUserId: string, context: ConversationContext): Promise<void> {
    const result = await this.beClient.getMatchedTutors({
      subject: context.subject ?? '',
      grade: context.grade ?? '',
      locationDistrict: '',
      budgetMax: 999999999,
      genderPreference: context.tutorGender,
    });

    if (!result.candidates.length) {
      await this.zalo.sendText(zaloUserId, 'Hiện tại chưa có gia sư phù hợp. Tutora sẽ liên hệ lại anh/chị sớm nhé!');
      return;
    }

    await this.zalo.sendText(zaloUserId, `Tutora tìm được ${result.candidates.length} gia sư phù hợp:`);

    for (const tutor of result.candidates) {
      await this.zalo.sendTutorCard(zaloUserId, tutor, 'https://tutora.vn/gia-su');
    }

    await this.zalo.sendText(zaloUserId, 'Anh/chị muốn chọn gia sư nào? Vui lòng nhắn tên gia sư để Tutora hỗ trợ đặt lịch.');
  }

  private async handleAdminCommand(adminId: string, text: string): Promise<boolean> {
    const match = text.match(/^\/botchat\s+(on|off)\s+(\S+)$/i);
    if (!match) return false;

    const [, action, targetUserId] = match;
    const disabled = action.toLowerCase() === 'off';
    await this.state.updateContext(targetUserId, { botChatDisabled: disabled });
    await this.zalo.sendText(adminId, `BotChat cho user ${targetUserId} đã được ${disabled ? 'TẮT' : 'BẬT'}.`);
    return true;
  }
}
