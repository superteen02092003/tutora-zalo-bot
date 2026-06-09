import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CalendarImageService } from './calendar-image.service';

@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendarImageService: CalendarImageService) {}

  @Get(':id.png')
  getPngImage(@Param('id') id: string, @Res() res: Response): void {
    this.sendImage(id, res);
  }

  @Get(':id')
  getImage(@Param('id') id: string, @Res() res: Response): void {
    this.sendImage(id, res);
  }

  private sendImage(id: string, res: Response): void {
    const buffer = this.calendarImageService.getImage(id);
    if (!buffer) throw new NotFoundException('Calendar image not found or expired');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }
}
