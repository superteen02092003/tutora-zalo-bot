-- Lịch sử chat OA đầy đủ 2 chiều (khách nhắn vào + OA gửi ra, gồm cả tin nhân viên trả lời
-- tay trên trang quản lý OA) — nguồn dữ liệu cho agent phân tích sau này.
-- Chạy 1 lần trong Supabase SQL editor. Chỉ TẠO bảng mới, không đụng dữ liệu có sẵn.

create table if not exists public.zalo_chat_messages (
  id            bigserial primary key,
  -- message.msg_id của Zalo; unique để webhook bị Zalo gửi lại không tạo bản ghi trùng.
  msg_id        text unique,
  -- Luôn là ID của KHÁCH (theo OA), kể cả tin OA gửi ra (lấy từ recipient.id).
  zalo_user_id  text not null,
  direction     text not null check (direction in ('in', 'out')),
  event_name    text not null,
  text          text,
  attachments   jsonb,
  -- Nguyên payload webhook, giữ lại cho các loại tin chưa tách field riêng.
  raw           jsonb not null,
  -- Thời điểm Zalo ghi nhận tin (field timestamp của webhook).
  sent_at       timestamptz not null,
  created_at    timestamptz not null default now()
);

create index if not exists zalo_chat_messages_user_sent_at_idx
  on public.zalo_chat_messages (zalo_user_id, sent_at);

-- Chứa nội dung chat của khách: bật RLS và KHÔNG tạo policy nào, để anon/authenticated
-- (Supabase REST) không đọc được. Bot ghi bằng role postgres nên không bị chặn.
alter table public.zalo_chat_messages enable row level security;
