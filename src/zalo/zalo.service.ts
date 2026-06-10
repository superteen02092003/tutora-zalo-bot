import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { TutorCandidateDto } from '../be-client/dto';
import { RedisService } from '../common/redis/redis.service';
import { TutorCardImageService } from './tutor-card-image.service';
import { ListElement, QuickReplyOption } from './zalo.types';

const TUTOR_CARD_ATTACHMENT_TTL = 3 * 24 * 60 * 60; // 3 days

const ZALO_CS_URL = 'https://openapi.zalo.me/v3.0/oa/message/cs';
const ZALO_PROMO_URL = 'https://openapi.zalo.me/v3.0/oa/message/promotion';
const ZALO_UPLOAD_IMAGE_URL = 'https://openapi.zalo.me/v2.0/oa/upload/image';
const ZALO_ZBS_TEMPLATE_URL = 'https://openapi.zalo.me/v3.0/oa/message/template';

@Injectable()
export class ZaloService {
  private readonly logger = new Logger(ZaloService.name);
  private readonly accessToken?: string;
  private readonly stubMode: boolean;

  constructor(
    private readonly http: HttpService,
    private readonly tutorCardImage: TutorCardImageService,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.accessToken = config.get<string>('zalo.accessToken');
    this.stubMode = config.get<boolean>('stubMode', true);
  }

  // ── Plain text ────────────────────────────────────────────────────────────

  async sendText(userId: string, text: string): Promise<void> {
    await this.sendMessage(userId, { text });
  }

  async sendImage(userId: string, imageUrl: string, caption?: string): Promise<void> {
    const message: Record<string, unknown> = {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'media',
          elements: [{ media_type: 'image', url: imageUrl }],
        },
      },
    };

    if (caption) {
      message.text = caption;
    }

    await this.sendMessage(userId, message);
  }

  async uploadImageBuffer(
    image: Buffer,
    filename = 'image.png',
  ): Promise<string> {
    if (!this.accessToken) {
      this.logger.debug(`[stub/upload-image] ${filename} (${image.length} bytes)`);
      return 'stub-attachment-id';
    }

    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(image)], { type: 'image/png' }),
      filename,
    );

    this.logger.log(`Uploading Zalo image ${filename} (${image.length} bytes)`);
    const res = await lastValueFrom(
      this.http.post(ZALO_UPLOAD_IMAGE_URL, form, {
        headers: { access_token: this.accessToken },
      }),
    );
    this.logger.log(`Zalo upload image response: ${JSON.stringify(res.data)}`);

    const data = res.data as {
      error?: number;
      message?: string;
      data?: { attachment_id?: string };
    };
    if (data.error !== 0 || !data.data?.attachment_id) {
      throw new Error(`Zalo upload image error ${data.error}: ${data.message ?? 'unknown'}`);
    }

    return data.data.attachment_id;
  }

  async sendUploadedImage(
    userId: string,
    attachmentId: string,
    caption?: string,
  ): Promise<void> {
    const message: Record<string, unknown> = {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'media',
          elements: [{ media_type: 'image', attachment_id: attachmentId }],
        },
      },
    };

    if (caption) {
      message.text = caption;
    }

    await this.sendMessage(userId, message);
  }

  // ── CS messages (no interactive buttons) ─────────────────────────────────
  // Use for text-only questions where user types the answer.

  async sendZbsTemplate(
    userId: string,
    templateId: string,
    templateData: Record<string, string | number>,
  ): Promise<void> {
    if (!this.accessToken) {
      this.logger.debug(
        `[stub/zbs-template] to ${userId}: ${JSON.stringify({ templateId, templateData })}`,
      );
      return;
    }

    this.logger.log(`Sending ZBS template ${templateId} to ${userId}`);
    try {
      const res = await lastValueFrom(
        this.http.post(
          ZALO_ZBS_TEMPLATE_URL,
          {
            user_id: userId,
            template_id: templateId,
            template_data: templateData,
          },
          { headers: { access_token: this.accessToken } },
        ),
      );
      this.logger.log(`ZBS template response: ${JSON.stringify(res.data)}`);

      const data = res.data as { error?: number; message?: string };
      if (data.error !== 0) {
        throw new Error(`ZBS template error ${data.error}: ${data.message ?? 'unknown'}`);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`ZBS template failed for ${userId}: ${msg}`);
      throw error;
    }
  }
  async sendQuickReply(
    userId: string,
    text: string,
    options: QuickReplyOption[],
  ): Promise<void> {
    for (let i = 0; i < options.length; i += 3) {
      const chunk = options.slice(i, i + 3);
      await this.sendMessage(userId, {
        text: i === 0 ? text : 'Hoặc chọn:',
        attachment: {
          type: 'template',
          payload: {
            buttons: chunk.map((opt) => ({
              title: opt.title,
              type: 'oa.query.hide',
              payload: opt.payload,
            })),
          },
        },
      });
    }
  }

  async sendListCard(userId: string, elements: ListElement[]): Promise<void> {
    for (const element of elements) {
      const infoText = element.subtitle
        ? `${element.title}\n${element.subtitle}`
        : element.title;

      if (element.imageUrl) {
        await this.sendMessage(userId, {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'media',
              elements: [{ media_type: 'image', url: element.imageUrl }],
            },
          },
        });
      }

      if (element.buttons?.length) {
        await this.sendMessage(userId, {
          text: infoText,
          attachment: {
            type: 'template',
            payload: {
              buttons: element.buttons.slice(0, 3).map((btn) => ({
                title: btn.title,
                type: btn.type === 'url' ? 'oa.open.url' : 'oa.query.hide',
                payload: btn.type === 'url' ? { url: btn.payload } : btn.payload,
              })),
            },
          },
        });
      } else {
        await this.sendText(userId, infoText);
      }
    }
  }

  // ── Interactive methods ───────────────────────────────────────────────────
  // sendInteractiveQuickReply: CS endpoint + button template.
  // Buttons generate webhook events when sent in proactive context (after follow).
  // For mid-conversation steps, prefer sendNumberedList so users type the answer.

  async sendInteractiveQuickReply(
    userId: string,
    text: string,
    options: QuickReplyOption[],
  ): Promise<void> {
    for (let i = 0; i < options.length; i += 3) {
      const chunk = options.slice(i, i + 3);
      await this.sendMessage(userId, {
        text: i === 0 ? text : 'Hoặc chọn:',
        attachment: {
          type: 'template',
          payload: {
            buttons: chunk.map((opt) => ({
              title: opt.title,
              type: 'oa.query.hide',
              payload: opt.payload,
            })),
          },
        },
      });
    }
  }

  // sendNumberedList: sends options as a numbered text list.
  // Users reply by typing the number or the option name.
  // Always works regardless of conversation context.
  async sendNumberedList(
    userId: string,
    text: string,
    options: { label: string; hint?: string }[],
  ): Promise<void> {
    const lines = [text, ''];
    options.forEach((opt, i) => {
      lines.push(opt.hint ? `${i + 1}. ${opt.label} (${opt.hint})` : `${i + 1}. ${opt.label}`);
    });
    await this.sendText(userId, lines.join('\n'));
  }

  // sendInteractiveListCard: compact tutor card — text info + 2 buttons in 1 message.
  // Zalo CS endpoint only supports plain button attachment (no template_type).
  // Layout per card: name + tier + rating + price | [Xem chi tiết] [Đặt lịch]
  async sendInteractiveListCard(userId: string, elements: ListElement[]): Promise<void> {
    if (elements.length === 0) return;

    for (const element of elements) {
      const cardText = element.subtitle
        ? `${element.title}\n${element.subtitle}`
        : element.title;

      const buttons = (element.buttons ?? []).slice(0, 3).map((btn) => ({
        title: btn.title,
        type: btn.type === 'url' ? 'oa.open.url' : 'oa.query.hide',
        payload: btn.type === 'url' ? { url: btn.payload } : btn.payload,
      }));

      if (buttons.length > 0) {
        await this.sendMessage(userId, {
          text: cardText,
          attachment: {
            type: 'template',
            payload: { buttons: buttons.slice(0, 3) },
          },
        });
      } else {
        await this.sendText(userId, cardText);
      }
    }
  }

  async sendTutorCard(
    userId: string,
    tutor: TutorCandidateDto,
    profileBaseUrl: string,
  ): Promise<void> {
    const cacheKey = `tutor_card_attachment:${tutor.tutorId}`;
    let attachmentId = await this.redis.getClient().get(cacheKey);

    if (!attachmentId) {
      const cardBuffer = await this.tutorCardImage.generate(tutor);
      attachmentId = await this.uploadImageBuffer(cardBuffer, `tutor-${tutor.tutorId}.png`);
      await this.redis.getClient().setex(cacheKey, TUTOR_CARD_ATTACHMENT_TTL, attachmentId);
      this.logger.log(`Tutor card cached: ${tutor.tutorId} → ${attachmentId}`);
    } else {
      this.logger.log(`Tutor card cache hit: ${tutor.tutorId}`);
    }

    await this.sendUploadedImage(userId, attachmentId);

    // Send buttons below
    const profileUrl = `${profileBaseUrl}/${tutor.tutorId}`;
    await this.sendMessage(userId, {
      text: tutor.fullName,
      attachment: {
        type: 'template',
        payload: {
          buttons: [
            {
              title: 'Xem chi tiết',
              type: 'oa.open.url',
              payload: { url: profileUrl },
            },
            {
              title: 'Đặt lịch',
              type: 'oa.query.hide',
              payload: `select_tutor:${tutor.tutorId}`,
            },
          ],
        },
      },
    });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async sendMessage(
    userId: string,
    message: Record<string, unknown>,
  ): Promise<void> {
    await this.callZaloApi(ZALO_CS_URL, userId, message);
  }

  private async sendPromo(
    userId: string,
    message: Record<string, unknown>,
  ): Promise<void> {
    await this.callZaloApi(ZALO_PROMO_URL, userId, message);
  }

  private async callZaloApi(
    url: string,
    userId: string,
    message: Record<string, unknown>,
  ): Promise<void> {
    const endpoint = url === ZALO_PROMO_URL ? 'promotion' : 'cs';

    if (!this.accessToken) {
      this.logger.debug(
        `[stub/${endpoint}] to ${userId}: ${JSON.stringify(message)}`,
      );
      return;
    }

    this.logger.log(`Sending Zalo ${endpoint} message to ${userId}`);
    try {
      const res = await lastValueFrom(
        this.http.post(
          url,
          { recipient: { user_id: userId }, message },
          { headers: { access_token: this.accessToken } },
        ),
      );
      this.logger.log(`Zalo API [${endpoint}] response: ${JSON.stringify(res.data)}`);

      const data = res.data as { error?: number; message?: string };
      if (data.error !== 0) {
        throw new Error(`Zalo API error ${data.error}: ${data.message ?? 'unknown'}`);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Zalo API [${endpoint}] failed for ${userId}: ${msg}`);
      throw error;
    }
  }
}
