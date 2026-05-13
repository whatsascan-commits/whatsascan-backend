import {
    Injectable,
    OnModuleInit,
} from '@nestjs/common';

import {
    Client,
    LocalAuth,
} from 'whatsapp-web.js';

import * as qrcode from 'qrcode-terminal';
import * as fs from 'fs-extra';

import { SessionService } from '../session/session.service';
import { SocketGateway } from '../gateway/socket.gateway';

@Injectable()
export class WhatsappService
    implements OnModuleInit {
    client!: Client;

    constructor(
        private readonly sessionService: SessionService,
        private readonly socketGateway: SocketGateway,
    ) { }

    async onModuleInit() {
        this.client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: {
                headless: false,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                ],
            },
        });

        // ======================
        // QR EVENT
        // ======================
        this.client.on('qr', (qr) => {
            console.log('SCAN QR BELOW');
            qrcode.generate(qr, {
                small: true,
            });
        });

        // ======================
        // READY
        // ======================
        this.client.on('ready', () => {
            console.log('WHATSAPP READY ✅');
        });

        // ======================
        // MESSAGE EVENT
        // ======================
        this.client.on(
            'message',
            async (message) => {
                try {
                    // 🚨 IGNORE GROUPS
                    if (message.from.endsWith('@g.us')) {
                        return;
                    }

                    const phone =
                        message.from.replace('@c.us', '');

                    console.log(
                        'NEW PRIVATE MESSAGE:',
                        phone,
                    );

                    // ======================
                    // CONNECT SESSION
                    // ======================
                    if (
                        message.body?.startsWith('Connect:')
                    ) {
                        const sessionId =
                            message.body
                                .split(':')[1]
                                .trim();

                        console.log(
                            'CONNECT REQUEST:',
                            sessionId,
                        );

                        await this.sessionService.connectSession(
                            phone,
                            sessionId,
                        );

                        this.socketGateway.sendConnected(
                            sessionId,
                        );

                        await message.reply(
                            'Connected Successfully ✅',
                        );

                        return;
                    }

                    // ======================
                    // MEDIA / FILE HANDLING
                    // ======================
                    if (message.hasMedia) {
                        console.log('MEDIA RECEIVED');

                        const session =
                            await this.sessionService.findByPhone(
                                phone,
                            );
                        console.log('SESSION FOUND:', session);
                        console.log("SESSION ID USED:", session?.sessionId);

                        if (!session) {
                            console.log(
                                'NO SESSION FOUND FOR PHONE',
                            );
                            return;
                        }

                        const media =
                            await message.downloadMedia();

                        if (!media) {
                            console.log(
                                'MEDIA DOWNLOAD FAILED',
                            );
                            return;
                        }

                        const extension =
                            media.mimetype.split(
                                '/',
                            )[1];

                        const fileName = `${Date.now()}.${extension}`;

                        const buffer =
                            Buffer.from(
                                media.data,
                                'base64',
                            );

                        // ======================
                        // SAVE FILE
                        // ======================
                        await fs.writeFile(
                            `uploads/${fileName}`,
                            buffer,
                        );

                        console.log(
                            'FILE SAVED:',
                            fileName,
                        );

                        const fileData = {
                            url: `/uploads/${fileName}`,
                            mimeType: media.mimetype,
                            fileName,
                        };
                        console.log("EMITTING FILE TO SESSION:", session.sessionId);

                        // ======================
                        // SEND TO FRONTEND
                        // ======================
                        this.socketGateway.sendFile(
                            session.sessionId,
                            fileData,
                        );

                        console.log(
                            'FILE SENT TO FRONTEND ✅',
                        );
                    }
                } catch (err) {
                    console.log('ERROR:', err);
                }
            },
        );

        // ======================
        // INIT
        // ======================
        await this.client.initialize();
    }
}