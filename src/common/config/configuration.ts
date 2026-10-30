export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  zalo: {
    accessToken: process.env.ZALO_OA_ACCESS_TOKEN,
    appId: process.env.ZALO_APP_ID,
    appSecret: process.env.ZALO_APP_SECRET,
    webhookSecret: process.env.ZALO_WEBHOOK_SECRET,
    siteVerification: process.env.ZALO_SITE_VERIFICATION,
  },
  backend: {
    baseUrl: process.env.BE_INTERNAL_BASE_URL,
    apiKey: process.env.BE_INTERNAL_API_KEY,
    eventSecret: process.env.BE_EVENT_SECRET,
  },
  redis: {
    url: process.env.REDIS_URL,
  },
  // Supabase Postgres — lưu lịch sử chat OA 2 chiều (bảng zalo_chat_messages).
  database: {
    url: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL !== 'false',
  },
  zbs: {
    paymentTemplateId: process.env.ZBS_PAYMENT_TEMPLATE_ID,
  },
  appPublicUrl: process.env.APP_PUBLIC_URL ?? '',
  stubMode: process.env.STUB_MODE === 'true',
  adminZaloUserIds: (process.env.ADMIN_ZALO_USER_IDS ?? '')
    .split(',')
    .filter(Boolean),
});
