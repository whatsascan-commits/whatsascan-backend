import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { WhatsappService } from './whatsapp.service';

@Controller('whatsapp')
export class WhatsappController {
    constructor(private readonly whatsappService: WhatsappService) {}

    @Get('qr')
    async getQr(@Res() res: Response) {
        if (this.whatsappService.isReady) {
            return res.status(200).json({ status: 'connected' });
        }

        const qrBuffer = await this.whatsappService.getQrImage();

        if (!qrBuffer) {
            return res.status(404).json({ status: 'qr_not_ready' });
        }

        res.setHeader('Content-Type', 'image/png');
        res.send(qrBuffer);
    }
}
