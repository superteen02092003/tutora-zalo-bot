import type { OnboardingStep } from '../bot/state/conversation-context.interface';

export type SlotName = Exclude<OnboardingStep, 'done'>;

export type RouterDecision =
  | { action: 'fill_slot'; slot: SlotName; value: string }
  | { action: 'start_onboarding' }
  | { action: 'select_tutor'; tutorName: string }
  | { action: 'select_package'; sessionCount: 4 | 8 | 12 }
  | { action: 'select_schedule'; preset: 'twice_weekly' | 'three_weekly' }
  | { action: 'initiate_reschedule' }
  | { action: 'initiate_cancel' }
  | { action: 'initiate_dispute' }
  | { action: 'check_status' }
  | { action: 'answer_question'; reply: string }
  | { action: 'unknown'; reply: string };
