// SlotName: only the slots that the LLM router can fill via free-text.
// 'subject', 'grade_group', 'grade', 'mode', 'area' are button-only — NOT fillable by LLM.
// 'freetext' is the only onboarding slot the LLM touches (semantic description step).
export type SlotName = 'freetext';

export type SlotMap = Partial<Record<SlotName, string>>;

export type RouterDecision =
  | { action: 'fill_slot'; slot: SlotName; value: string }
  | { action: 'bulk_fill_slots'; slots: SlotMap }
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
