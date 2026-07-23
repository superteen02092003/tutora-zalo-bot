# Tutora Zalo Bot - BE Internal API Contract

This contract defines the internal API surface required by `tutora-zalo-bot`.
The bot never connects to PostgreSQL directly. The .NET backend remains the
source of truth for users, tutor matching, bookings, lessons, payments, payout,
refund, and timing logic.

All bot-to-BE requests must include:

```http
X-Internal-Key: {BE_INTERNAL_API_KEY}
```

All BE-to-bot event pushes must include:

```http
X-BE-Event-Secret: {BE_EVENT_SECRET}
```

## Ownership

- Bot owns: Zalo webhook handling, conversation state, quick replies, Zalo/ZNS delivery, basic NLU fallback.
- BE owns: domain state, payment callbacks, refund policy, payout logic, Hangfire timing, booking/lesson status transitions.
- Redis keys in the bot use `zaloUserId` because a new Zalo user may not have a BE `userId` yet.
- BE event delivery is idempotent. The bot deduplicates events with atomic `SET NX`.

## Subjects

### `GET /internal/subjects`

Used by the bot at startup to cache subject options for onboarding quick replies.

Response:

```ts
type SubjectDto = {
  subjectId: number;
  name: string;
};
```

## Users

### `GET /internal/users/by-zalo/:zaloId`

Looks up an existing BE user by Zalo user id.

Response:

```ts
type UserDto = {
  userId: string;
  zaloUserId: string;
  fullName: string;
  primaryRole: 'parent' | 'tutor' | 'student' | 'admin';
  status: number;
};
```

Returns `404` when no user is linked to the Zalo id.

### `POST /internal/users/zalo-lead`

Creates or links a parent lead when a Zalo user does not have a BE account yet.
This endpoint must be an upsert: if `zaloUserId` already exists, return the existing user.

Request:

```ts
type UpsertZaloLeadRequest = {
  zaloUserId: string;
  fullName?: string;
  avatarUrl?: string;
};
```

Response:

```ts
type UpsertZaloLeadResponse = UserDto & {
  isNew: boolean;
};
```

### `GET /internal/users/by-zalo/:zaloId/active-booking`

Returns the user's active booking, if any. Used when the user sends an image.

Response:

```ts
type ActiveBookingResponse = BookingDto | null;
```

## Tutor Matching

### `GET /internal/tutors/match`

Query:

```ts
type MatchTutorQuery = {
  subject: string;
  grade: string;
  locationDistrict: string;
  budgetMax: number;
  genderPreference?: string;
};
```

Response:

```ts
type MatchTutorResponse = {
  subjectId: number;
  candidates: TutorCandidateDto[];
};
```

BE resolves `subject` text to `subjectId` and returns candidates sorted by rank.
The bot stores `subjectId` in conversation context and uses it when creating a booking.

```ts
type TutorCandidateDto = {
  tutorId: string;
  fullName: string;
  avatarUrl?: string;
  bio?: string;
  hourlyRate: number;
  trialLessonPrice?: number;
  averageRating: number;
  totalReviews: number;
  totalCompletedLessons: number;
  totalStudentsTaught: number;
  subscriptionType: 'standard' | 'pro' | 'premium';
  teachingMode: string;
  teachingAreaDistrict?: string;
};
```

## Bookings

### `POST /internal/bookings`

Request:

```ts
type CreateBookingRequest = {
  parentId: string;
  studentId?: string;
  tutorId: string;
  subjectId: number;
  sessionCount: number;
  schedule: string;
  locationDistrict: string;
  teachingMode: string;
  depositAmount: number;
};
```

If `studentId` is omitted, BE creates a temporary `StudentProfile`.

Response:

```ts
type BookingDto = {
  bookingId: number;
  status: string;
  paymentStatus: string;
  escrowStatus: string;
  sessionCount: number;
  sessionsRemaining: number;
  depositAmount: number;
  remainingAmount: number;
  finalPrice: number;
  schedule: string;
  startDate?: string;
};
```

### `GET /internal/bookings/:id`

Response:

```ts
type BookingWithLessonsDto = BookingDto & {
  lessons: LessonDto[];
};
```

### `POST /internal/bookings/:id/cancel`

BE calculates refund policy and escrow state.

Request:

```ts
type CancelBookingRequest = {
  cancelledBy: string;
  reason: string;
};
```

Response:

```ts
type CancellationResult = {
  refundAmount: number;
  refundStatus: string;
  escrowStatus: string;
};
```

## Lessons

```ts
type LessonDto = {
  lessonId: number;
  bookingId: number;
  scheduledStart: string;
  scheduledEnd: string;
  status: string;
  isTutorPresent?: boolean;
  isStudentPresent?: boolean;
  isMakeup: boolean;
};
```

### `POST /internal/lessons/:lessonId/reschedule`

Request:

```ts
type RescheduleLessonRequest = {
  newStart: string;
  newEnd: string;
  requestedBy: string;
  reason?: string;
};
```

Response:

```ts
type RescheduleResult = {
  lessonId: number;
  status: string;
  requiresTutorApproval: boolean;
};
```

### `POST /internal/lessons/:lessonId/reschedule/respond`

Request:

```ts
type RespondRescheduleRequest = {
  tutorId: string;
  accept: boolean;
  reason?: string;
};
```

Response:

```ts
type RespondRescheduleResponse = {
  lessonId: number;
  newStart?: string;
  newEnd?: string;
  status: string;
};
```

## Payment

### `POST /internal/payments/booking/:bookingId/create-qr`

BE creates the PayOS payment link/QR and handles PayOS callbacks.
The bot only sends the returned QR/image to the user.

Response:

```ts
type PaymentQrDto = {
  qrCodeUrl: string;
  orderCode: number;
  amount: number;
  expiredAt: string;
};
```

BE may back this with `Topuprequest`, `Booking.Paymentcode`, or a separate payment record.
That implementation detail is intentionally hidden from the bot.

## Payout

### `POST /internal/payouts/booking/:bookingId/release`

Request:

```ts
type ReleasePayoutRequest = {
  round: 'first' | 'final';
  confirmedByParent: boolean;
};
```

## Disputes

### `POST /internal/disputes`

Request:

```ts
type CreateDisputeRequest = {
  bookingId?: number;
  lessonId?: number;
  createdBy: string;
  reason: string;
  disputeType: string;
  evidence?: string;
};
```

Response:

```ts
type CreateDisputeResponse = {
  disputeId: number;
  status: string;
};
```

## BE To Bot Event Push

### `POST /internal/be-events`

Endpoint is hosted by the bot server. BE calls it from domain flows and Hangfire jobs.

Request:

```ts
type BeEventDto = {
  eventId: string;
  occurredAt: string;
  dedupeKey: string;
  eventType: BeEventType;
  zaloUserId: string;
  payload: BeEventPayload;
};

type BeEventType =
  | 'payment_confirmed'
  | 'payment_expired'
  | 'first_session_started'
  | 'session_reminder_24h'
  | 'session_reminder_1h'
  | 'session_report_ready'
  | 'tutor_noshow'
  | 'tutor_declined'
  | 'reschedule_accepted'
  | 'reschedule_rejected'
  | 'parent_unresponsive'
  | 'payout_ready'
  | 'renewal_reminder';
```

Idempotency rule:

```ts
SET be-event:{eventId} 1 NX EX 259200
```

If the key already exists, the bot returns `200` and does not process the event again.

### Event Payloads

```ts
type PaymentEventPayload = {
  bookingId: number;
  amount: number;
};

type FirstSessionStartedPayload = {
  lessonId: number;
  bookingId: number;
};

type SessionReminderPayload = {
  lessonId: number;
  scheduledStart: string;
  tutorName: string;
};

type SessionReportReadyPayload = {
  lessonId: number;
  lessonContent: string;
  homework: string;
  tutorNotes?: string;
};

type RescheduleAcceptedPayload = {
  lessonId: number;
  newStart: string;
  newEnd: string;
  role: 'parent' | 'tutor';
};

type RescheduleRejectedPayload = {
  lessonId: number;
  reason?: string;
};

type TutorDeclinedPayload = {
  bookingId: number;
  tutorName: string;
  reason?: string;
};

type TutorNoShowPayload = {
  lessonId: number;
  scheduledStart: string;
};

type ParentUnresponsivePayload = {
  bookingId: number;
  reminderCount: 1 | 2 | 3;
};

type PayoutReadyPayload = {
  bookingId: number;
  round: 'first' | 'final';
  amount: number;
};

type RenewalReminderPayload = {
  bookingId: number;
  sessionsLeft: number;
  tutorName: string;
};
```

Dual-side event rule: BE pushes two separate events when both parent and tutor must receive a message. Each event has exactly one `zaloUserId`. The bot always formats messages for the recipient in `zaloUserId`, using fields such as `payload.role` when needed.

## State Triggers

| Transition | Trigger |
| --- | --- |
| `NEW -> ONBOARDING` | Zalo follow or first message |
| `ONBOARDING -> MATCHED` | Criteria completed and matching returned candidates |
| `MATCHED -> BOOKING_CONFIRM` | User selects a tutor and bot creates booking + QR |
| `BOOKING_CONFIRM -> BOOKED` | BE pushes `payment_confirmed` |
| `BOOKED -> ACTIVE` | BE pushes `first_session_started` after first lesson check-in |

## Out Of MVP

Photo-to-solution is outside the first MVP because DeepSeek vision support is not part of the current plan.
For `user_send_image`, the bot should send a fixed response:

- Active booking exists: acknowledge the image and say it was forwarded to the tutor.
- No active booking: explain that image help is for active learners and prompt booking.
