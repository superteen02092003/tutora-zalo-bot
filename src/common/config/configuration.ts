export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  zalo: {
    accessToken: process.env.ZALO_OA_ACCESS_TOKEN,
    refreshToken: process.env.ZALO_OA_REFRESH_TOKEN,
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
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
    model: process.env.DEEPSEEK_MODEL,
  },
  // FastAPI AI agent (tutora-ai) — bộ não hội thoại AI matching.
  agent: {
    baseUrl: process.env.AGENT_BASE_URL ?? 'http://localhost:8000',
    apiKey: process.env.AGENT_API_KEY,
  },
  // Bật = mọi tin nhắn giai đoạn matching route qua AI agent (thay llm-router + onboarding
  // nút bấm). Tắt = bot chạy y nguyên trạng cũ.
  aiMatching: {
    enabled: process.env.AI_MATCHING_ENABLED === 'true',
  },
  zbs: {
    paymentTemplateId: process.env.ZBS_PAYMENT_TEMPLATE_ID,
  },
  tutorProfileBaseUrl: process.env.TUTOR_PROFILE_BASE_URL ?? 'https://tutora.vn/gia-su',
  appPublicUrl: process.env.APP_PUBLIC_URL ?? '',
  stubMode: process.env.STUB_MODE === 'true',
  adminZaloUserIds: (process.env.ADMIN_ZALO_USER_IDS ?? '').split(',').filter(Boolean),
});
