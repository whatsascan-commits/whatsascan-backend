import { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
export declare class TransferGateway implements OnGatewayConnection, OnGatewayDisconnect {
    private readonly logger;
    server: Server;
    handleConnection(client: Socket): void;
    handleDisconnect(client: Socket): void;
    handleJoinSession(client: Socket, payload: {
        sessionId?: string;
    }): void;
    emitConnected(sessionId: string, from: string): void;
    emitIncomingText(sessionId: string, from: string, text: string): void;
    emitIncomingFile(sessionId: string, payload: {
        from: string;
        mimeType: string;
        fileName?: string;
        base64: string;
        sizeBytes: number;
    }): void;
}
