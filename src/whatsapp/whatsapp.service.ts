import {
    Injectable,
    OnModuleInit,
} from '@nestjs/common';

import {
    Client,
    RemoteAuth,
} from 'whatsapp-web.js';

import { MongoStore } from 'wwebjs-mongo';
import * as mongoose from 'mongoose';

import * as qrcodeTerminal from 'qrcode-terminal';
import * as QRCode from 'qrcode';
import * as fs from 'fs-extra';

import { SessionService } from '../session/session.service';
import { SocketGateway } from '../gateway/socket.gateway';

@Injectable()
export class WhatsappService implements OnModuleInit {
    client!: Client;
    private latestQr: string | null = null;
    isReady = false;

    constructor(
        private readonly sessionService: SessionService,
        private readonly socketGateway: SocketGateway,
    ) {}

    async onModuleInit() {
        // ✅ IMPORTANT: non-blocking init
        setTimeout(() => {
            this.startWhatsApp();
        }, 3000);
    }

    async startWhatsApp() {
        // ✅ Mongo connect (required for RemoteAuth)
        await mongoose.connect(process.env.MONGO_URI as string);

        const store = new MongoStore({
            mongoose: mongoose,
        });

        this.client = new Client({
            authStrategy: new RemoteAuth({
                store: store,
                backupSyncIntervalMs: 300000,
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--no-zygote',
                    '--single-process',
                ],
            },
        });

        // ======================
        // QR
        // ======================
        this.client.on('qr', (qr) => {
            this.latestQr = qr;
            this.isReady = false;
            console.log('SCAN QR BELOW');
            qrcodeTerminal.generate(qr, { small: true });
        });

        // ======================
        // READY
        // ======================
        this.client.on('ready', () => {
            this.latestQr = null;
            this.isReady = true;
            console.log('WHATSAPP READY ✅');
        });

        // ======================
        // MESSAGE
        // ======================
        this.client.on('message', async (message) => {
            try {
                if (message.from.endsWith('@g.us')) return;

                const phone = message.from.replace('@c.us', '');

                // CONNECT
                if (message.body?.startsWith('Connect:')) {
                    const sessionId = message.body.split(':')[1].trim();

                    await this.sessionService.connectSession(
                        phone,
                        sessionId,
                    );

                    this.socketGateway.sendConnected(sessionId);

                    await message.reply('Connected Successfully ✅');
                    return;
                }

                // MEDIA
                if (message.hasMedia) {
                    const session =
                        await this.sessionService.findByPhone(phone);

                    if (!session) return;

                    const media = await message.downloadMedia();
                    if (!media) return;

                    const extension = media.mimetype.split('/')[1];
                    const fileName = `${Date.now()}.${extension}`;

                    const buffer = Buffer.from(media.data, 'base64');

                    // ✅ ensure folder exists
                    await fs.ensureDir('uploads');

                    await fs.writeFile(`uploads/${fileName}`, buffer);

                    const fileData = {
                        url: `/uploads/${fileName}`,
                        mimeType: media.mimetype,
                        fileName,
                    };

                    this.socketGateway.sendFile(
                        session.sessionId,
                        fileData,
                    );
                }
            } catch (err) {
                console.log('ERROR:', err);
            }
        });

        // ======================
        // INIT (non-blocking)
        // ======================
        this.client.initialize().catch((err) => {
            console.error('WHATSAPP INIT ERROR:', err);
        });
    }

    async getQrImage(): Promise<Buffer | null> {
        if (!this.latestQr) return null;
        return QRCode.toBuffer(this.latestQr, { width: 300 });
    }
}