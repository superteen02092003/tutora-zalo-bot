import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);
  const port = config.get<number>('port', 3000);

  // Mini App (TutorSearch wizard) gọi trực tiếp từ trình duyệt/webview Zalo tới
  // /webhook/miniapp-search* — bug thật phát hiện 2026-07-13: app chưa bao giờ bật CORS
  // (chỉ thiết kế cho webhook server-to-server ban đầu), nên MỌI request POST từ Mini App
  // bị chặn ngay ở bước preflight OPTIONS (404, không route nào xử lý) — submit "Tìm gia
  // sư" không bao giờ tới được server dù test qua curl (không bị CORS) vẫn "thành công".
  app.enableCors({
    origin: [
      'https://h5.zalo.me',
      'https://h5.zadn.vn',
      'https://h5.zdn.vn',
      'https://miniapp-cdn.zalo.me',
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  });

  await app.listen(port);
}
bootstrap();
