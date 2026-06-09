import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { join } from 'path';
import { TutorCandidateDto } from '../be-client/dto';

const W = 700;
const H = 200;
const PAD = 20;
const AVATAR_SIZE = 120;
const AVATAR_X = PAD + AVATAR_SIZE / 2;
const AVATAR_Y = H / 2;
const INFO_X = PAD + AVATAR_SIZE + PAD * 2;
const INFO_W = W - INFO_X - PAD;
const FONT = 'Noto Sans';

const COLOR = {
  bg: '#FFFFFF',
  accent: '#1565C0',
  accentLight: '#E3F2FD',
  name: '#1A1A2E',
  label: '#455A64',
  muted: '#90A4AE',
  star: '#FFC107',
  badge: '#E3F2FD',
  badgeText: '#1565C0',
  border: '#E0E0E0',
};

const FONTS_DIR = join(process.cwd(), 'assets', 'fonts');

@Injectable()
export class TutorCardImageService implements OnModuleInit {
  private readonly logger = new Logger(TutorCardImageService.name);

  async onModuleInit(): Promise<void> {
    try {
      const { GlobalFonts } = await import('@napi-rs/canvas');
      GlobalFonts.registerFromPath(join(FONTS_DIR, 'NotoSans-Regular.ttf'), FONT);
      GlobalFonts.registerFromPath(join(FONTS_DIR, 'NotoSans-Bold.ttf'), FONT);
      this.logger.log(`Fonts registered: ${FONT}`);
    } catch (err) {
      this.logger.warn(`Font registration failed, falling back to system fonts: ${err}`);
    }
  }

  async generate(tutor: TutorCandidateDto): Promise<Buffer> {
    const { createCanvas, loadImage } = await import('@napi-rs/canvas');
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // ── Background ────────────────────────────────────────────────────────────
    ctx.fillStyle = COLOR.bg;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = COLOR.accent;
    ctx.fillRect(0, 0, W, 5);

    ctx.strokeStyle = COLOR.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    // ── Avatar ────────────────────────────────────────────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.arc(AVATAR_X, AVATAR_Y, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    if (tutor.avatarUrl) {
      try {
        const img = await loadImage(tutor.avatarUrl);
        ctx.drawImage(img, AVATAR_X - AVATAR_SIZE / 2, AVATAR_Y - AVATAR_SIZE / 2, AVATAR_SIZE, AVATAR_SIZE);
      } catch {
        ctx.fillStyle = COLOR.accentLight;
        ctx.fillRect(AVATAR_X - AVATAR_SIZE / 2, AVATAR_Y - AVATAR_SIZE / 2, AVATAR_SIZE, AVATAR_SIZE);
      }
    } else {
      ctx.fillStyle = COLOR.accentLight;
      ctx.fillRect(AVATAR_X - AVATAR_SIZE / 2, AVATAR_Y - AVATAR_SIZE / 2, AVATAR_SIZE, AVATAR_SIZE);
    }

    ctx.restore();

    // Avatar border ring
    ctx.beginPath();
    ctx.arc(AVATAR_X, AVATAR_Y, AVATAR_SIZE / 2 + 2, 0, Math.PI * 2);
    ctx.strokeStyle = COLOR.accent;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Gender badge
    const genderLabel = tutor.gender === 'male' ? 'Nam' : tutor.gender === 'female' ? 'Nữ' : '';
    if (genderLabel) {
      const bx = AVATAR_X + 36;
      const by = AVATAR_Y + 38;
      ctx.beginPath();
      ctx.arc(bx, by, 16, 0, Math.PI * 2);
      ctx.fillStyle = COLOR.accent;
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold 11px "${FONT}", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(genderLabel, bx, by);
    }

    // ── Info section ──────────────────────────────────────────────────────────
    let y = PAD + 18;

    // Name
    ctx.fillStyle = COLOR.name;
    ctx.font = `bold 19px "${FONT}", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(tutor.fullName, INFO_X, y);
    y += 26;

    // Subject & grade badges
    const tags = [
      ...(tutor.subjects ?? []),
      tutor.grades?.length
        ? `Lớp ${tutor.grades[0]}${tutor.grades.length > 1 ? '-' + tutor.grades[tutor.grades.length - 1] : ''}`
        : null,
    ].filter(Boolean) as string[];

    let bx = INFO_X;
    for (const tag of tags.slice(0, 4)) {
      ctx.font = `bold 11px "${FONT}", sans-serif`;
      const tw = ctx.measureText(tag).width + 14;
      ctx.fillStyle = COLOR.badge;
      roundRect(ctx, bx, y, tw, 20, 4);
      ctx.fill();
      ctx.fillStyle = COLOR.badgeText;
      ctx.textBaseline = 'middle';
      ctx.fillText(tag, bx + 7, y + 10);
      bx += tw + 6;
    }
    y += 28;

    // Rating + hours
    ctx.fillStyle = COLOR.star;
    ctx.font = `bold 13px "${FONT}", sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText('★', INFO_X, y);
    ctx.fillStyle = COLOR.label;
    ctx.font = `13px "${FONT}", sans-serif`;
    ctx.fillText(
      ` ${tutor.averageRating.toFixed(1)}/5  (${tutor.totalReviews} đánh giá)  ·  ${tutor.completedHours} giờ dạy`,
      INFO_X + 14,
      y,
    );
    y += 20;

    // Price + teaching mode
    ctx.fillStyle = COLOR.accent;
    ctx.font = `bold 14px "${FONT}", sans-serif`;
    ctx.fillText(`${tutor.hourlyRate.toLocaleString('vi-VN')}đ/giờ`, INFO_X, y);

    const modeLabel =
      tutor.teachingMode === 'online'
        ? 'Online'
        : tutor.teachingMode === 'offline'
          ? 'Offline'
          : 'Online & Offline';
    ctx.fillStyle = COLOR.label;
    ctx.font = `13px "${FONT}", sans-serif`;
    const priceW = ctx.measureText(`${tutor.hourlyRate.toLocaleString('vi-VN')}đ/giờ`).width;
    ctx.fillText(`  ·  ${modeLabel}`, INFO_X + priceW, y);
    y += 22;

    // Bio (1 line, truncated)
    if (tutor.bio) {
      ctx.fillStyle = COLOR.muted;
      ctx.font = `12px "${FONT}", sans-serif`;
      let bio = tutor.bio;
      while (bio.length > 0 && ctx.measureText(bio + '...').width > INFO_W) {
        bio = bio.slice(0, -1);
      }
      if (bio.length < tutor.bio.length) bio += '...';
      ctx.fillText(bio, INFO_X, y);
    }

    // Subscription tier badge (top-right)
    const tierLabel: Record<string, string> = { premium: 'PREMIUM', pro: 'PRO', standard: 'STD' };
    const tierColor: Record<string, string> = { premium: '#FF6F00', pro: '#1565C0', standard: '#546E7A' };
    const tier = tutor.subscriptionType;
    if (tier && tierLabel[tier]) {
      ctx.font = `bold 10px "${FONT}", sans-serif`;
      const tw = ctx.measureText(tierLabel[tier]).width + 12;
      ctx.fillStyle = tierColor[tier] ?? COLOR.accent;
      roundRect(ctx, W - PAD - tw, PAD, tw, 18, 4);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tierLabel[tier], W - PAD - tw / 2, PAD + 9);
    }

    return canvas.encode('png');
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

type CanvasRenderingContext2D = ReturnType<
  ReturnType<typeof import('@napi-rs/canvas').createCanvas>['getContext']
>;
