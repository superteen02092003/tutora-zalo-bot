import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ConversationContext } from '../bot/state/conversation-context.interface';
import { ParsedIntent, ParsedSchedule } from './llm.types';

@Injectable()
export class DeepSeekService {
  private readonly logger = new Logger(DeepSeekService.name);
  private readonly client?: OpenAI;
  private readonly model: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('deepseek.apiKey');
    const baseURL = config.get<string>('deepseek.baseUrl');
    this.model = config.get<string>('deepseek.model', 'deepseek-v4-flash');

    if (apiKey && baseURL) {
      this.client = new OpenAI({ apiKey, baseURL });
    }
  }

  async parseIntent(
    message: string,
    context: ConversationContext,
  ): Promise<ParsedIntent> {
    if (!this.client) {
      return { intent: 'unknown', confidence: 0, entities: {} };
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Ban la assistant phan tich intent cua phu huynh trong ung dung tim gia su Tutora. Tra ve JSON: { "intent": string, "confidence": number, "entities": object }. Cac intent: book_tutor, reschedule, cancel, check_status, general_question, unknown.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            message,
            context,
          }),
        },
      ],
    });

    return this.parseIntentResponse(response.choices[0]?.message.content);
  }

  async generateFallbackReply(
    message: string,
    context: ConversationContext,
  ): Promise<string> {
    if (!this.client) {
      return 'Mình chưa hiểu rõ ý bạn. Bạn muốn tìm gia sư, đổi lịch, hay kiểm tra lịch học?';
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content:
            'Bạn là trợ lý Zalo của Tutora. Luôn trả lời ngắn gọn, thân thiện, tự nhiên bằng tiếng Việt có dấu. Ưu tiên giúp phụ huynh tìm gia sư, đặt lịch, đổi lịch, hoặc kiểm tra lịch học.',
        },
        {
          role: 'user',
          content: JSON.stringify({ message, context }),
        },
      ],
    });

    return (
      response.choices[0]?.message.content ??
      'Mình chưa hiểu rõ ý bạn. Bạn muốn tìm gia sư hay xem lịch học?'
    );
  }

  async parseSchedule(
    message: string,
    requirement: { sessionsPerWeek: number; durationHours: number },
  ): Promise<ParsedSchedule | null> {
    if (!this.client) {
      return null;
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        response_format: { type: 'json_object' },
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'Ban la bo parser lich hoc tieng Viet cho Tutora. Tra ve dung JSON {"sessions":[{"dayOfWeek":number,"startHour":number,"endHour":number}]}. Quy uoc dayOfWeek: Thu 2=1, Thu 3=2, Thu 4=3, Thu 5=4, Thu 6=5, Thu 7=6, Chu nhat=7. Chi trich xuat thong tin user noi, khong tu them buoi. Gio dung so nguyen 0-24. Neu khong ro, tra {"sessions":[]}.',
          },
          {
            role: 'user',
            content: JSON.stringify({ message, requirement }),
          },
        ],
      });

      return this.parseScheduleResponse(response.choices[0]?.message.content);
    } catch (error) {
      this.logger.warn(`DeepSeek schedule parser error: ${String(error)}`);
      return null;
    }
  }

  private parseIntentResponse(content?: string | null): ParsedIntent {
    if (!content) {
      return { intent: 'unknown', confidence: 0, entities: {} };
    }

    try {
      const parsed = JSON.parse(content) as ParsedIntent;
      return {
        intent: parsed.intent ?? 'unknown',
        confidence: parsed.confidence ?? 0,
        entities: parsed.entities ?? {},
      };
    } catch (error) {
      this.logger.warn(
        `Could not parse DeepSeek intent response: ${String(error)}`,
      );
      return { intent: 'unknown', confidence: 0, entities: {} };
    }
  }

  private parseScheduleResponse(content?: string | null): ParsedSchedule | null {
    if (!content) {
      return null;
    }

    try {
      const parsed = JSON.parse(content) as ParsedSchedule;
      if (!Array.isArray(parsed.sessions)) {
        return null;
      }

      return {
        sessions: parsed.sessions
          .map((session) => ({
            dayOfWeek: Number(session.dayOfWeek),
            startHour: Number(session.startHour),
            endHour: Number(session.endHour),
          }))
          .filter(
            (session) =>
              Number.isInteger(session.dayOfWeek) &&
              Number.isInteger(session.startHour) &&
              Number.isInteger(session.endHour),
          ),
      };
    } catch (error) {
      this.logger.warn(
        `Could not parse DeepSeek schedule response: ${String(error)}`,
      );
      return null;
    }
  }
}
