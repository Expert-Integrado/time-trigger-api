import { Injectable } from '@nestjs/common';
import { Db } from 'mongodb';

@Injectable()
export class MessageCheckService {
  async hasProcessingMessage(
    db: Db,
    botIdentifier: string,
    chatDataId: string,
  ): Promise<boolean> {
    const doc = await db.collection('messages').findOne({
      botIdentifier,
      chatDataId,
      messageStatus: 'processing',
    });
    return doc !== null;
  }
}
