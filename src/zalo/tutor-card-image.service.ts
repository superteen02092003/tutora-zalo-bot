import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { join } from 'path';
import { TutorCandidateDto } from '../be-client/dto';

// ── Canvas ────────────────────────────────────────────────────────────────
const W = 720;
const H = 440;
const W_L = 284;        // left (navy) panel width
const CARD_R = 24;

// ── Left panel ────────────────────────────────────────────────────────────
const PAD_L = 20;
const AV_CX = W_L / 2; // 142
const AV_CY = 170;
const AV_R = 54;

// ── Right panel ───────────────────────────────────────────────────────────
const RP_X = W_L + 28;           // 312
const RP_W = W - W_L - 28 - 20; // 388

// ── Brand fonts ───────────────────────────────────────────────────────────
const SANS = 'Noto Sans';
const DISPLAY_DEFAULT = 'Bricolage Grotesque';

// ── Brand palette ─────────────────────────────────────────────────────────
const C = {
  cream: '#faf9f6',
  navy: '#1a2238',
  gold: '#d4b483',
  green: '#3d4a3e',
  brown70: 'rgba(62, 47, 40, 0.7)',
  brown45: 'rgba(62, 47, 40, 0.45)',
  line: 'rgba(62, 47, 40, 0.10)',
  priceBg: 'rgba(26, 34, 56, 0.05)',
  creamOnNavy: 'rgba(255, 255, 255, 0.72)',
  whiteFaint: 'rgba(255, 255, 255, 0.08)',
  whiteBorder: 'rgba(255, 255, 255, 0.18)',
};

const FONTS_DIR = join(process.cwd(), 'assets', 'fonts');

@Injectable()
export class TutorCardImageService implements OnModuleInit {
  private readonly logger = new Logger(TutorCardImageService.name);
  private displayFamily = DISPLAY_DEFAULT;

  async onModuleInit(): Promise<void> {
    try {
      const { GlobalFonts } = await import('@napi-rs/canvas');
      const reg = (file: string, family: string) =>
        GlobalFonts.registerFromPath(join(FONTS_DIR, file), family);
      const okSans = reg('NotoSans-Regular.ttf', SANS) && reg('NotoSans-Bold.ttf', SANS);
      const okDisplay = reg('BricolageGrotesque.ttf', DISPLAY_DEFAULT);
      if (!okDisplay) this.displayFamily = SANS;
      this.logger.log(
        `Fonts registered — sans(${SANS})=${okSans} display(${this.displayFamily})=${okDisplay}`,
      );
    } catch (err) {
      this.displayFamily = SANS;
      this.logger.warn(`Font registration failed: ${err}`);
    }
  }

  async generate(tutor: TutorCandidateDto): Promise<Buffer> {
    const { createCanvas, loadImage } = await import('@napi-rs/canvas');
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // ── Clip to card rounded rect ─────────────────────────────────────────
    ctx.save();
    roundRectPath(ctx, 0, 0, W, H, CARD_R);
    ctx.clip();

    // ── Panels ────────────────────────────────────────────────────────────
    ctx.fillStyle = C.navy;
    ctx.fillRect(0, 0, W_L, H);
    ctx.fillStyle = C.cream;
    ctx.fillRect(W_L, 0, W - W_L, H);

    // ── LEFT PANEL ────────────────────────────────────────────────────────

    // TUTORA badge (top-left)
    this.drawTutoraBadge(ctx, PAD_L, PAD_L);

    // Avatar
    ctx.save();
    ctx.beginPath();
    ctx.arc(AV_CX, AV_CY, AV_R, 0, Math.PI * 2);
    ctx.clip();
    let drewAvatar = false;
    if (tutor.avatarUrl) {
      try {
        const img = await loadImage(tutor.avatarUrl);
        ctx.drawImage(img, AV_CX - AV_R, AV_CY - AV_R, AV_R * 2, AV_R * 2);
        drewAvatar = true;
      } catch { drewAvatar = false; }
    }
    if (!drewAvatar) {
      const g = ctx.createLinearGradient(AV_CX - AV_R, AV_CY - AV_R, AV_CX + AV_R, AV_CY + AV_R);
      g.addColorStop(0, C.green);
      g.addColorStop(1, C.navy);
      ctx.fillStyle = g;
      ctx.fillRect(AV_CX - AV_R, AV_CY - AV_R, AV_R * 2, AV_R * 2);
      ctx.fillStyle = C.gold;
      ctx.font = `600 36px "${this.displayFamily}"`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initials(tutor.fullName), AV_CX, AV_CY + 2);
    }
    ctx.restore();

    // Gold ring around avatar
    ctx.beginPath();
    ctx.arc(AV_CX, AV_CY, AV_R + 2.5, 0, Math.PI * 2);
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Name
    const nameY = AV_CY + AV_R + 36; // 260
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = C.gold;
    ctx.font = `600 24px "${this.displayFamily}"`;
    ctx.fillText(truncate(ctx, tutor.fullName, W_L - PAD_L * 2), AV_CX, nameY);

    // Credential (up to 2 lines, split at bullet)
    const genderLabel = tutor.gender === 'male' ? 'Thầy' : tutor.gender === 'female' ? 'Cô' : '';
    const credential = [genderLabel, tutor.education].filter(Boolean).join('  •  ');
    if (credential) {
      ctx.fillStyle = C.creamOnNavy;
      ctx.font = `400 11px "${SANS}"`;
      const maxW = W_L - PAD_L * 2;
      if (ctx.measureText(credential).width <= maxW) {
        ctx.fillText(credential, AV_CX, nameY + 22);
      } else {
        const parts = credential.split('  •  ');
        ctx.fillText(truncate(ctx, parts[0] ?? '', maxW), AV_CX, nameY + 22);
        if (parts[1]) ctx.fillText(truncate(ctx, parts[1], maxW), AV_CX, nameY + 36);
      }
    }

    // Tier badge (centered, bottom of left panel)
    this.drawTierBadgeCenter(ctx, tutor.subscriptionType);

    // ── RIGHT PANEL ───────────────────────────────────────────────────────

    // Subject + grade tags
    let bx = RP_X;
    for (const subject of (tutor.subjects ?? []).slice(0, 2)) {
      bx += this.drawTag(ctx, bx, 44, 32, subject, C.navy, C.cream) + 8;
    }
    if (tutor.grades?.length) {
      const g = tutor.grades;
      const gradeLabel = g.length > 1 ? `Lớp ${g[0]}–${g[g.length - 1]}` : `Lớp ${g[0]}`;
      this.drawTag(ctx, bx, 44, 32, gradeLabel, 'rgba(26,34,56,0.07)', C.navy, 'rgba(26,34,56,0.18)');
    }

    // Separator 1
    ctx.fillStyle = C.line;
    ctx.fillRect(RP_X, 96, RP_W, 1);

    // Rating row
    const ratingY = 124;
    const rounded = Math.round(tutor.averageRating);
    let sx = RP_X;
    for (let i = 0; i < 5; i++) {
      drawStar(ctx, sx + 9, ratingY, 9, 4, i < rounded, C.gold);
      sx += 22;
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `700 16px "${SANS}"`;
    ctx.fillStyle = C.navy;
    const scoreText = tutor.averageRating.toFixed(1);
    ctx.fillText(scoreText, RP_X + 120, ratingY);
    const sw = ctx.measureText(scoreText).width;
    ctx.font = `400 13px "${SANS}"`;
    ctx.fillStyle = C.brown45;
    ctx.fillText(`/5  ·  ${tutor.totalReviews} đánh giá`, RP_X + 120 + sw + 2, ratingY);

    // Separator 2
    ctx.fillStyle = C.line;
    ctx.fillRect(RP_X, 156, RP_W, 1);

    // Hours + teaching mode
    const hoursY = 184;
    const modeLabel =
      tutor.teachingMode === 'online' ? 'Online'
      : tutor.teachingMode === 'offline' ? 'Offline'
      : 'Online & Offline';
    ctx.font = `400 13px "${SANS}"`;
    ctx.fillStyle = C.brown70;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const hoursText = `${tutor.completedHours} giờ dạy`;
    ctx.fillText(hoursText, RP_X, hoursY);
    const htw = ctx.measureText(hoursText).width;
    ctx.fillStyle = 'rgba(62,47,40,0.15)';
    ctx.fillRect(RP_X + htw + 14, hoursY - 7, 1, 14);
    ctx.fillStyle = C.brown70;
    ctx.fillText(modeLabel, RP_X + htw + 26, hoursY);

    // Price box
    const pbY = 214;
    const pbH = H - pbY - 24; // 202
    roundRectPath(ctx, RP_X, pbY, RP_W, pbH, 14);
    ctx.fillStyle = C.priceBg;
    ctx.fill();

    const priceCY = pbY + pbH / 2;
    const priceNum = tutor.hourlyRate.toLocaleString('vi-VN');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `700 38px "${this.displayFamily}"`;
    ctx.fillStyle = C.navy;
    ctx.fillText(priceNum, RP_X + 20, priceCY);
    const pnw = ctx.measureText(priceNum).width;
    ctx.font = `400 14px "${SANS}"`;
    ctx.fillStyle = C.brown45;
    ctx.fillText('đ / giờ', RP_X + 20 + pnw + 10, priceCY + 3);

    ctx.restore();

    // Card border
    roundRectPath(ctx, 0.5, 0.5, W - 1, H - 1, CARD_R);
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.stroke();

    return canvas.encode('png');
  }

  // ── Left panel helpers ────────────────────────────────────────────────────

  private drawTutoraBadge(ctx: Ctx, x: number, y: number): void {
    const label = 'TUTORA';
    const sp = 1.2;
    const padX = 10;
    ctx.font = `700 10px "${SANS}"`;
    const tw = trackedWidth(ctx, label, sp);
    const w = tw + padX * 2 + 14;
    const h = 24;
    roundRectPath(ctx, x, y, w, h, 8);
    ctx.fillStyle = C.whiteFaint;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = C.whiteBorder;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 11, y + h / 2, 3, 0, Math.PI * 2);
    ctx.fillStyle = C.gold;
    ctx.fill();
    ctx.fillStyle = C.gold;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    fillTracked(ctx, label, x + 20, y + h / 2 + 0.5, sp);
  }

  private drawTierBadgeCenter(ctx: Ctx, tier?: string): void {
    const labels: Record<string, string> = {
      standard: 'TIÊU CHUẨN',
      free: 'TIÊU CHUẨN',
      pro: 'PRO',
      guided: 'PRO',
      premium: 'PREMIUM',
      intensive: 'PREMIUM',
      elite: 'ELITE',
    };
    if (!tier || !labels[tier]) return;
    const label = labels[tier];
    const sp = 1.5;
    const padX = 16;
    const h = 32;
    ctx.font = `700 11px "${SANS}"`;
    const tw = trackedWidth(ctx, label, sp);
    const w = tw + padX * 2;
    const x = AV_CX - w / 2;
    const y = H - h - 20;
    roundRectPath(ctx, x, y, w, h, 10);
    ctx.fillStyle = C.gold;
    ctx.fill();
    ctx.fillStyle = C.navy;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    fillTracked(ctx, label, x + padX, y + h / 2 + 0.5, sp);
  }

  // ── Right panel helpers ───────────────────────────────────────────────────

  private drawTag(
    ctx: Ctx,
    x: number,
    yTop: number,
    h: number,
    label: string,
    bg: string,
    fg: string,
    border?: string,
  ): number {
    const padX = 14;
    const sp = 1.5;
    const txt = label.toUpperCase();
    ctx.font = `700 11px "${SANS}"`;
    const tw = trackedWidth(ctx, txt, sp);
    const w = tw + padX * 2;
    roundRectPath(ctx, x, yTop, w, h, 8);
    ctx.fillStyle = bg;
    ctx.fill();
    if (border) { ctx.lineWidth = 1; ctx.strokeStyle = border; ctx.stroke(); }
    ctx.fillStyle = fg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    fillTracked(ctx, txt, x + padX, yTop + h / 2 + 0.5, sp);
    return w;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

type Ctx = ReturnType<
  ReturnType<typeof import('@napi-rs/canvas').createCanvas>['getContext']
>;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

function truncate(ctx: Ctx, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function trackedWidth(ctx: Ctx, text: string, spacing: number): number {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + spacing;
  return w - spacing;
}

function fillTracked(ctx: Ctx, text: string, x: number, y: number, spacing: number): void {
  let cx = x;
  for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + spacing; }
}

function drawStar(
  ctx: Ctx,
  cx: number, cy: number,
  outerR: number, innerR: number,
  filled: boolean, color: string,
): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
  if (filled) { ctx.fillStyle = color; ctx.fill(); }
  else { ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.stroke(); }
}

function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
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
