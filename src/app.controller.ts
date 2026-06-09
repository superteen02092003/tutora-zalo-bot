import { Controller, Get, Header } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  getHome(): string {
    const verification = this.config.get<string>('zalo.siteVerification', '');
    const metaTag = verification
      ? `<meta name="zalo-platform-site-verification" content="${verification}" />`
      : '';
    return `<!DOCTYPE html>
<html>
<head>
${metaTag}
<title>Tutora Zalo Bot</title>
</head>
<body>${this.appService.getHello()}</body>
</html>`;
  }
}
