import { Test, TestingModule } from '@nestjs/testing';
import { MessageCheckService } from './message-check.service.js';
import { Db } from 'mongodb';

describe('MessageCheckService', () => {
  let service: MessageCheckService;
  let mockCollection: { findOne: jest.Mock };
  let mockDb: { collection: jest.Mock };

  beforeEach(async () => {
    mockCollection = { findOne: jest.fn() };
    mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [MessageCheckService],
    }).compile();

    service = module.get<MessageCheckService>(MessageCheckService);
  });

  it('returns true when a processing message exists (DEP-02)', async () => {
    mockCollection.findOne.mockResolvedValue({ _id: 'msg-1' });
    const result = await service.hasProcessingMessage(
      mockDb as unknown as Db,
      'bot-x',
      'chat-y',
    );
    expect(result).toBe(true);
  });

  it('returns false when no processing message exists (DEP-05)', async () => {
    mockCollection.findOne.mockResolvedValue(null);
    const result = await service.hasProcessingMessage(
      mockDb as unknown as Db,
      'bot-x',
      'chat-y',
    );
    expect(result).toBe(false);
  });

  it('queries messages collection with both botIdentifier AND chatDataId (DEP-04)', async () => {
    mockCollection.findOne.mockResolvedValue(null);
    await service.hasProcessingMessage(
      mockDb as unknown as Db,
      'bot-x',
      'chat-y',
    );
    expect(mockDb.collection).toHaveBeenCalledWith('messages');
    expect(mockCollection.findOne).toHaveBeenCalledWith({
      botIdentifier: 'bot-x',
      chatDataId: 'chat-y',
      messageStatus: 'processing',
    });
  });

  it('uses messageStatus processing — not pending (DEP-05)', async () => {
    mockCollection.findOne.mockResolvedValue(null);
    await service.hasProcessingMessage(
      mockDb as unknown as Db,
      'bot-x',
      'chat-y',
    );
    const calledFilter = mockCollection.findOne.mock.calls[0][0];
    expect(calledFilter.messageStatus).toBe('processing');
    expect(calledFilter.messageStatus).not.toBe('pending');
  });
});
