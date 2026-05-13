import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
})
export class TransferGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(TransferGateway.name);

  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket) {
    this.logger.log(`Socket connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Socket disconnected: ${client.id}`);
  }

  @SubscribeMessage('join-session')
  handleJoinSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId?: string },
  ) {
    const sessionId = (payload?.sessionId || '').trim();
    if (!/^\d{6}$/.test(sessionId)) {
      client.emit('join-session-error', {
        message: 'sessionId must be a 6-digit value',
      });
      return;
    }

    client.join(sessionId);
    client.emit('join-session-success', { sessionId });
    this.logger.log(`Socket ${client.id} joined room ${sessionId}`);
  }

  emitConnected(sessionId: string, from: string) {
    const roomSize =
      this.server.sockets.adapter.rooms.get(sessionId)?.size ?? 0;
    this.logger.log(
      `Emitting whatsapp-connected to room "${sessionId}" (listeners in room: ${roomSize})`,
    );
    if (roomSize === 0) {
      this.logger.warn(
        `No browser sockets joined room "${sessionId}" yet — UI will miss Connected until client joins this session.`,
      );
    }
    this.server.to(sessionId).emit('whatsapp-connected', {
      sessionId,
      from,
      connectedAt: new Date().toISOString(),
    });
  }

  emitIncomingText(sessionId: string, from: string, text: string) {
    this.server.to(sessionId).emit('incoming-card', {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: 'text',
      from,
      text,
      receivedAt: new Date().toISOString(),
    });
  }

  emitIncomingFile(sessionId: string, payload: {
    from: string;
    mimeType: string;
    fileName?: string;
    base64: string;
    sizeBytes: number;
  }) {
    this.server.to(sessionId).emit('incoming-card', {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: 'file',
      from: payload.from,
      mimeType: payload.mimeType,
      fileName: payload.fileName || 'attachment',
      base64: payload.base64,
      sizeBytes: payload.sizeBytes,
      receivedAt: new Date().toISOString(),
    });
  }
}
