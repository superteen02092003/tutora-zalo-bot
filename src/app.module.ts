import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BeClientModule } from './be-client/be-client.module';
import { ConversationStateModule } from './bot/state/conversation-state.module';
import configuration from './common/config/configuration';
import { WebhookModule } from './webhook/webhook.module';
import { ZaloModule } from './zalo/zalo.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: Joi.object({
        ZALO_OA_ACCESS_TOKEN: Joi.string().allow('').optional(),
        ZALO_APP_ID: Joi.string().allow('').optional(),
        ZALO_APP_SECRET: Joi.string().allow('').optional(),
        ZALO_WEBHOOK_SECRET: Joi.string().allow('').optional(),
        BE_INTERNAL_BASE_URL: Joi.string()
          .uri()
          .default('https://api.tutora.vn'),
        BE_INTERNAL_API_KEY: Joi.string().allow('').optional(),
        BE_EVENT_SECRET: Joi.string().allow('').optional(),
        REDIS_URL: Joi.string().uri().default('redis://localhost:6379'),
        ZBS_PAYMENT_TEMPLATE_ID: Joi.string().allow('').optional(),
        APP_PUBLIC_URL: Joi.string().uri().allow('').optional(),
        STUB_MODE: Joi.boolean().truthy('true').falsy('false').default(true),
        PORT: Joi.number().port().default(3000),
        AGENT_BASE_URL: Joi.string().uri().default('http://localhost:8000'),
        AGENT_API_KEY: Joi.string().allow('').optional(),
        AGENT_USE_IAM_AUTH: Joi.boolean()
          .truthy('true')
          .falsy('false')
          .default(false),
        ZALO_MINI_APP_ID: Joi.string().allow('').optional(),
        MINI_APP_LINK_SECRET: Joi.string().allow('').optional(),
        ZALO_MINI_APP_DEV_VERSION: Joi.string().allow('').optional(),
      }),
    }),
    BeClientModule,
    ConversationStateModule,
    WebhookModule,
    ZaloModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
