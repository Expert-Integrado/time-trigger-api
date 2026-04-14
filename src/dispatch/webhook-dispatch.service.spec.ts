import { Test, TestingModule } from '@nestjs/testing';
import { WebhookDispatchService } from './webhook-dispatch.service.js';
import { Db, Document, ObjectId } from 'mongodb';

describe('WebhookDispatchService', () => {
  let service: WebhookDispatchService;
  let mockDb: jest.Mocked<Pick<Db, 'collection'>>;
  let mockCollection: { findOneAndUpdate: jest.Mock };
  let fetchMock: jest.Mock;

  const run: Document = {
    _id: new ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa'),
    runStatus: 'waiting',
    waitUntil: new Date('2026-01-01T08:00:00Z'),
  };

  const webhookUrl = 'https://webhook.example.com/runs';

  beforeEach(async () => {
    // Mock global fetch
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    // Mock setTimeout to run synchronously in tests
    jest.useFakeTimers({ doNotFake: [] });
    jest.spyOn(global, 'setTimeout');

    mockCollection = { findOneAndUpdate: jest.fn().mockResolvedValue(run) };
    mockDb = {
      collection: jest.fn().mockReturnValue(mockCollection),
    } as unknown as jest.Mocked<Pick<Db, 'collection'>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [WebhookDispatchService],
    }).compile();

    service = module.get<WebhookDispatchService>(WebhookDispatchService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('(DISP-01) POSTs the run document as JSON to the webhook URL', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    await service.dispatch(mockDb as unknown as Db, run, webhookUrl);

    expect(fetchMock).toHaveBeenCalledWith(
      webhookUrl,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(run),
      }),
    );
  });

  it('(DISP-06) includes AbortSignal.timeout(10000) in the fetch options', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    await service.dispatch(mockDb as unknown as Db, run, webhookUrl);

    const callOptions = fetchMock.mock.calls[0][1];
    expect(callOptions.signal).toBeDefined();
  });

  it('(DISP-02) calls findOneAndUpdate before POST (claim-first pattern)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    await service.dispatch(mockDb as unknown as Db, run, webhookUrl);

    expect(mockDb.collection).toHaveBeenCalledWith('runs');
    // Claim-first pattern: 1 call to claim (waiting→queued), no revert needed on success
    expect(mockCollection.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('(DISP-03) findOneAndUpdate filter includes both _id and runStatus: "waiting"', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    await service.dispatch(mockDb as unknown as Db, run, webhookUrl);

    const filterArg = mockCollection.findOneAndUpdate.mock.calls[0][0];
    expect(filterArg).toMatchObject({ _id: run._id, runStatus: 'waiting' });
  });

  it('(DISP-02) findOneAndUpdate $set contains runStatus: "queued" and a queuedAt Date', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    await service.dispatch(mockDb as unknown as Db, run, webhookUrl);

    const updateArg = mockCollection.findOneAndUpdate.mock.calls[0][1];
    expect(updateArg.$set.runStatus).toBe('queued');
    expect(updateArg.$set.queuedAt).toBeInstanceOf(Date);
  });

  it('(DISP-04) claims first, reverts on POST failure, and schedules retry via setTimeout(60000)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });

    await service.dispatch(mockDb as unknown as Db, run, webhookUrl);

    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 60_000);
    // Claim-first pattern: 1 call to claim (waiting→queued), 1 call to revert (queued→waiting)
    expect(mockCollection.findOneAndUpdate).toHaveBeenCalledTimes(2);
    // First call: claim
    expect(mockCollection.findOneAndUpdate).toHaveBeenNthCalledWith(
      1,
      { _id: run._id, runStatus: 'waiting' },
      { $set: { runStatus: 'queued', queuedAt: expect.any(Date) } },
    );
    // Second call: revert
    expect(mockCollection.findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      { _id: run._id, runStatus: 'queued' },
      { $set: { runStatus: 'waiting' }, $unset: { queuedAt: '' } },
    );
  });

  it('(DISP-04/DISP-05) retry uses claim-first pattern and keeps status queued when retry POST succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false }) // initial fails
      .mockResolvedValueOnce({ ok: true }); // retry succeeds

    await service.dispatch(mockDb as unknown as Db, run, webhookUrl);

    // Fast-forward the 60s timer
    await jest.runAllTimersAsync();

    // Claim-first pattern:
    // 1. Initial claim (waiting→queued)
    // 2. Initial revert (queued→waiting) after POST fails
    // 3. Retry claim (waiting→queued)
    // (no revert needed since retry POST succeeds)
    expect(mockCollection.findOneAndUpdate).toHaveBeenCalledTimes(3);
  });

  it('(DISP-05) reverts status when retry also fails (claim-first pattern)', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false }) // initial fails
      .mockResolvedValueOnce({ ok: false }); // retry also fails

    await service.dispatch(mockDb as unknown as Db, run, webhookUrl);
    await jest.runAllTimersAsync();

    // Claim-first pattern:
    // 1. Initial claim (waiting→queued)
    // 2. Initial revert (queued→waiting) after POST fails
    // 3. Retry claim (waiting→queued)
    // 4. Retry revert (queued→waiting) after retry POST fails
    expect(mockCollection.findOneAndUpdate).toHaveBeenCalledTimes(4);
  });

  it('(DISP-06) treats fetch throws as failure (triggers retry, does not propagate)', async () => {
    fetchMock
      .mockRejectedValueOnce(new DOMException('signal timed out', 'AbortError'))
      .mockResolvedValueOnce({ ok: false }); // retry also fails

    await expect(
      service.dispatch(mockDb as unknown as Db, run, webhookUrl),
    ).resolves.not.toThrow();
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 60_000);
  });

  it('returns true when findOneAndUpdate claims the run (Promise<boolean>)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    // mockCollection.findOneAndUpdate already returns run (truthy) by default

    const result = await service.dispatch(
      mockDb as unknown as Db,
      run,
      webhookUrl,
    );

    expect(result).toBe(true);
  });

  it('returns false when findOneAndUpdate returns null (already claimed)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    mockCollection.findOneAndUpdate.mockResolvedValueOnce(null);

    const result = await service.dispatch(
      mockDb as unknown as Db,
      run,
      webhookUrl,
    );

    expect(result).toBe(false);
  });

  it('returns false when HTTP post fails (retry path)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });

    const result = await service.dispatch(
      mockDb as unknown as Db,
      run,
      webhookUrl,
    );

    expect(result).toBe(false);
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 60_000);
  });
});

describe('WebhookDispatchService - dispatchFup', () => {
  let service: WebhookDispatchService;
  let mockFupCollection: { findOneAndUpdate: jest.Mock };
  let mockFupDb: jest.Mocked<Pick<Db, 'collection'>>;
  let fetchMock: jest.Mock;

  const fup: Document = {
    _id: new ObjectId('bbbbbbbbbbbbbbbbbbbbbbbb'),
    status: 'on',
    nextInteractionTimestamp: 1_000_000,
  };
  const fupWebhookUrl = 'https://webhook.example.com/fup';

  beforeEach(async () => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    jest.useFakeTimers({ doNotFake: [] });
    jest.spyOn(global, 'setTimeout');

    mockFupCollection = { findOneAndUpdate: jest.fn().mockResolvedValue(fup) };
    mockFupDb = {
      collection: jest.fn().mockReturnValue(mockFupCollection),
    } as unknown as jest.Mocked<Pick<Db, 'collection'>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [WebhookDispatchService],
    }).compile();

    service = module.get<WebhookDispatchService>(WebhookDispatchService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('(FUP-04) POSTs the fup document as JSON to the webhookUrl', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    await service.dispatchFup(mockFupDb as unknown as Db, fup, fupWebhookUrl);

    expect(fetchMock).toHaveBeenCalledWith(
      fupWebhookUrl,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(fup),
      }),
    );
  });

  it('(FUP-04) includes AbortSignal.timeout(10000) in the fetch options', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    await service.dispatchFup(mockFupDb as unknown as Db, fup, fupWebhookUrl);

    const callOptions = fetchMock.mock.calls[0][1];
    expect(callOptions.signal).toBeDefined();
  });

  it('(FUP-05) calls findOneAndUpdate on fup collection when POST succeeds', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    await service.dispatchFup(mockFupDb as unknown as Db, fup, fupWebhookUrl);

    expect(mockFupDb.collection).toHaveBeenCalledWith('fup');
    expect(mockFupCollection.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('(FUP-06) findOneAndUpdate filter includes { _id: fupId, status: "on" }', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    await service.dispatchFup(mockFupDb as unknown as Db, fup, fupWebhookUrl);

    const filterArg = mockFupCollection.findOneAndUpdate.mock.calls[0][0];
    expect(filterArg).toMatchObject({ _id: fup._id, status: 'on' });
  });

  it('(FUP-05) findOneAndUpdate $set contains { status: "queued" } (no queuedAt)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    await service.dispatchFup(mockFupDb as unknown as Db, fup, fupWebhookUrl);

    const updateArg = mockFupCollection.findOneAndUpdate.mock.calls[0][1];
    expect(updateArg.$set.status).toBe('queued');
    expect(updateArg.$set.queuedAt).toBeUndefined();
  });

  it('(FUP-07) claims first, reverts on POST failure, and schedules retry via setTimeout(60000)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });

    await service.dispatchFup(mockFupDb as unknown as Db, fup, fupWebhookUrl);

    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 60_000);
    // Claim-first pattern: 1 call to claim (on→queued), 1 call to revert (queued→on)
    expect(mockFupCollection.findOneAndUpdate).toHaveBeenCalledTimes(2);
    // First call: claim
    expect(mockFupCollection.findOneAndUpdate).toHaveBeenNthCalledWith(
      1,
      { _id: fup._id, status: 'on' },
      { $set: { status: 'queued' } },
    );
    // Second call: revert
    expect(mockFupCollection.findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      { _id: fup._id, status: 'queued' },
      { $set: { status: 'on' } },
    );
  });

  it('(FUP-08) retry uses claim-first pattern and keeps status queued when retry POST succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false }) // initial fails
      .mockResolvedValueOnce({ ok: true }); // retry succeeds

    await service.dispatchFup(mockFupDb as unknown as Db, fup, fupWebhookUrl);

    await jest.runAllTimersAsync();

    // Claim-first pattern:
    // 1. Initial claim (on→queued)
    // 2. Initial revert (queued→on) after POST fails
    // 3. Retry claim (on→queued)
    // (no revert needed since retry POST succeeds)
    expect(mockFupCollection.findOneAndUpdate).toHaveBeenCalledTimes(3);
  });

  it('(FUP-08) reverts status when retry also fails (claim-first pattern)', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false }) // initial fails
      .mockResolvedValueOnce({ ok: false }); // retry also fails

    await service.dispatchFup(mockFupDb as unknown as Db, fup, fupWebhookUrl);
    await jest.runAllTimersAsync();

    // Claim-first pattern:
    // 1. Initial claim (on→queued)
    // 2. Initial revert (queued→on) after POST fails
    // 3. Retry claim (on→queued)
    // 4. Retry revert (queued→on) after retry POST fails
    expect(mockFupCollection.findOneAndUpdate).toHaveBeenCalledTimes(4);
  });

  it('fetch throw treats as failure (schedules retry, does not propagate)', async () => {
    fetchMock
      .mockRejectedValueOnce(new DOMException('signal timed out', 'AbortError'))
      .mockResolvedValueOnce({ ok: false }); // retry also fails

    await expect(
      service.dispatchFup(mockFupDb as unknown as Db, fup, fupWebhookUrl),
    ).resolves.not.toThrow();
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 60_000);
  });

  it('returns true when findOneAndUpdate claims the FUP (Promise<boolean>)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    // mockFupCollection.findOneAndUpdate already returns fup (truthy) by default

    const result = await service.dispatchFup(
      mockFupDb as unknown as Db,
      fup,
      fupWebhookUrl,
    );

    expect(result).toBe(true);
  });

  it('returns false when FUP already claimed (findOneAndUpdate returns null)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    mockFupCollection.findOneAndUpdate.mockResolvedValueOnce(null);

    const result = await service.dispatchFup(
      mockFupDb as unknown as Db,
      fup,
      fupWebhookUrl,
    );

    expect(result).toBe(false);
  });
});

describe('WebhookDispatchService - dispatchMessage', () => {
  let service: WebhookDispatchService;
  let mockMsgCollection: { findOneAndUpdate: jest.Mock };
  let mockMsgDb: jest.Mocked<Pick<Db, 'collection'>>;
  let fetchMock: jest.Mock;

  const message: Document = {
    _id: new ObjectId('cccccccccccccccccccccccc'),
    messageStatus: 'pending',
  };
  const messagesWebhookUrl = 'https://webhook.example.com/messages';

  beforeEach(async () => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    jest.useFakeTimers({ doNotFake: [] });
    jest.spyOn(global, 'setTimeout');

    mockMsgCollection = {
      findOneAndUpdate: jest.fn().mockResolvedValue(message),
    };
    mockMsgDb = {
      collection: jest.fn().mockReturnValue(mockMsgCollection),
    } as unknown as jest.Mocked<Pick<Db, 'collection'>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [WebhookDispatchService],
    }).compile();

    service = module.get<WebhookDispatchService>(WebhookDispatchService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('(MSG-04) POSTs message document as JSON to webhookUrl', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    await service.dispatchMessage(
      mockMsgDb as unknown as Db,
      message,
      messagesWebhookUrl,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      messagesWebhookUrl,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(message),
      }),
    );
  });

  it('(MSG-04) includes AbortSignal.timeout(10000)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    await service.dispatchMessage(
      mockMsgDb as unknown as Db,
      message,
      messagesWebhookUrl,
    );

    const callOptions = fetchMock.mock.calls[0][1];
    expect(callOptions.signal).toBeDefined();
  });

  it('(MSG-05) calls findOneAndUpdate before POST (claim-first pattern)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    await service.dispatchMessage(
      mockMsgDb as unknown as Db,
      message,
      messagesWebhookUrl,
    );

    expect(mockMsgDb.collection).toHaveBeenCalledWith('messages');
    // Claim-first pattern: 1 call to claim (pending→processing), no revert needed on success
    expect(mockMsgCollection.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('(MSG-06) findOneAndUpdate filter includes { _id: messageId, messageStatus: "pending" }', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    await service.dispatchMessage(
      mockMsgDb as unknown as Db,
      message,
      messagesWebhookUrl,
    );

    const filterArg = mockMsgCollection.findOneAndUpdate.mock.calls[0][0];
    expect(filterArg).toMatchObject({
      _id: message._id,
      messageStatus: 'pending',
    });
  });

  it('(MSG-05) findOneAndUpdate $set contains { messageStatus: "processing" }', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    await service.dispatchMessage(
      mockMsgDb as unknown as Db,
      message,
      messagesWebhookUrl,
    );

    const updateArg = mockMsgCollection.findOneAndUpdate.mock.calls[0][1];
    expect(updateArg.$set.messageStatus).toBe('processing');
  });

  it('(MSG-07) claims first, reverts on POST failure, and schedules retry via setTimeout(60000)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });

    await service.dispatchMessage(
      mockMsgDb as unknown as Db,
      message,
      messagesWebhookUrl,
    );

    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 60_000);
    // Claim-first pattern: 1 call to claim (pending→processing), 1 call to revert (processing→pending)
    expect(mockMsgCollection.findOneAndUpdate).toHaveBeenCalledTimes(2);
    // First call: claim
    expect(mockMsgCollection.findOneAndUpdate).toHaveBeenNthCalledWith(
      1,
      { _id: message._id, messageStatus: 'pending' },
      {
        $set: {
          messageStatus: 'processing',
          processingStartedAt: expect.any(Date),
        },
      },
    );
    // Second call: revert
    expect(mockMsgCollection.findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      { _id: message._id, messageStatus: 'processing' },
      {
        $set: { messageStatus: 'pending' },
        $unset: { processingStartedAt: '' },
      },
    );
  });

  it('(MSG-07) retry uses claim-first pattern and keeps status processing when retry POST succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false }) // initial fails
      .mockResolvedValueOnce({ ok: true }); // retry succeeds

    await service.dispatchMessage(
      mockMsgDb as unknown as Db,
      message,
      messagesWebhookUrl,
    );

    await jest.runAllTimersAsync();

    // Claim-first pattern:
    // 1. Initial claim (pending→processing)
    // 2. Initial revert (processing→pending) after POST fails
    // 3. Retry claim (pending→processing)
    // (no revert needed since retry POST succeeds)
    expect(mockMsgCollection.findOneAndUpdate).toHaveBeenCalledTimes(3);
  });

  it('(MSG-08) reverts status when retry also fails (claim-first pattern)', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false }) // initial fails
      .mockResolvedValueOnce({ ok: false }); // retry also fails

    await service.dispatchMessage(
      mockMsgDb as unknown as Db,
      message,
      messagesWebhookUrl,
    );
    await jest.runAllTimersAsync();

    // Claim-first pattern:
    // 1. Initial claim (pending→processing)
    // 2. Initial revert (processing→pending) after POST fails
    // 3. Retry claim (pending→processing)
    // 4. Retry revert (processing→pending) after retry POST fails
    expect(mockMsgCollection.findOneAndUpdate).toHaveBeenCalledTimes(4);
  });

  it('fetch throw treated as failure (schedules retry, does not propagate)', async () => {
    fetchMock
      .mockRejectedValueOnce(new DOMException('signal timed out', 'AbortError'))
      .mockResolvedValueOnce({ ok: false }); // retry also fails

    await expect(
      service.dispatchMessage(
        mockMsgDb as unknown as Db,
        message,
        messagesWebhookUrl,
      ),
    ).resolves.not.toThrow();
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 60_000);
  });

  it('returns true when findOneAndUpdate claims the message (Promise<boolean>)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    // mockMsgCollection.findOneAndUpdate already returns message (truthy) by default

    const result = await service.dispatchMessage(
      mockMsgDb as unknown as Db,
      message,
      messagesWebhookUrl,
    );

    expect(result).toBe(true);
  });

  it('returns false when message already claimed (findOneAndUpdate returns null)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    mockMsgCollection.findOneAndUpdate.mockResolvedValueOnce(null);

    const result = await service.dispatchMessage(
      mockMsgDb as unknown as Db,
      message,
      messagesWebhookUrl,
    );

    expect(result).toBe(false);
  });

  describe('processingStartedAt (DEP-01)', () => {
    it('sets processingStartedAt in main dispatch path when message is claimed', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true });

      await service.dispatchMessage(
        mockMsgDb as unknown as Db,
        message,
        messagesWebhookUrl,
      );

      expect(mockMsgCollection.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: message._id, messageStatus: 'pending' },
        {
          $set: {
            messageStatus: 'processing',
            processingStartedAt: expect.any(Date),
          },
        },
      );
    });

    it('sets processingStartedAt in retry path when message is claimed via retry', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: false }) // initial fails
        .mockResolvedValueOnce({ ok: true }); // retry succeeds

      await service.dispatchMessage(
        mockMsgDb as unknown as Db,
        message,
        messagesWebhookUrl,
      );

      await jest.runAllTimersAsync();

      const updateArg = mockMsgCollection.findOneAndUpdate.mock.calls[0][1];
      expect(updateArg.$set.processingStartedAt).toEqual(expect.any(Date));
    });
  });
});
