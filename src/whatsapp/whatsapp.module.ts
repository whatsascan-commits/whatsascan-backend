import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { SessionModule } from '../session/session.module';
import { SocketGateway } from '../gateway/socket.gateway';

@Module({
  imports: [SessionModule],
  providers: [WhatsappService, SocketGateway],
})
export class WhatsappModule {}