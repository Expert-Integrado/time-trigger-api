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

  it('returns true when a non-done message exists', async () => {
    mockCollection.findOne.mockResolvedValue({ _id: 'msg-1' });
    const result = await service.hasProcessingMessage(
      mockDb as unknown as Db,
      'bot-x',
      'chat-y',
    );
    expect(result).toBe(true);
  });

  it('returns false when no non-done message exists', async () => {
    mockCollection.findOne.mockResolvedValue(null);
    const result = await service.hasProcessingMessage(
      mockDb as unknown as Db,
      'bot-x',
      'chat-y',
    );
    expect(result).toBe(false);
  });

  it("queries messages collection with botIdentifier, chatDataId, and messageStatus $ne 'done'", async () => {
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
      messageStatus: { $ne: 'done' },
    });
  });

  it("uses messageStatus $ne 'done' — not a fixed 'processing' match", async () => {
    mockCollection.findOne.mockResolvedValue(null);
    await service.hasProcessingMessage(
      mockDb as unknown as Db,
      'bot-x',
      'chat-y',
    );
    const calledFilter = mockCollection.findOne.mock.calls[0][0];
    expect(typeof calledFilter.messageStatus).toBe('object');
    expect(calledFilter.messageStatus.$ne).toBe('done');
    expect(calledFilter.messageStatus).not.toBe('processing');
    expect(calledFilter.messageStatus).not.toBe('pending');
  });
});
