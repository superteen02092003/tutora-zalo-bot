export interface CreateDisputePayload {
  bookingId?: number;
  lessonId?: number;
  createdBy: string;
  reason: string;
  disputeType: string;
  evidence?: string;
}

export interface CreateDisputeResult {
  disputeId: number;
  status: string;
}
