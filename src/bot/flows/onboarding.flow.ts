import { Injectable, Logger } from '@nestjs/common';
import { BeClientService } from '../../be-client/be-client.service';
import { MatchCriteria } from '../../be-client/dto';
import { SlotName } from '../../llm/llm-router.types';
import { ZaloService } from '../../zalo/zalo.service';
import { ConversationContext } from '../state/conversation-context.interface';
import { ConversationState } from '../state/conversation-state.enum';
import { ConversationStateService } from '../state/conversation-state.service';
import { MatchingFlow } from './matching.flow';

type BotLanguage = 'vi' | 'en';

@Injectable()
export class OnboardingFlow {
  private readonly logger = new Logger(OnboardingFlow.name);

  constructor(
    private readonly beClient: BeClientService,
    private readonly state: ConversationStateService,
    private readonly zalo: ZaloService,
    private readonly matchingFlow: MatchingFlow,
  ) {}

  async start(
    zaloUserId: string,
    profile?: { fullName?: string; avatarUrl?: string },
  ): Promise<void> {
    const user =
      (await this.beClient.getUserByZaloId(zaloUserId)) ??
      (await this.beClient.upsertZaloLead(
        zaloUserId,
        profile?.fullName,
        profile?.avatarUrl,
      ));

    await this.state.setContext(zaloUserId, {
      zaloUserId,
      parentId: user.userId,
      preferredLanguage: 'vi',
      onboardingStep: 'subject',
    });
    await this.state.setState(zaloUserId, ConversationState.Onboarding);
    await this.askSubject(zaloUserId, 'vi');
  }

  async handlePostbackInput(zaloUserId: string, payload: string): Promise<void> {
    const parts = payload.split(':');
    if (parts.length < 3) {
      this.logger.warn(`handlePostbackInput: malformed payload "${payload}"`);
      return;
    }
    const slot = parts[1] as SlotName;
    const value = parts.slice(2).join(':').trim();
    const context = await this.state.getContext(zaloUserId);

    this.logger.debug(
      `handlePostbackInput | slot="${slot}" value="${value}" | currentStep="${context.onboardingStep}"`,
    );

    if (context.onboardingStep !== slot) {
      this.logger.warn(
        `Stale postback ignored | expected step="${context.onboardingStep}" got slot="${slot}"`,
      );
      return;
    }

    await this.applySlot(zaloUserId, slot, value);
  }

  async applySlot(
    zaloUserId: string,
    slot: SlotName,
    value: string,
  ): Promise<void> {
    const context = await this.state.getContext(zaloUserId);

    switch (slot) {
      case 'language': {
        const preferredLanguage: BotLanguage = value === 'en' ? 'en' : 'vi';
        await this.state.updateContext(zaloUserId, {
          preferredLanguage,
          onboardingStep: 'subject',
        });
        await this.askSubject(zaloUserId, preferredLanguage);
        break;
      }

      case 'subject': {
        await this.updateCriteria(zaloUserId, context, { subject: value });
        await this.state.updateContext(zaloUserId, { onboardingStep: 'grade' });
        await this.zalo.sendText(
          zaloUserId,
          this.text(context, {
            vi: 'Học sinh đang học lớp mấy? Nhắn số lớp nhé (1-12, ví dụ: 9, 10, 11).',
            en: 'What grade is the student in? Please reply with a grade number (1-12, for example: 9, 10, 11).',
          }),
        );
        break;
      }

      case 'grade': {
        await this.updateCriteria(zaloUserId, context, { grade: value });
        await this.state.updateContext(zaloUserId, { onboardingStep: 'area' });
        await this.zalo.sendText(
          zaloUserId,
          this.text(context, {
            vi: 'Bạn muốn học ở khu vực quận/huyện nào? Ví dụ: Quận 1, Gò Vấp, Thủ Đức.',
            en: 'Which district/area would you like to study in? For example: District 1, Go Vap, Thu Duc.',
          }),
        );
        break;
      }

      case 'area': {
        await this.updateCriteria(zaloUserId, context, {
          locationDistrict: value,
        });
        await this.state.updateContext(zaloUserId, { onboardingStep: 'budget' });
        await this.zalo.sendNumberedList(
          zaloUserId,
          this.text(context, {
            vi: 'Ngân sách mỗi buổi của bạn?',
            en: 'What is your budget per lesson?',
          }),
          this.isEnglish(context)
            ? [
                { label: 'Under 150k' },
                { label: '150k - 250k' },
                { label: 'Over 250k' },
              ]
            : [
                { label: 'Dưới 150k' },
                { label: '150k - 250k' },
                { label: 'Trên 250k' },
              ],
        );
        break;
      }

      case 'budget': {
        const budgetMax = Number(value);
        if (!budgetMax) break;
        await this.updateCriteria(zaloUserId, context, { budgetMax });
        await this.state.updateContext(zaloUserId, { onboardingStep: 'gender' });
        await this.zalo.sendNumberedList(
          zaloUserId,
          this.text(context, {
            vi: 'Bạn có ưu tiên giới tính gia sư không?',
            en: 'Do you have a gender preference for the tutor?',
          }),
          this.isEnglish(context)
            ? [
                { label: 'No preference' },
                { label: 'Male tutor' },
                { label: 'Female tutor' },
              ]
            : [
                { label: 'Không ưu tiên' },
                { label: 'Thầy (Nam)' },
                { label: 'Cô (Nữ)' },
              ],
        );
        break;
      }

      case 'gender': {
        const genderPreference =
          value === 'any' ? undefined : (value as 'male' | 'female');
        await this.updateCriteria(zaloUserId, context, { genderPreference });
        await this.state.updateContext(zaloUserId, { onboardingStep: 'done' });
        await this.matchingFlow.showMatches(zaloUserId);
        break;
      }
    }
  }

  private async askSubject(
    zaloUserId: string,
    preferredLanguage: BotLanguage,
  ): Promise<void> {
    const subjects = await this.beClient.getSubjects();
    await this.zalo.sendInteractiveQuickReply(
      zaloUserId,
      preferredLanguage === 'en'
        ? 'Tutora will help you find a suitable tutor. Which subject would you like to study?'
        : 'Tutora sẽ giúp bạn tìm gia sư phù hợp. Bạn muốn học môn nào?',
      subjects.slice(0, 6).map((subject) => ({
        title: subject.name,
        payload: `onboarding:subject:${subject.name}`,
      })),
    );
  }

  private async updateCriteria(
    zaloUserId: string,
    context: ConversationContext,
    partial: Partial<MatchCriteria>,
  ): Promise<void> {
    await this.state.updateContext(zaloUserId, {
      criteria: {
        subject: '',
        grade: '',
        locationDistrict: '',
        budgetMax: 0,
        ...context.criteria,
        ...partial,
      },
    });
  }

  private isEnglish(context: ConversationContext): boolean {
    return context.preferredLanguage === 'en';
  }

  private text(
    context: ConversationContext,
    copy: { vi: string; en: string },
  ): string {
    return this.isEnglish(context) ? copy.en : copy.vi;
  }
}
