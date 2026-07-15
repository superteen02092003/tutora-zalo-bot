import { Injectable, Logger } from '@nestjs/common';
import { BeClientService } from '../../be-client/be-client.service';
import { MatchCriteria } from '../../be-client/dto';
import { SlotMap, SlotName } from '../../llm/llm-router.types';
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
    language?: 'vi' | 'en',
  ): Promise<void> {
    const user =
      (await this.beClient.getUserByZaloId(zaloUserId)) ??
      (await this.beClient.upsertZaloLead(
        zaloUserId,
        profile?.fullName,
        profile?.avatarUrl,
      ));

    const existingCtx = await this.state.getContext(zaloUserId);
    const preferredLanguage: BotLanguage = language ?? existingCtx.preferredLanguage ?? 'vi';

    await this.state.setContext(zaloUserId, {
      zaloUserId,
      parentId: user.userId,
      preferredLanguage,
      onboardingStep: 'subject',
    });
    await this.state.setState(zaloUserId, ConversationState.Onboarding);
    await this.askSubject(zaloUserId, preferredLanguage);
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

  async applyBulkSlots(zaloUserId: string, slots: SlotMap): Promise<void> {
    const user =
      (await this.beClient.getUserByZaloId(zaloUserId)) ??
      (await this.beClient.upsertZaloLead(zaloUserId));

    const existingCtx = await this.state.getContext(zaloUserId);
    const preferredLanguage: BotLanguage = existingCtx.preferredLanguage ?? 'vi';

    // Build criteria directly from slots without triggering intermediate questions
    const criteria: MatchCriteria = {
      subject: '',
      grade: '',
      teachingMode: 'both',
      ...existingCtx.criteria,
    };
    if (slots.subject) criteria.subject = slots.subject;
    if (slots.grade) criteria.grade = slots.grade;
    if (slots.mode) criteria.teachingMode = slots.mode as MatchCriteria['teachingMode'];
    else if (!existingCtx.criteria?.teachingMode) delete (criteria as Partial<MatchCriteria>).teachingMode;
    if (slots.area) criteria.locationDistrict = slots.area;
    if (slots.purpose) criteria.purpose = slots.purpose as MatchCriteria['purpose'];

    const hasMode = !!criteria.teachingMode;
    const REQUIRED: SlotName[] = ['subject', 'grade', 'mode', 'purpose'];
    const needsArea = hasMode && criteria.teachingMode !== 'online';
    if (needsArea) REQUIRED.push('area');

    const missingSlot = REQUIRED.find((s) => {
      if (s === 'area') return !criteria.locationDistrict;
      if (s === 'subject') return !criteria.subject;
      if (s === 'grade') return !criteria.grade;
      if (s === 'mode') return !hasMode;
      if (s === 'purpose') return !criteria.purpose;
      return false;
    });

    await this.state.setContext(zaloUserId, {
      zaloUserId,
      parentId: user.userId,
      preferredLanguage,
      chatHistory: existingCtx.chatHistory,
      criteria,
      onboardingStep: missingSlot ?? 'done',
    });
    await this.state.setState(zaloUserId, ConversationState.Onboarding);

    if (!missingSlot) {
      await this.matchingFlow.showMatches(zaloUserId);
      return;
    }

    // Only ask for the first missing slot
    const ctx = await this.state.getContext(zaloUserId);
    switch (missingSlot) {
      case 'subject': await this.askSubject(zaloUserId, preferredLanguage); break;
      case 'grade':
        await this.zalo.sendText(zaloUserId, this.text(ctx, {
          vi: 'Học sinh đang học lớp mấy? Nhắn số lớp nhé (1-12).',
          en: 'What grade is the student in? (1-12)',
        }));
        break;
      case 'mode': {
        const modeSummary = [
          criteria.subject && `môn ${criteria.subject}`,
          criteria.grade && criteria.grade.replace('Lop ', 'lớp '),
          criteria.locationDistrict && `khu vực ${criteria.locationDistrict}`,
          criteria.purpose && { exam_prep: 'ôn thi', regular: 'học thêm', foundation: 'lấy nền', advanced: 'nâng cao' }[criteria.purpose],
        ].filter(Boolean).join(', ');
        if (modeSummary) {
          await this.zalo.sendText(zaloUserId, `Tutora đã ghi nhận: ${modeSummary}. Bạn muốn học theo hình thức nào?`);
        }
        await this.askMode(zaloUserId, ctx);
        break;
      }
      case 'area':
        await this.zalo.sendText(zaloUserId, this.text(ctx, {
          vi: 'Bạn muốn học ở khu vực quận/huyện nào?',
          en: 'Which district/area would you like to study in?',
        }));
        break;
      case 'purpose': {
        const summary = [
          criteria.subject && `môn ${criteria.subject}`,
          criteria.grade && criteria.grade.replace('Lop ', 'lớp '),
          criteria.teachingMode === 'offline' ? 'tại nhà' : criteria.teachingMode === 'online' ? 'online' : criteria.teachingMode === 'both' ? 'linh hoạt' : null,
          criteria.locationDistrict && `khu vực ${criteria.locationDistrict}`,
        ].filter(Boolean).join(', ');
        if (summary) {
          await this.zalo.sendText(zaloUserId, this.text(ctx, {
            vi: `Tutora đã ghi nhận: ${summary}. Cho mình biết thêm mục tiêu học của con nhé!`,
            en: `Got it: ${summary}. What is the student's learning goal?`,
          }));
        }
        await this.askPurpose(zaloUserId, ctx);
        break;
      }
    }
  }

  async applySlot(
    zaloUserId: string,
    slot: SlotName,
    value: string,
  ): Promise<void> {
    const context = await this.state.getContext(zaloUserId);

    switch (slot) {
      case 'subject': {
        await this.updateCriteria(zaloUserId, context, { subject: value });
        await this.state.updateContext(zaloUserId, { onboardingStep: 'grade' });
        await this.zalo.sendText(
          zaloUserId,
          this.text(context, {
            vi: 'Học sinh đang học lớp mấy? Nhắn số lớp nhé (1-12, ví dụ: 9, 10, 11).',
            en: 'What grade is the student in? Please reply with a grade number (1-12).',
          }),
        );
        break;
      }

      case 'grade': {
        await this.updateCriteria(zaloUserId, context, { grade: value });
        await this.state.updateContext(zaloUserId, { onboardingStep: 'mode' });
        await this.askMode(zaloUserId, context);
        break;
      }

      case 'mode': {
        const teachingMode = value as 'online' | 'offline' | 'both';
        await this.updateCriteria(zaloUserId, context, { teachingMode });
        const updatedCtx = await this.state.getContext(zaloUserId);

        if (teachingMode === 'online' || updatedCtx.criteria?.locationDistrict) {
          // Skip area if online or already filled
          if (updatedCtx.criteria?.purpose) {
            // All slots filled — go to matching
            await this.state.updateContext(zaloUserId, { onboardingStep: 'done' });
            await this.matchingFlow.showMatches(zaloUserId);
          } else {
            await this.state.updateContext(zaloUserId, { onboardingStep: 'purpose' });
            await this.askPurpose(zaloUserId, updatedCtx);
          }
        } else {
          await this.state.updateContext(zaloUserId, { onboardingStep: 'area' });
          await this.zalo.sendText(
            zaloUserId,
            this.text(context, {
              vi: 'Bạn muốn học ở khu vực quận/huyện nào? Ví dụ: Quận 1, Gò Vấp, Thủ Đức.',
              en: 'Which district/area would you like to study in? For example: District 1, Go Vap, Thu Duc.',
            }),
          );
        }
        break;
      }

      case 'area': {
        await this.updateCriteria(zaloUserId, context, { locationDistrict: value });
        const updatedCtx = await this.state.getContext(zaloUserId);
        if (updatedCtx.criteria?.purpose) {
          await this.state.updateContext(zaloUserId, { onboardingStep: 'done' });
          await this.matchingFlow.showMatches(zaloUserId);
        } else {
          await this.state.updateContext(zaloUserId, { onboardingStep: 'purpose' });
          await this.askPurpose(zaloUserId, updatedCtx);
        }
        break;
      }

      case 'purpose': {
        await this.updateCriteria(zaloUserId, context, {
          purpose: value as MatchCriteria['purpose'],
        });
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
    await this.zalo.sendText(
      zaloUserId,
      preferredLanguage === 'en'
        ? 'Tutora will help you find a suitable tutor. Which subject would you like to study? (e.g. Math, English, Physics...)'
        : 'Tutora sẽ giúp bạn tìm gia sư phù hợp. Bạn muốn học môn gì? (ví dụ: Toán, Tiếng Anh, Vật Lý...)',
    );
  }

  private async askMode(
    zaloUserId: string,
    context: ConversationContext,
  ): Promise<void> {
    await this.zalo.sendQuickReply(
      zaloUserId,
      this.text(context, {
        vi: 'Bạn muốn học theo hình thức nào?',
        en: 'How would you like to study?',
      }),
      [
        {
          title: this.text(context, { vi: '💻 Học online', en: '💻 Online' }),
          payload: 'onboarding:mode:online',
        },
        {
          title: this.text(context, { vi: '🏠 Gia sư đến nhà', en: '🏠 In-person (at home)' }),
          payload: 'onboarding:mode:offline',
        },
        {
          title: this.text(context, { vi: '🔄 Linh hoạt cả hai', en: '🔄 Flexible (both)' }),
          payload: 'onboarding:mode:both',
        },
      ],
    );
  }

  private async askPurpose(
    zaloUserId: string,
    context: ConversationContext,
  ): Promise<void> {
    await this.zalo.sendNumberedList(
      zaloUserId,
      this.text(context, {
        vi: 'Mục tiêu học của con là gì?',
        en: "What is the student's learning goal?",
      }),
      this.isEnglish(context)
        ? [
            { label: 'Exam prep', hint: 'entrance exam, university exam' },
            { label: 'General study', hint: 'follow school curriculum' },
            { label: 'Build foundation', hint: 'catch up on basics' },
            { label: 'Advanced', hint: 'gifted student / enrichment' },
          ]
        : [
            { label: 'Ôn thi', hint: 'thi vào 10, THPT quốc gia, đại học' },
            { label: 'Học thêm', hint: 'theo chương trình trường' },
            { label: 'Lấy lại nền', hint: 'mất căn bản, học lại từ đầu' },
            { label: 'Nâng cao', hint: 'học sinh giỏi, tư duy chuyên sâu' },
          ],
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
        teachingMode: 'both',
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
