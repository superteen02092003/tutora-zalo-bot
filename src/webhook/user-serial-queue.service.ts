import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RedisService } from '../common/redis/redis.service';

// Đủ dài cho 1 lượt xử lý thật (agent call ~10-17s + gửi Zalo) + biên an toàn.
const LOCK_TTL_MS = 30_000;
const RETRY_DELAY_MS = 150;
// Chờ tối đa — tránh treo vô hạn nếu lock bị kẹt (vd instance giữ lock crash giữa chừng).
const MAX_WAIT_MS = 60_000;

const RELEASE_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

/**
 * Đảm bảo các tác vụ của CÙNG một key (userId) chạy tuần tự, đúng thứ tự đến —
 * qua KHÓA PHÂN TÁN Redis, hoạt động đúng dù Cloud Run chạy nhiều instance song song.
 *
 * Bug thật đã gặp (2026-07-11): bản cũ dùng in-memory Map (chỉ đúng khi ĐÚNG 1 instance).
 * Cloud Run mặc định tự scale nhiều instance khi có request đồng thời (user test dồn dập,
 * mỗi lượt Gemini xử lý ~10-17s đủ để user gửi tin tiếp theo trước khi lượt trước xong) —
 * 2 instance có 2 Map riêng biệt, KHÔNG biết về nhau → xử lý song song, trả lời sai thứ tự
 * (reply của tin nhắn cũ gửi ra SAU tin nhắn mới, đè lên nhau trong conversation).
 */
@Injectable()
export class UserSerialQueue {
  private readonly logger = new Logger(UserSerialQueue.name);

  constructor(private readonly redisService: RedisService) {}

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const lockKey = `lock:serial:${key}`;
    const token = randomUUID();
    const client = this.redisService.getClient();
    const deadline = Date.now() + MAX_WAIT_MS;
    let waited = 0;

    while (true) {
      const acquired = await client.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX');
      if (acquired === 'OK') break;
      waited += RETRY_DELAY_MS;
      if (Date.now() > deadline) {
        // Fallback: chạy luôn thay vì treo vô hạn — hiếm khi xảy ra (chỉ khi lock kẹt
        // bất thường), chấp nhận rủi ro race hiếm còn hơn làm rớt webhook hoàn toàn.
        this.logger.warn(`Hết thời gian chờ lock cho key=${key} — chạy task KHÔNG có khoá.`);
        break;
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
    // ⚠️ DEBUG TẠM THỜI — xác nhận lock có thực sự chặn/chờ khi có request chồng chéo.
    this.logger.debug(`[LOCK] key=${key} token=${token} acquired sau ${waited}ms chờ`);

    try {
      return await task();
    } finally {
      this.logger.debug(`[LOCK] key=${key} token=${token} release`);
      // Chỉ xoá lock nếu vẫn là của CHÍNH lượt này (tránh xoá nhầm lock của request khác
      // nếu TTL đã hết hạn và request sau đã kịp acquire lock mới).
      try {
        await client.eval(RELEASE_SCRIPT, 1, lockKey, token);
      } catch (error) {
        this.logger.warn(`Không release được lock key=${key}: ${String(error)}`);
      }
    }
  }
}
