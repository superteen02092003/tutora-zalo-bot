import { Injectable, Logger } from '@nestjs/common';
import { AiClientService } from '../../be-client/ai-client.service';
import { BeClientService } from '../../be-client/be-client.service';
import { SlotMap, SlotName } from '../../llm/llm-router.types';
import { MatchCriteria, TutorCandidateDto } from '../../be-client/dto';
import { SubjectCacheService } from '../../be-client/subject-cache.service';
import { ZaloService } from '../../zalo/zalo.service';
import { ConversationContext, OnboardingStep } from '../state/conversation-context.interface';
import { ConversationState } from '../state/conversation-state.enum';
import { ConversationStateService } from '../state/conversation-state.service';
import { MatchingFlow } from './matching.flow';

/** Steps where only button presses are accepted (free text triggers handleInvalidInput). */
const BUTTON_ONLY_STEPS: OnboardingStep[] = ['subject', 'grade_group', 'grade', 'mode', 'area'];

const MAX_INVALID_INPUTS = 3;

/** City buttons in step 4. */
const CITY_OPTIONS = [
  { title: 'TP.HCM', payload: 'onboarding:area:TP.HCM' },
  { title: 'Hà Nội', payload: 'onboarding:area:Hà Nội' },
  { title: 'Đà Nẵng', payload: 'onboarding:area:Đà Nẵng' },
  { title: 'Tỉnh khác', payload: 'onboarding:area:other' },
];

/** Grade ranges per group. */
const GRADE_GROUPS: Record<'cap1' | 'cap2' | 'cap3', number[]> = {
  cap1: [1, 2, 3, 4, 5],
  cap2: [6, 7, 8, 9],
  cap3: [10, 11, 12],
};

@Injectable()
export class OnboardingFlow {
  private readonly logger = new Logger(OnboardingFlow.name);

  constructor(
    private readonly beClient: BeClientService,
    private readonly subjectCache: SubjectCacheService,
    private readonly aiClient: AiClientService,
    private readonly state: ConversationStateService,
    private readonly zalo: ZaloService,
    private readonly matchingFlow: MatchingFlow,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Entry point
  // ─────────────────────────────────────────────────────────────────────────

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
      invalidInputCount: 0,
    });
    await this.state.setState(zaloUserId, ConversationState.Onboarding);
    await this.askSubject(zaloUserId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Postback entry (button clicks → onboarding:{step}:{value})
  // ─────────────────────────────────────────────────────────────────────────

  async handlePostbackInput(zaloUserId: string, payload: string): Promise<void> {
    // Payload format: onboarding:subject:{subjectId}:{subjectName}
    //                 onboarding:grade_group:cap2
    //                 onboarding:grade:7
    //                 onboarding:mode:online
    //                 onboarding:area:TP.HCM
    const parts = payload.split(':');
    if (parts.length < 3) {
      this.logger.warn(`handlePostbackInput: malformed payload "${payload}"`);
      return;
    }

    const step = parts[1] as OnboardingStep;
    // value is everything after the step prefix (supports colons in values)
    const value = parts.slice(2).join(':').trim();

    const context = await this.state.getContext(zaloUserId);

    this.logger.debug(
      `handlePostbackInput | step="${step}" value="${value}" | currentStep="${context.onboardingStep}"`,
    );

    // Guard: stale postback from a previous step
    if (context.onboardingStep !== step) {
      this.logger.warn(
        `Stale postback ignored | expected="${context.onboardingStep}" got="${step}"`,
      );
      return;
    }

    // Reset invalid input counter on a valid button press
    await this.state.updateContext(zaloUserId, { invalidInputCount: 0 });

    await this.applySlot(zaloUserId, step, value);
  }

  async applyBulkSlots(zaloUserId: string, slots: SlotMap): Promise<void> {
    const user =
      (await this.beClient.getUserByZaloId(zaloUserId)) ??
      (await this.beClient.upsertZaloLead(zaloUserId));

    const existingCtx = await this.state.getContext(zaloUserId);
    const preferredLanguage: BotLanguage = (slots['language'] as BotLanguage) ?? existingCtx.preferredLanguage ?? 'vi';

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

    switch (step) {
      // ── Step 1: subject ──────────────────────────────────────────────────
      case 'subject': {
        // Payload: "{subjectId}:{subjectName}"
        const colonIdx = value.indexOf(':');
        const subjectName = colonIdx >= 0 ? value.slice(colonIdx + 1) : value;

        await this.updateCriteria(zaloUserId, context, { subject: subjectName });
        await this.state.updateContext(zaloUserId, { onboardingStep: 'grade_group' });
        await this.askGradeGroup(zaloUserId);
        break;
      }

      // ── Step 2a: grade_group ─────────────────────────────────────────────
      case 'grade_group': {
        const group = value as 'cap1' | 'cap2' | 'cap3';
        await this.state.updateContext(zaloUserId, {
          gradeGroup: group,
          onboardingStep: 'grade',
        });
        await this.askGrade(zaloUserId, group);
        break;
      }

      // ── Step 2b: grade ───────────────────────────────────────────────────
      case 'grade': {
        const gradeLabel = `Lop ${value}`;
        await this.updateCriteria(zaloUserId, context, { grade: gradeLabel });
        await this.state.updateContext(zaloUserId, { onboardingStep: 'mode' });
        await this.askMode(zaloUserId);
        break;
      }

      // ── Step 3: mode ─────────────────────────────────────────────────────
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
          await this.askCity(zaloUserId);
        }
        break;
      }

      // ── Step 4: area ─────────────────────────────────────────────────────
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

      // ── Step 5: freetext ─────────────────────────────────────────────────
      case 'freetext': {
        const trimmed = value.trim();
        const isSkip = /^(bỏ qua|bo qua|skip|không|khong|thôi|thoi)$/i.test(trimmed);

        if (!isSkip && trimmed.length > 0) {
          await this.state.updateContext(zaloUserId, { freetextQuery: trimmed });
        }

        await this.state.updateContext(zaloUserId, { onboardingStep: 'done' });
        await this.triggerMatching(zaloUserId);
        break;
      }

      default:
        this.logger.warn(`applySlot: unhandled step "${step as string}"`);
        break;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Invalid input handler (free text during button-only step)
  // ─────────────────────────────────────────────────────────────────────────

  async handleInvalidInput(zaloUserId: string): Promise<void> {
    const context = await this.state.getContext(zaloUserId);
    const count = (context.invalidInputCount ?? 0) + 1;
    await this.state.updateContext(zaloUserId, { invalidInputCount: count });

    if (count >= MAX_INVALID_INPUTS) {
      // Escalate to CS
      await this.zalo.sendText(
        zaloUserId,
        'Mình sẽ kết nối bạn với nhân viên tư vấn Tutora để được hỗ trợ trực tiếp nhé! 🙏',
      );
      await this.state.updateContext(zaloUserId, { botChatDisabled: true });
      return;
    }

    await this.zalo.sendText(
      zaloUserId,
      'Bạn vui lòng nhấn chọn một trong các gợi ý bên dưới nhé 👇',
    );

    // Resend the buttons for the current step
    const step = context.onboardingStep;
    switch (step) {
      case 'subject':
        await this.askSubject(zaloUserId);
        break;
      case 'grade_group':
        await this.askGradeGroup(zaloUserId);
        break;
      case 'grade':
        if (context.gradeGroup) {
          await this.askGrade(zaloUserId, context.gradeGroup);
        }
        break;
      case 'mode':
        await this.askMode(zaloUserId);
        break;
      case 'area':
        await this.askCity(zaloUserId);
        break;
      default:
        break;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step: check if current step is button-only (for message handler)
  // ─────────────────────────────────────────────────────────────────────────

  isButtonOnlyStep(step: OnboardingStep): boolean {
    return (BUTTON_ONLY_STEPS as string[]).includes(step as string);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Trigger matching: .NET hard filter → AI re-rank → show results
  // ─────────────────────────────────────────────────────────────────────────

  private async triggerMatching(zaloUserId: string): Promise<void> {
    const context = await this.state.getContext(zaloUserId);

    if (!context.criteria) {
      await this.zalo.sendText(
        zaloUserId,
        'Mình cần thêm thông tin để tìm gia sư. Bạn nhắn "tìm gia sư" để bắt đầu lại nhé.',
      );
      return;
    }

    await this.zalo.sendText(zaloUserId, 'Đang tìm gia sư phù hợp cho bạn...');

    // Step 1: Hard filter via .NET BE
    const result = await this.beClient.getMatchedTutors(context.criteria);
    await this.state.updateContext(zaloUserId, { subjectId: result.subjectId });

    if (result.candidates.length === 0) {
      await this.matchingFlow.showMatches(zaloUserId, []);
      return;
    }

    // Step 2: AI semantic re-ranking
    const candidateIds = result.candidates.map((c) => c.tutorId);
    const freetextQuery = context.freetextQuery ?? this.buildFallbackQuery(context);
    const rankedIds = await this.aiClient.rankCandidates(freetextQuery, candidateIds, 10);

    // Step 3: Reorder candidates array by AI ranking
    const candidateMap = new Map<string, TutorCandidateDto>(
      result.candidates.map((c) => [c.tutorId, c]),
    );
    const rankedCandidates = rankedIds
      .map((id) => candidateMap.get(id))
      .filter((c): c is TutorCandidateDto => c !== undefined);

    // Step 4: Show results
    await this.matchingFlow.showMatches(zaloUserId, rankedCandidates);
  }

  /** Build a descriptive query string from criteria when no freetext was provided. */
  private buildFallbackQuery(context: ConversationContext): string {
    const c = context.criteria;
    if (!c) return '';
    const parts: string[] = [];
    if (c.subject) parts.push(`gia sư ${c.subject}`);
    if (c.grade) parts.push(c.grade.replace('Lop ', 'lớp '));
    if (c.teachingMode) {
      parts.push(
        c.teachingMode === 'online'
          ? 'dạy online'
          : c.teachingMode === 'offline'
            ? 'dạy tại nhà'
            : 'dạy online hoặc tại nhà',
      );
    }
    if (c.locationDistrict) parts.push(`khu vực ${c.locationDistrict}`);
    if (c.purpose) {
      const purposeMap: Record<string, string> = {
        exam_prep: 'ôn thi',
        regular: 'học thêm',
        foundation: 'lấy lại nền',
        advanced: 'nâng cao',
      };
      parts.push(purposeMap[c.purpose] ?? c.purpose);
    }
    return parts.join(' ');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Ask helpers
  // ─────────────────────────────────────────────────────────────────────────

  private async askSubject(zaloUserId: string): Promise<void> {
    const subjects = await this.subjectCache.getSubjects();
    const options = subjects.slice(0, 10).map((s) => ({
      title: s.name,
      payload: `onboarding:subject:${s.subjectId}:${s.name}`,
    }));

    await this.zalo.sendQuickReply(
      zaloUserId,
      'Tutora sẽ giúp bạn tìm gia sư phù hợp. Bạn muốn học môn gì?',
      options,
    );
  }

  private async askGradeGroup(zaloUserId: string): Promise<void> {
    await this.zalo.sendQuickReply(
      zaloUserId,
      'Học sinh đang học cấp mấy?',
      [
        { title: 'Cấp 1 (lớp 1-5)', payload: 'onboarding:grade_group:cap1' },
        { title: 'Cấp 2 (lớp 6-9)', payload: 'onboarding:grade_group:cap2' },
        { title: 'Cấp 3 (lớp 10-12)', payload: 'onboarding:grade_group:cap3' },
      ],
    );
  }

  private async askGrade(
    zaloUserId: string,
    group: 'cap1' | 'cap2' | 'cap3',
  ): Promise<void> {
    const grades = GRADE_GROUPS[group];
    const options = grades.map((g) => ({
      title: `Lớp ${g}`,
      payload: `onboarding:grade:${g}`,
    }));

    await this.zalo.sendQuickReply(
      zaloUserId,
      'Học sinh đang học lớp mấy?',
      options,
    );
  }

  private async askMode(zaloUserId: string): Promise<void> {
    await this.zalo.sendQuickReply(
      zaloUserId,
      'Bạn muốn học theo hình thức nào?',
      [
        { title: '💻 Học online', payload: 'onboarding:mode:online' },
        { title: '🏠 Gia sư đến nhà', payload: 'onboarding:mode:offline' },
        { title: '🔄 Linh hoạt cả hai', payload: 'onboarding:mode:both' },
      ],
    );
  }

  private async askCity(zaloUserId: string): Promise<void> {
    await this.zalo.sendQuickReply(
      zaloUserId,
      'Bạn đang ở thành phố nào?',
      CITY_OPTIONS,
    );
  }

  private async askFreetext(zaloUserId: string): Promise<void> {
    await this.zalo.sendText(
      zaloUserId,
      'Bạn có mô tả thêm về yêu cầu không? Ví dụ: "gia sư kiên nhẫn, có kinh nghiệm luyện thi đại học". Hoặc nhắn "bỏ qua" để tìm ngay.',
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

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
}
