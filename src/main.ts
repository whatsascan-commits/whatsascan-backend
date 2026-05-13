import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Request, Response } from 'express';
import * as QRCode from 'qrcode';
import { AppModule } from './app.module';
import { WhatsAppService } from './whatsapp.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  try {
    const app = await NestFactory.create(AppModule, {
      cors: {
        origin: true,
        credentials: true,
      },
    });

    app.enableShutdownHooks();
    app.useWebSocketAdapter(new IoAdapter(app));

    app.setGlobalPrefix('api');
    const http = app.getHttpAdapter().getInstance();
    const waService = app.get(WhatsAppService);

    http.get('/api/health', (_req: Request, res: Response) => {
      res.status(200).json({ ok: true });
    });

    http.get('/api/qr', async (_req: Request, res: Response) => {
      if (waService.getIsReady()) {
        res.status(200).send('<h2>WhatsApp already connected ✅</h2>');
        return;
      }
      const qr = waService.getLatestQr();
      if (!qr) {
        res.status(202).send('<h2>QR not ready yet, please refresh in a few seconds...</h2>');
        return;
      }
      const dataUrl = await QRCode.toDataURL(qr, { width: 300 });
      res.status(200).send(`<!DOCTYPE html><html><body style="display:flex;flex-direction:column;align-items:center;font-family:sans-serif;padding:40px"><h2>Scan this QR in WhatsApp</h2><img src="${dataUrl}" /><p style="color:gray">Refresh page if QR expires</p></body></html>`);
    });

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    const port = Number(process.env.PORT || 3000);
    await app.listen(port, '0.0.0.0');
    logger.log(`Service started successfully on port ${port}`);
  } catch (error) {
    logger.error('Service failed to start', error as Error);
    process.exit(1);
  }
}

void bootstrap();
