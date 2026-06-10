// BƯỚC 1/2 — Tạo link xin quyền OA (PKCE).
// Cách dùng:
//   node scripts/zalo-oauth-step1.mjs <APP_ID> <REDIRECT_URI>
//
// <REDIRECT_URI> PHẢI là một callback URL đã đăng ký trong app Zalo
// (Zalo Developer Console → app → Official Account → Cấu hình callback URL).
// Ví dụ: https://bot.tutora.vn/zalo/callback  hoặc  https://tutora.vn
//
// Script sẽ tạo code_verifier (lưu vào .zalo-pkce.tmp) và in ra link xin quyền.
// Mở link đó bằng tài khoản ADMIN của OA, đồng ý cấp quyền,
// rồi copy giá trị `code` trên thanh địa chỉ sau khi bị redirect.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

const [appId, redirectUri] = process.argv.slice(2);
if (!appId || !redirectUri) {
  console.error('❌ Thiếu tham số.\n   Cách dùng: node scripts/zalo-oauth-step1.mjs <APP_ID> <REDIRECT_URI>');
  process.exit(1);
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const codeVerifier = b64url(randomBytes(32));
const codeChallenge = b64url(createHash('sha256').update(codeVerifier).digest());
const state = b64url(randomBytes(8));

await writeFile(join(__dirname, '.zalo-pkce.tmp'), JSON.stringify({ codeVerifier, redirectUri }), 'utf8');

const url =
  `https://oauth.zaloapp.com/v4/oa/permission?app_id=${encodeURIComponent(appId)}` +
  `&redirect_uri=${encodeURIComponent(redirectUri)}` +
  `&code_challenge=${codeChallenge}` +
  `&state=${state}`;

console.log('✅ Đã tạo code_verifier (lưu ở scripts/.zalo-pkce.tmp).\n');
console.log('👉 Mở link sau bằng tài khoản ADMIN của OA, bấm "Cho phép":\n');
console.log(url);
console.log('\nSau khi đồng ý, trình duyệt sẽ redirect tới REDIRECT_URI kèm ?code=XXXX&...');
console.log('Copy phần giá trị `code` (chuỗi dài), rồi chạy BƯỚC 2:');
console.log('   node scripts/zalo-oauth-step2.mjs <APP_ID> <APP_SECRET> <CODE>');
