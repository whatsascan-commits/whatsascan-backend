import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import * as mongoose from 'mongoose';
import { Connection, Model, Schema } from 'mongoose';
import { platform } from 'os';
import { Client, Message, RemoteAuth } from 'whatsapp-web.js';
import { MongoStore } from 'wwebjs-mongo';
import { TransferGateway } from './transfer.gateway';
import * as qrcodeTerminal from 'qrcode-terminal';

type SessionDoc = {
  sessionId: string;
  chatId: string;
  createdAt: Date;
  expiresAt: Date;
  updatedAt: Date;
};

const SessionSchema = new Schema<SessionDoc>(
  {
    sessionId: { type: String, required: true, index: true },
    chatId: { type: String, required: true, unique: true, index: true },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

const SESSION_TTL_MS = 10 * 60 * 1000;
const CONNECT_REGEX = /connect\s*:?\s*(\d{6})/i;
const WHATSAPP_INIT_RETRIES = 5;

@Injectable()
export class WhatsAppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly sessionModel: Model<SessionDoc>;
  private client!: Client;

  constructor(
    @InjectConnection() private readonly mongoConnection: Connection,
    private readonly transferGateway: TransferGateway,
  ) {
    this.sessionModel = this.mongoConnection.model<SessionDoc>(
      'active_whatsapp_session',
      SessionSchema,
    );
  }

  async onModuleInit() {
    await this.bootstrapWhatsApp();
  }

  async onModuleDestroy() {
    if (!this.client) return;

    try {
      await this.client.destroy();
      this.logger.log('WhatsApp client destroyed (shutdown)');
    } catch (error) {
      this.logger.warn(`Destroy failed: ${error}`);
    }
  }

  private async bootstrapWhatsApp() {
    await this.mongoConnection.asPromise();

    if (!this.mongoConnection.db) {
      throw new Error('Mongo connection is not ready');
    }

    // ✅ Mongo Store (IMPORTANT)
    const store = new MongoStore({
      mongoose: this.mongoConnection,
    });

    const isLinux = platform() === 'linux';

    const puppeteerArgs = isLinux
      ? [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
        ]
      : [];

    // ✅ CLIENT (RemoteAuth for persistence)
    this.client = new Client({
      authStrategy: new RemoteAuth({
        store: store,
        backupSyncIntervalMs: 300000,
      }),
      puppeteer: {
        headless: true, // 🔥 MUST for Railway
        args: puppeteerArgs,
      },
    });

    // QR
    this.client.on('qr', (qr) => {
      this.logger.log('Scan QR:');
      qrcodeTerminal.generate(qr, { small: true });
    });

    this.client.on('authenticated', () => {
      this.logger.log('AUTHENTICATED ✅');
    });

    this.client.on('ready', () => {
      const wid = (this.client as any).info?.wid?._serialized;
      this.logger.log(`READY ✅ Logged in as ${wid}`);
    });

    this.client.on('auth_failure', (msg) => {
      this.logger.error(`Auth failure ❌: ${msg}`);
    });

    this.client.on('disconnected', (reason) => {
      this.logger.warn(`Disconnected: ${reason}`);
    });

    const processMessage = async (message: Message) => {
      try {
        await this.handleIncomingMessage(message);
      } catch (error) {
        this.logger.error('Message error', error as Error);
      }
    };

    this.client.on('message', processMessage);
    this.client.on('message_create', processMessage);

    await this.initializeWithRetry();
  }

  private async initializeWithRetry() {
    let lastError: unknown;

    for (let i = 1; i <= WHATSAPP_INIT_RETRIES; i++) {
      try {
        await this.client.initialize();
        this.logger.log(`Initialized on attempt ${i}`);
        return;
      } catch (err) {
        lastError = err;
        this.logger.warn(`Retry ${i} failed`);

        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    throw lastError;
  }

  private async handleIncomingMessage(message: Message) {
    const body = (message.body || '').trim();
    const from = message.from || '';
    const to = message.to || '';
    const chatId = message.fromMe ? to : from;

    if (from === 'status@broadcast') return;

    const connectMatch = body.match(CONNECT_REGEX);

    if (connectMatch) {
      const sessionId = connectMatch[1];

      await this.bindChatToSession(chatId, sessionId);
      this.transferGateway.emitConnected(sessionId, chatId);

      return;
    }

    const mapping = await this.sessionModel.findOne({ chatId }).lean();
    if (!mapping) return;

    await this.refreshSessionExpiry(chatId);

    if (message.hasMedia) {
      const media = await message.downloadMedia();
      if (!media?.data) return;

      this.transferGateway.emitIncomingFile(mapping.sessionId, {
        from,
        mimeType: media.mimetype || '',
        base64: media.data,
        sizeBytes: Buffer.byteLength(media.data, 'base64'),
      });

      return;
    }

    this.transferGateway.emitIncomingText(mapping.sessionId, from, body);
  }

  private async bindChatToSession(chatId: string, sessionId: string) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.sessionModel.findOneAndUpdate(
      { chatId },
      { chatId, sessionId, expiresAt },
      { upsert: true },
    );
  }

  private async refreshSessionExpiry(chatId: string) {
    await this.sessionModel.updateOne(
      { chatId },
      { expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    );
  }
}