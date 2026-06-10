import { Injectable } from '@nestjs/common';

/**
 * Đảm bảo các tác vụ của CÙNG một key (userId) chạy tuần tự, đúng thứ tự đến.
 * Tránh race condition khi nhiều webhook của một user tới gần nhau và cùng
 * đọc/ghi conversation state trong Redis.
 *
 * Dùng cho 1 instance (in-memory). Nếu scale nhiều instance cần khoá phân tán.
 */
@Injectable()
export class UserSerialQueue {
  private readonly chains = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    // Chạy task sau khi tác vụ trước của user này hoàn tất (kể cả nếu nó lỗi).
    const next = prev.then(task, task);

    const tracked: Promise<unknown> = next
      .catch(() => undefined)
      .finally(() => {
        // Dọn map khi không còn tác vụ nào nối tiếp, tránh rò rỉ bộ nhớ.
        if (this.chains.get(key) === tracked) this.chains.delete(key);
      });

    this.chains.set(key, tracked);
    return next;
  }
}
