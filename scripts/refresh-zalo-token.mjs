// Đổi Zalo OA access token bằng refresh token.
// Cách dùng:
//   node scripts/refresh-zalo-token.mjs <APP_ID> <APP_SECRET>
//
// Script sẽ:
//   1. Đọc ZALO_OA_REFRESH_TOKEN từ .env
//   2. Gọi Zalo OAuth v4 để lấy access_token + refresh_token MỚI
//   3. Ghi đè lại 2 giá trị đó vào .env (refresh token của Zalo xoay vòng, dùng 1 lần)
//
// Lưu ý: sau khi chạy xong, RESTART bot để nạp token mới.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');

const [appId, appSecret] = process.argv.slice(2);
if (!appId || !appSecret) {
  console.error('❌ Thiếu tham số.\n   Cách dùng: node scripts/refresh-zalo-token.mjs <APP_ID> <APP_SECRET>');
  process.exit(1);
}

const envRaw = await readFile(envPath, 'utf8');
const match = envRaw.match(/^ZALO_OA_REFRESH_TOKEN=(.*)$/m);
const refreshToken = match?.[1]?.trim();
if (!refreshToken) {
  console.error('❌ Không tìm thấy ZALO_OA_REFRESH_TOKEN trong .env');
  process.exit(1);
}

console.log('→ Đang gọi Zalo OAuth để đổi token...');

const res = await fetch('https://oauth.zaloapp.com/v4/oa/access_token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    secret_key: appSecret,
  },
  body: new URLSearchParams({
    refresh_token: refreshToken,
    app_id: appId,
    grant_type: 'refresh_token',
  }),
});

const data = await res.json();

if (!data.access_token) {
  console.error('❌ Đổi token thất bại. Phản hồi từ Zalo:');
  console.error(JSON.stringify(data, null, 2));
  console.error('\nGợi ý: nếu lỗi -124/-14001 → App Secret sai. Nếu refresh token hết hạn (>3 tháng) → phải xin lại quyền OA qua OAuth.');
  process.exit(1);
}

let updated = envRaw
  .replace(/^ZALO_OA_ACCESS_TOKEN=.*$/m, `ZALO_OA_ACCESS_TOKEN=${data.access_token}`)
  .replace(/^ZALO_OA_REFRESH_TOKEN=.*$/m, `ZALO_OA_REFRESH_TOKEN=${data.refresh_token}`);

await writeFile(envPath, updated, 'utf8');

console.log('✅ Đã cập nhật .env với token mới.');
console.log(`   access_token:  ${data.access_token.slice(0, 12)}... (hết hạn sau ${data.expires_in}s ≈ ${Math.round(Number(data.expires_in) / 3600)}h)`);
console.log(`   refresh_token: ${data.refresh_token.slice(0, 12)}... (đã xoay vòng)`);
console.log('\n⚠️  RESTART bot (Ctrl+C ở Terminal 1 rồi npm run start:dev) để nạp token mới.');
