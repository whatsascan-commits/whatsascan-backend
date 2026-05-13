import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';

import { SessionModule } from './session/session.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';

import { SocketGateway } from './gateway/socket.gateway';

@Module({
  imports: [
    // =========================
    // ENV CONFIG
    // =========================
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    // =========================
    // MONGODB
    // =========================
    MongooseModule.forRoot(
      process.env.MONGO_URL as string,
    ),

    // =========================
    // MODULES
    // =========================
    SessionModule,
    WhatsappModule,
  ],

  // =========================
  // PROVIDERS
  // =========================
  providers: [SocketGateway],
})
export class AppModule {}