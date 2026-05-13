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
var TransferGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransferGateway = void 0;
const websockets_1 = require("@nestjs/websockets");
const common_1 = require("@nestjs/common");
const socket_io_1 = require("socket.io");
let TransferGateway = TransferGateway_1 = class TransferGateway {
    constructor() {
        this.logger = new common_1.Logger(TransferGateway_1.name);
    }
    handleConnection(client) {
        this.logger.log(`Socket connected: ${client.id}`);
    }
    handleDisconnect(client) {
        this.logger.log(`Socket disconnected: ${client.id}`);
    }
    handleJoinSession(client, payload) {
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
    emitConnected(sessionId, from) {
        const roomSize = this.server.sockets.adapter.rooms.get(sessionId)?.size ?? 0;
        this.logger.log(`Emitting whatsapp-connected to room "${sessionId}" (listeners in room: ${roomSize})`);
        if (roomSize === 0) {
            this.logger.warn(`No browser sockets joined room "${sessionId}" yet — UI will miss Connected until client joins this session.`);
        }
        this.server.to(sessionId).emit('whatsapp-connected', {
            sessionId,
            from,
            connectedAt: new Date().toISOString(),
        });
    }
    emitIncomingText(sessionId, from, text) {
        this.server.to(sessionId).emit('incoming-card', {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            type: 'text',
            from,
            text,
            receivedAt: new Date().toISOString(),
        });
    }
    emitIncomingFile(sessionId, payload) {
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
};
exports.TransferGateway = TransferGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], TransferGateway.prototype, "server", void 0);
__decorate([
    (0, websockets_1.SubscribeMessage)('join-session'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", void 0)
], TransferGateway.prototype, "handleJoinSession", null);
exports.TransferGateway = TransferGateway = TransferGateway_1 = __decorate([
    (0, websockets_1.WebSocketGateway)({
        cors: {
            origin: true,
            credentials: true,
        },
    })
], TransferGateway);
//# sourceMappingURL=transfer.gateway.js.map