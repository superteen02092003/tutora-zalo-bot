export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  zalo: {
    accessToken: process.env.ZALO_OA_ACCESS_TOKEN,
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
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
    model: process.env.DEEPSEEK_MODEL,
  },
  zbs: {
    paymentTemplateId: process.env.ZBS_PAYMENT_TEMPLATE_ID,
  },
  tutorProfileBaseUrl: process.env.TUTOR_PROFILE_BASE_URL ?? 'https://tutora.vn/gia-su',
  appPublicUrl: process.env.APP_PUBLIC_URL ?? '',
  stubMode: process.env.STUB_MODE === 'true',
  adminZaloUserIds: (process.env.ADMIN_ZALO_USER_IDS ?? '').split(',').filter(Boolean),
});
