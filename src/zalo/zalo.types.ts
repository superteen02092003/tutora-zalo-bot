export interface ListElement {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  profileUrl?: string;
  buttons?: ZaloButton[];
}

export interface ZaloButton {
  title: string;
  type?: 'postback' | 'url';
  payload: string;
}

export interface QuickReplyOption {
  title: string;
  payload: string;
}
