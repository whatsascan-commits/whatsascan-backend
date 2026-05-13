import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";

import { Server, Socket } from "socket.io";

@WebSocketGateway({
  cors: {
    origin: "*",
    credentials: true,
  },
})
export class SocketGateway {
  @WebSocketServer()
  server!: Server;

  @SubscribeMessage("join-session")
  handleJoin(
    @MessageBody() sessionId: string,
    @ConnectedSocket() client: Socket
  ) {
    if (!sessionId) {
      console.log("❌ Invalid sessionId");
      return;
    }

    client.join(sessionId);

    console.log("JOINED ROOM:", sessionId);
    console.log("SOCKET ID:", client.id);
  }

  sendConnected(sessionId: string) {
    if (!sessionId) return;

    console.log("EMIT connected ->", sessionId);

    this.server.to(sessionId).emit("connected");
  }

  sendFile(sessionId: string, file: any) {
    if (!sessionId) {
      console.log("❌ sendFile skipped: no sessionId");
      return;
    }

    const room = this.server.sockets.adapter.rooms.get(sessionId);

    console.log("ROOM CHECK:", sessionId, room?.size);

    this.server.to(sessionId).emit("new-file", file);

    console.log("FILE EMITTED TO FRONTEND ✅");
  }
}