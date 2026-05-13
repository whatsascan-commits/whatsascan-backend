import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SessionDocument = Session & Document;

@Schema()
export class Session {
  @Prop()
  sessionId!: string;

  @Prop({ default: null })
  phone!: string;

  @Prop({ default: 'PENDING' })
  status!: string;

  @Prop({ default: Date.now })
  createdOn!: number;
}

export const SessionSchema = SchemaFactory.createForClass(Session);