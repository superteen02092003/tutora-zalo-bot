import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BeClientModule } from './be-client/be-client.module';
import { ConversationStateModule } from './bot/state/conversation-state.module';
import configuration from './common/config/configuration';
import { LlmModule } from './llm/llm.module';
import { WebhookModule } from './webhook/webhook.module';
import { ZaloModule } from './zalo/zalo.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: Joi.object({
        ZALO_OA_ACCESS_TOKEN: Joi.string().allow('').optional(),
        ZALO_WEBHOOK_SECRET: Joi.string().allow('').optional(),
        BE_INTERNAL_BASE_URL: Joi.string()
          .uri()
          .default('https://api.tutora.vn'),
        BE_INTERNAL_API_KEY: Joi.string().allow('').optional(),
        BE_EVENT_SECRET: Joi.string().allow('').optional(),
        REDIS_URL: Joi.string().uri().default('redis://localhost:6379'),
        DEEPSEEK_API_KEY: Joi.string().allow('').optional(),
        DEEPSEEK_BASE_URL: Joi.string()
          .uri()
          .default('https://api.deepseek.com'),
        DEEPSEEK_MODEL: Joi.string().default('deepseek-v4-flash'),
        ZBS_PAYMENT_TEMPLATE_ID: Joi.string().allow('').optional(),
        APP_PUBLIC_URL: Joi.string().uri().allow('').optional(),
        STUB_MODE: Joi.boolean().truthy('true').falsy('false').default(true),
        PORT: Joi.number().port().default(3000),
      }),
    }),
    BeClientModule,
    ConversationStateModule,
    LlmModule,
    WebhookModule,
    ZaloModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
