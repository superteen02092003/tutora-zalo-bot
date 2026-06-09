export type ZaloEventType =
  | 'follow'
  | 'unfollow'
  | 'user_send_text'
  | 'user_send_image'
  | 'user_send_sticker'
  | 'postback'
  | 'oa_send_text'
  | string;

export interface ZaloWebhookEvent {
  event_name?: ZaloEventType;
  eventName?: ZaloEventType;
  sender?: {
    id?: string;
    user_id?: string;
  };
  // follow/unfollow events use follower.id instead of sender.id
  follower?: {
    id?: string;
  };
  recipient?: {
    id?: string;
  };
  user_id_by_app?: string;
  message?: {
    text?: string;
    msg_id?: string;
    attachments?: unknown[];
    quick_reply?: {
      payload?: string;
    };
  };
  postback?: {
    data?: string;
  };
  [key: string]: unknown;
}

export interface RequestWithRawBody {
  rawBody?: Buffer;
}
