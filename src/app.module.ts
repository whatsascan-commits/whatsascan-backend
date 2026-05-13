import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';

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
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URL'),
      }),
      inject: [ConfigService],
    }),

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