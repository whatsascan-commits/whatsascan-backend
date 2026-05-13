import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Connection } from 'mongoose';
import { TransferGateway } from './transfer.gateway';
export declare class WhatsAppService implements OnModuleInit, OnModuleDestroy {
    private readonly mongoConnection;
    private readonly transferGateway;
    private readonly logger;
    private readonly sessionModel;
    private client;
    constructor(mongoConnection: Connection, transferGateway: TransferGateway);
    onModuleInit(): Promise<void>;
    onModuleDestroy(): Promise<void>;
    private bootstrapWhatsApp;
    private initializeWithRetry;
    private handleIncomingMessage;
    private bindChatToSession;
    private refreshSessionExpiry;
}
