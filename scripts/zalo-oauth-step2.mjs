// BƯỚC 2/2 — Đổi authorization code lấy access_token + refresh_token, ghi vào .env.
// Cách dùng:
//   node scripts/zalo-oauth-step2.mjs <APP_ID> <APP_SECRET> <CODE>
//
// <CODE> là giá trị lấy được sau khi đồng ý cấp quyền ở BƯỚC 1.

import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
const pkcePath = join(__dirname, '.zalo-pkce.tmp');

const [appId, appSecret, code] = process.argv.slice(2);
if (!appId || !appSecret || !code) {
  console.error('❌ Thiếu tham số.\n   Cách dùng: node scripts/zalo-oauth-step2.mjs <APP_ID> <APP_SECRET> <CODE>');
  process.exit(1);
}

let codeVerifier;
try {
  ({ codeVerifier } = JSON.parse(await readFile(pkcePath, 'utf8')));
} catch {
  console.error('❌ Không đọc được scripts/.zalo-pkce.tmp — hãy chạy lại BƯỚC 1 trước.');
  process.exit(1);
}

console.log('→ Đang đổi code lấy token...');

const res = await fetch('https://oauth.zaloapp.com/v4/oa/access_token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    secret_key: appSecret,
  },
  body: new URLSearchParams({
    code,
    app_id: appId,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  }),
});

const data = await res.json();

if (!data.access_token) {
  console.error('❌ Đổi token thất bại. Phản hồi từ Zalo:');
  console.error(JSON.stringify(data, null, 2));
  console.error('\nGợi ý: code chỉ dùng được 1 lần và hết hạn nhanh — nếu lỗi, chạy lại BƯỚC 1 để lấy code mới.');
  process.exit(1);
}

const envRaw = await readFile(envPath, 'utf8');
const updated = envRaw
  .replace(/^ZALO_OA_ACCESS_TOKEN=.*$/m, `ZALO_OA_ACCESS_TOKEN=${data.access_token}`)
  .replace(/^ZALO_OA_REFRESH_TOKEN=.*$/m, `ZALO_OA_REFRESH_TOKEN=${data.refresh_token}`);
await writeFile(envPath, updated, 'utf8');
await unlink(pkcePath).catch(() => {});

console.log('✅ Đã cập nhật .env với token mới.');
console.log(`   access_token:  ${data.access_token.slice(0, 12)}... (hết hạn sau ${data.expires_in}s ≈ ${Math.round(Number(data.expires_in) / 3600)}h)`);
console.log(`   refresh_token: ${data.refresh_token.slice(0, 12)}... (sống ~3 tháng)`);
console.log('\n⚠️  RESTART bot (Ctrl+C ở Terminal 1 rồi npm run start:dev) để nạp token mới.');
