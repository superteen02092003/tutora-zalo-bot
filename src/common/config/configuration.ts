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
    // true khi agent deploy Cloud Run KHÔNG --allow-unauthenticated — bot tự lấy
    // Google identity token qua metadata server (chỉ hoạt động khi bot cũng chạy trên GCP).
    useIamAuth: process.env.AGENT_USE_IAM_AUTH === 'true',
  },
  // Bật = mọi tin nhắn giai đoạn matching route qua AI agent (thay llm-router + onboarding
  // nút bấm). Tắt = bot chạy y nguyên trạng cũ.
  aiMatching: {
    enabled: process.env.AI_MATCHING_ENABLED === 'true',
  },
  // Zalo Mini App — form tìm gia sư thay chat slot-filling (bước khởi tạo search).
  miniApp: {
    id: process.env.ZALO_MINI_APP_ID,
    linkSecret: process.env.MINI_APP_LINK_SECRET,
    // CHỈ set khi test bản Development chưa Publish (vd "zdev-b12fe263") — thêm
    // &env=DEVELOPMENT&version=... vào deep link. XOÁ biến này (không set) khi
    // Mini App đã có bản Publish chính thức, để dùng link production bình thường.
    devVersion: process.env.ZALO_MINI_APP_DEV_VERSION,
  },
  zbs: {
    paymentTemplateId: process.env.ZBS_PAYMENT_TEMPLATE_ID,
  },
  tutorProfileBaseUrl: process.env.TUTOR_PROFILE_BASE_URL ?? 'https://tutora.vn/gia-su',
  appPublicUrl: process.env.APP_PUBLIC_URL ?? '',
  stubMode: process.env.STUB_MODE === 'true',
  adminZaloUserIds: (process.env.ADMIN_ZALO_USER_IDS ?? '').split(',').filter(Boolean),
});
