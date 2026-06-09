import { ZaloWebhookEvent } from './zalo-event.dto';

export function getZaloUserId(event: ZaloWebhookEvent): string | undefined {
  // follow/unfollow use follower.id; messages use sender.id
  return event.follower?.id ?? event.sender?.id ?? event.sender?.user_id;
}

export function getMessageText(event: ZaloWebhookEvent): string {
  return event.message?.text?.trim() ?? '';
}

export function getEventPayload(event: ZaloWebhookEvent): string {
  return (
    event.postback?.data ??
    event.message?.quick_reply?.payload ??
    event.message?.text ??
    ''
  ).trim();
}
