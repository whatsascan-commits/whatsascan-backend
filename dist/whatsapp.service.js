"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var WhatsAppService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const fs_1 = require("fs");
const mongoose_2 = require("mongoose");
const os_1 = require("os");
const whatsapp_web_js_1 = require("whatsapp-web.js");
const transfer_gateway_1 = require("./transfer.gateway");
const qrcodeTerminal = require("qrcode-terminal");
const SessionSchema = new mongoose_2.Schema({
    sessionId: { type: String, required: true, index: true },
    chatId: { type: String, required: true, unique: true, index: true },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: { createdAt: false, updatedAt: true } });
const SESSION_TTL_MS = 10 * 60 * 1000;
const CONNECT_REGEX = /connect\s*:?\s*(\d{6})/i;
const WHATSAPP_INIT_RETRIES = 5;
let WhatsAppService = WhatsAppService_1 = class WhatsAppService {
    constructor(mongoConnection, transferGateway) {
        this.mongoConnection = mongoConnection;
        this.transferGateway = transferGateway;
        this.logger = new common_1.Logger(WhatsAppService_1.name);
        this.sessionModel = this.mongoConnection.model('active_whatsapp_session', SessionSchema);
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
        }
        catch (error) {
            this.logger.warn(`WhatsApp client destroy failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async bootstrapWhatsApp() {
        await this.mongoConnection.asPromise();
        if (!this.mongoConnection.db) {
            throw new Error('Mongo connection is not ready');
        }
        const configuredExecutablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
        const executablePath = configuredExecutablePath && (0, fs_1.existsSync)(configuredExecutablePath)
            ? configuredExecutablePath
            : undefined;
        const isLinux = (0, os_1.platform)() === 'linux';
        const puppeteerArgs = isLinux
            ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            : ['--no-first-run', '--no-sandbox'];
        this.client = new whatsapp_web_js_1.Client({
            authStrategy: new whatsapp_web_js_1.LocalAuth({
                clientId: "local-link-bot",
                dataPath: './.wwebjs_auth'
            }),
            puppeteer: {
                headless: false,
                executablePath,
                args: puppeteerArgs,
            },
        });
        this.client.on('qr', (qr) => {
            this.logger.log('NEW QR RECEIVED! Scan the QR code below:');
            qrcodeTerminal.generate(qr, { small: true });
        });
        this.client.on('authenticated', () => {
            this.logger.log('WhatsApp client AUTHENTICATED (Session saved)');
        });
        this.client.on('ready', () => {
            const wid = this.client.info?.wid?._serialized;
            this.logger.log(`WHATSAPP CLIENT IS READY! Logged in as: ${wid}`);
        });
        this.client.on('auth_failure', (msg) => {
            this.logger.error(`WhatsApp auth failure: ${msg}`);
        });
        const processMessage = async (message) => {
            try {
                this.logger.log(`Incoming Message: from=${message.from}, body=${message.body}`);
                await this.handleIncomingMessage(message);
            }
            catch (error) {
                this.logger.error('Failed to process message', error);
            }
        };
        this.client.on('message', processMessage);
        this.client.on('message_create', processMessage);
        this.client.on('disconnected', (reason) => {
            this.logger.warn(`WhatsApp disconnected: ${reason}`);
        });
        await this.initializeWithRetry();
    }
    async initializeWithRetry() {
        let lastError;
        for (let attempt = 1; attempt <= WHATSAPP_INIT_RETRIES; attempt += 1) {
            try {
                await this.client.initialize();
                this.logger.log(`WhatsApp initialize succeeded on attempt ${attempt}`);
                return;
            }
            catch (error) {
                lastError = error;
                const msg = error instanceof Error ? error.message : String(error);
                this.logger.warn(`WhatsApp initialize failed on attempt ${attempt}/${WHATSAPP_INIT_RETRIES}: ${msg}`);
                if (/already running|userDataDir/i.test(msg)) {
                    this.logger.warn('Puppeteer profile lock — destroying client and waiting before retry');
                    try {
                        await this.client.destroy();
                    }
                    catch {
                    }
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                }
                else if (attempt < WHATSAPP_INIT_RETRIES) {
                    await new Promise((resolve) => setTimeout(resolve, 3000));
                }
            }
        }
        throw lastError;
    }
    async handleIncomingMessage(message) {
        const rawBody = message.body || '';
        const body = rawBody.replace(/\u00a0/g, ' ').trim();
        const from = (message.from || '').trim();
        const to = (message.to || '').trim();
        const chatId = message.fromMe && to ? to : from;
        if (from === 'status@broadcast') {
            return;
        }
        this.logger.log(`WA message event chatId=${chatId} fromMe=${message.fromMe ? 'yes' : 'no'} body="${body}"`);
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
    async bindChatToSession(chatId, sessionId) {
        const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
        await this.sessionModel.findOneAndUpdate({ chatId }, { chatId, sessionId, expiresAt }, { upsert: true, new: true, setDefaultsOnInsert: true });
        this.logger.log(`Bound chat ${chatId} to session ${sessionId}`);
    }
    async refreshSessionExpiry(chatId) {
        await this.sessionModel.updateOne({ chatId }, { $set: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
    }
};
exports.WhatsAppService = WhatsAppService;
exports.WhatsAppService = WhatsAppService = WhatsAppService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectConnection)()),
    __metadata("design:paramtypes", [mongoose_2.Connection,
        transfer_gateway_1.TransferGateway])
], WhatsAppService);
//# sourceMappingURL=whatsapp.service.js.map