import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { existsSync } from 'fs';
import * as mongoose from 'mongoose';
import { Connection, Model, Schema } from 'mongoose';
import { platform } from 'os';
import { Client, LocalAuth, Message } from 'whatsapp-web.js';
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
    if (!this.client) {
      return;
    }
    try {
      await this.client.destroy();
      this.logger.log('WhatsApp client destroyed (shutdown)');
    } catch (error) {
      this.logger.warn(
        `WhatsApp client destroy failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async bootstrapWhatsApp() {
    await this.mongoConnection.asPromise();
    if (!this.mongoConnection.db) {
      throw new Error('Mongo connection is not ready');
    }

    // Puppeteer configuration logic
    const configuredExecutablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
    const executablePath = configuredExecutablePath && existsSync(configuredExecutablePath)
      ? configuredExecutablePath
      : undefined;

    const isLinux = platform() === 'linux';
    const puppeteerArgs = isLinux
      ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      : ['--no-first-run', '--no-sandbox'];

    // Client Initialization with LocalAuth for testing
    this.client = new Client({
      authStrategy: new LocalAuth({
        clientId: "local-link-bot",
        dataPath: './.wwebjs_auth'
      }),
      puppeteer: {
        headless: false, // Browser window khulegi taake aap asli activity dekh saken
        executablePath,
        args: puppeteerArgs,
      },
    });

    // --- EVENT LISTENERS (Initialize se pehle) ---

    // 1. QR Code Listener - Ye sabse zaroori hai
    this.client.on('qr', (qr) => {
      this.logger.log('NEW QR RECEIVED! Scan the QR code below:');
      // Isse terminal mein QR print hoga
      qrcodeTerminal.generate(qr, { small: true });
    });

    // 2. Authenticated
    this.client.on('authenticated', () => {
      this.logger.log('WhatsApp client AUTHENTICATED (Session saved)');
    });

    // 3. Ready
    this.client.on('ready', () => {
      const wid = (this.client as any).info?.wid?._serialized;
      this.logger.log(`WHATSAPP CLIENT IS READY! Logged in as: ${wid}`);
    });

    // 4. Auth Failure
    this.client.on('auth_failure', (msg) => {
      this.logger.error(`WhatsApp auth failure: ${msg}`);
    });

    // 5. Message Handlers
    const processMessage = async (message: Message) => {
      try {
        this.logger.log(`Incoming Message: from=${message.from}, body=${message.body}`);
        await this.handleIncomingMessage(message);
      } catch (error) {
        this.logger.error('Failed to process message', error as Error);
      }
    };

    this.client.on('message', processMessage);
    this.client.on('message_create', processMessage);

    this.client.on('disconnected', (reason) => {
      this.logger.warn(`WhatsApp disconnected: ${reason}`);
    });

    // --- START CLIENT ---
    await this.initializeWithRetry();
  }

  private async initializeWithRetry() {
    let lastError: unknown;
    for (let attempt = 1; attempt <= WHATSAPP_INIT_RETRIES; attempt += 1) {
      try {
        await this.client.initialize();
        this.logger.log(`WhatsApp initialize succeeded on attempt ${attempt}`);
        return;
      } catch (error) {
        lastError = error;
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `WhatsApp initialize failed on attempt ${attempt}/${WHATSAPP_INIT_RETRIES}: ${msg}`,
        );
        if (/already running|userDataDir/i.test(msg)) {
          this.logger.warn(
            'Puppeteer profile lock — destroying client and waiting before retry',
          );
          try {
            await this.client.destroy();
          } catch {
            /* ignore */
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } else if (attempt < WHATSAPP_INIT_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    }

    throw lastError;
  }

  private async handleIncomingMessage(message: Message) {
    const rawBody = message.body || '';
    const body = rawBody.replace(/\u00a0/g, ' ').trim();
    const from = (message.from || '').trim();
    const to = (message.to || '').trim();
    const chatId = message.fromMe && to ? to : from;
    if (from === 'status@broadcast') {
      return;
    }

    this.logger.log(
      `WA message event chatId=${chatId} fromMe=${message.fromMe ? 'yes' : 'no'} body="${body}"`,
    );

    const connectMatch = body.match(CONNECT_REGEX);
    if (connectMatch) {
      const sessionId = connectMatch[1];
      await this.bindChatToSession(chatId, sessionId);
      this.transferGateway.emitConnected(sessionId, chatId);
      this.logger.log(`Connect command received for session ${sessionId} from ${chatId}`);
      return;
    }

    if (/connect/i.test(body)) {
      this.logger.warn(`Connect-like message received but not matched: "${body}"`);
    }

    const mapping = await this.sessionModel.findOne({ chatId }).lean();
    if (!mapping) {
      return;
    }

    await this.refreshSessionExpiry(mapping.chatId);

    if (message.hasMedia) {
      const media = await message.downloadMedia();
      if (!media?.data) {
        return;
      }

      const sizeBytes = Buffer.byteLength(media.data, 'base64');
      this.transferGateway.emitIncomingFile(mapping.sessionId, {
        from,
        mimeType: media.mimetype || 'application/octet-stream',
        fileName: media.filename || undefined,
        base64: media.data,
        sizeBytes,
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
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    this.logger.log(`Bound chat ${chatId} to session ${sessionId}`);
  }

  private async refreshSessionExpiry(chatId: string) {
    await this.sessionModel.updateOne(
      { chatId },
      { $set: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) } },
    );
  }
}
