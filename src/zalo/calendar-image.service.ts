import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { TutorAvailabilityDto } from '../be-client/dto';

// Width / layout constants
const W = 700;
const TIME_COL_W = 72;
const HEADER_H = 56;
const DAY_HDR_H = 44;
const SLOT_H = 48;
const FOOTER_H = 40;
const TIME_BLOCKS: [number, number][] = [[7,9],[9,11],[13,15],[15,17],[17,19],[19,21]];
const DAY_NAMES_VN = ['T2','T3','T4','T5','T6','T7','CN'];

const COLOR = {
  headerBg: '#1565C0',
  headerText: '#FFFFFF',
  dayHdrBg: '#E3F2FD',
  dayHdrText: '#1565C0',
  dayHdrDate: '#546E7A',
  timeBg: '#F5F5F5',
  timeText: '#455A64',
  available: '#43A047',
  availableText: '#FFFFFF',
  unavailable: '#ECEFF1',
  unavailableText: '#B0BEC5',
  gridLine: '#CFD8DC',
  footerBg: '#FFF9C4',
  footerText: '#5D4037',
  bg: '#FFFFFF',
};

@Injectable()
export class CalendarImageService {
  private readonly logger = new Logger(CalendarImageService.name);
  private readonly store = new Map<string, Buffer>();

  async generate(availability: TutorAvailabilityDto): Promise<string> {
    try {
      const { createCanvas } = await import('@napi-rs/canvas');

      const H = HEADER_H + DAY_HDR_H + TIME_BLOCKS.length * SLOT_H + FOOTER_H;
      const DAY_W = (W - TIME_COL_W) / 7;
      const canvas = createCanvas(W, H);
      const ctx = canvas.getContext('2d');

      // ── Background ────────────────────────────────────────────────────────
      ctx.fillStyle = COLOR.bg;
      ctx.fillRect(0, 0, W, H);

      // ── Header ────────────────────────────────────────────────────────────
      ctx.fillStyle = COLOR.headerBg;
      ctx.fillRect(0, 0, W, HEADER_H);
      ctx.fillStyle = COLOR.headerText;
      ctx.font = 'bold 17px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Lịch rảnh - ${availability.tutorName}`, W / 2, HEADER_H / 2);

      // ── Day headers ───────────────────────────────────────────────────────
      ctx.fillStyle = COLOR.dayHdrBg;
      ctx.fillRect(0, HEADER_H, W, DAY_HDR_H);

      // Time column label
      ctx.fillStyle = COLOR.timeText;
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Giờ', TIME_COL_W / 2, HEADER_H + DAY_HDR_H / 2);

      // Day labels + dates
      const today = new Date();
      const dow = today.getDay();
      const monday = new Date(today);
      monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));

      for (let d = 0; d < 7; d++) {
        const date = new Date(monday);
        date.setDate(monday.getDate() + d);
        const x = TIME_COL_W + d * DAY_W + DAY_W / 2;

        ctx.fillStyle = COLOR.dayHdrText;
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(DAY_NAMES_VN[d], x, HEADER_H + 14);

        ctx.fillStyle = COLOR.dayHdrDate;
        ctx.font = '11px sans-serif';
        ctx.fillText(
          `${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}`,
          x,
          HEADER_H + 32,
        );
      }

      // ── Slot grid ─────────────────────────────────────────────────────────
      const availSet = new Set(
        availability.slots.map(s => `${s.dayOfWeek}:${s.startHour}`),
      );

      for (let r = 0; r < TIME_BLOCKS.length; r++) {
        const [startH, endH] = TIME_BLOCKS[r];
        const rowY = HEADER_H + DAY_HDR_H + r * SLOT_H;

        // Time label cell
        ctx.fillStyle = COLOR.timeBg;
        ctx.fillRect(0, rowY, TIME_COL_W, SLOT_H);
        ctx.fillStyle = COLOR.timeText;
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${startH}h-${endH}h`, TIME_COL_W / 2, rowY + SLOT_H / 2);

        // Day cells
        for (let d = 0; d < 7; d++) {
          const dayNum = d + 1;
          const avail = availSet.has(`${dayNum}:${startH}`);
          const cellX = TIME_COL_W + d * DAY_W;

          ctx.fillStyle = avail ? COLOR.available : COLOR.unavailable;
          ctx.fillRect(cellX + 1, rowY + 1, DAY_W - 2, SLOT_H - 2);

          ctx.fillStyle = avail ? COLOR.availableText : COLOR.unavailableText;
          ctx.font = avail ? 'bold 12px sans-serif' : '11px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(avail ? 'Rảnh' : '-', cellX + DAY_W / 2, rowY + SLOT_H / 2);
        }
      }

      // ── Grid lines ────────────────────────────────────────────────────────
      ctx.strokeStyle = COLOR.gridLine;
      ctx.lineWidth = 1;

      for (let d = 0; d <= 7; d++) {
        const x = TIME_COL_W + d * DAY_W;
        ctx.beginPath();
        ctx.moveTo(x, HEADER_H);
        ctx.lineTo(x, HEADER_H + DAY_HDR_H + TIME_BLOCKS.length * SLOT_H);
        ctx.stroke();
      }
      for (let r = 0; r <= TIME_BLOCKS.length; r++) {
        const y = HEADER_H + DAY_HDR_H + r * SLOT_H;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      // ── Footer ────────────────────────────────────────────────────────────
      const footerY = HEADER_H + DAY_HDR_H + TIME_BLOCKS.length * SLOT_H;
      ctx.fillStyle = COLOR.footerBg;
      ctx.fillRect(0, footerY, W, FOOTER_H);
      ctx.fillStyle = COLOR.footerText;
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        'Nhan khung gio mong muon, vi du: "T4 17-19" hoac "Thu 4 luc 17h"',
        W / 2,
        footerY + FOOTER_H / 2,
      );

      const buffer = await canvas.encode('png');
      const id = randomUUID();
      this.store.set(id, buffer);
      setTimeout(() => this.store.delete(id), 10 * 60 * 1000); // 10 min TTL
      return id;
    } catch (error) {
      this.logger.error(`Failed to generate calendar image: ${String(error)}`);
      throw error;
    }
  }

  getImage(id: string): Buffer | undefined {
    return this.store.get(id);
  }
}
