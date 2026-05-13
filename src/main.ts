import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Request, Response } from 'express';
import { AppModule } from './app.module';

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
    http.get('/api/health', (_req: Request, res: Response) => {
      res.status(200).json({ ok: true });
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
