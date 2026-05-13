import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { TransferGateway } from './transfer.gateway';
import { WhatsAppService } from './whatsapp.service';

@Module({
  imports: [
    ConfigModule.forRoot({ 
      isGlobal: true,
    }),
    MongooseModule.forRoot(process.env.MONGO_URI || '', { 
      serverSelectionTimeoutMS: 10000,
    }),
  ],
  providers: [TransferGateway, WhatsAppService],
})
export class AppModule {}
