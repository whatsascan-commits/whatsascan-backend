import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { Session } from './schemas/session.schema';

@Injectable()
export class SessionService {
  constructor(
    @InjectModel(Session.name)
    private sessionModel: Model<Session>,
  ) {}

  async createSession() {
  // existing connected session
  const existingSession = await this.sessionModel.findOne({
    status: 'CONNECTED',
  });

  if (existingSession) {
    console.log('RETURNING EXISTING SESSION');

    return existingSession;
  }

  // create new
  const session = await this.sessionModel.create({
    sessionId: randomUUID(),
    status: 'PENDING',
    createdOn: Date.now(),
  });

  console.log('NEW SESSION CREATED');

  return session;
}

  async connectSession(phone: string, sessionId: string) {
    return this.sessionModel.findOneAndUpdate(
      {
        sessionId,
      },
      {
        phone,
        status: 'CONNECTED',
      },
      {
        new: true,
      },
    );
  }

  async findByPhone(phone: string) {
    return this.sessionModel.findOne({ phone });
  }
}