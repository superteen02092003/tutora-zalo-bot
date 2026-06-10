import { Injectable, Logger } from '@nestjs/common';
import { SubjectDto } from './dto';
import { BeClientService } from './be-client.service';

const TTL_MS = 30 * 60 * 1000;

@Injectable()
export class SubjectCacheService {
  private readonly logger = new Logger(SubjectCacheService.name);
  private cache: SubjectDto[] = [];
  private fetchedAt = 0;

  constructor(private readonly beClient: BeClientService) {}

  async getSubjects(): Promise<SubjectDto[]> {
    if (this.cache.length && Date.now() - this.fetchedAt < TTL_MS) {
      return this.cache;
    }
    try {
      this.cache = await this.beClient.getSubjects();
      this.fetchedAt = Date.now();
    } catch (err) {
      this.logger.warn(`Failed to refresh subjects cache: ${String(err)}`);
    }
    return this.cache;
  }

  async getNames(): Promise<string[]> {
    const subjects = await this.getSubjects();
    return subjects.map((s) => s.name);
  }

  async normalize(input: string): Promise<SubjectDto | undefined> {
    const subjects = await this.getSubjects();
    const norm = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/đ/g, 'd')
        .trim();

    const n = norm(input);

    return (
      subjects.find((s) => norm(s.name) === n) ??
      subjects.find((s) => norm(s.name).includes(n)) ??
      subjects.find((s) => n.includes(norm(s.name).split(' ')[0]))
    );
  }
}
