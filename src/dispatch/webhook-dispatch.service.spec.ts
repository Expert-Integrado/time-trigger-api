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

  it('(DISP-02) calls findOneAndUpdate when POST succeeds', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    await service.dispatch(mockDb as unknown as Db, run, webhookUrl);

    expect(mockDb.collection).toHaveBeenCalledWith('runs');
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

  it('(DISP-04) schedules a retry via setTimeout(60000) when POST fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });

    await service.dispatch(mockDb as unknown as Db, run, webhookUrl);

    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('(DISP-04/DISP-05) retry calls findOneAndUpdate when retry POST succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false }) // initial fails
      .mockResolvedValueOnce({ ok: true }); // retry succeeds

    await service.dispatch(mockDb as unknown as Db, run, webhookUrl);

    // Fast-forward the 60s timer
    await jest.runAllTimersAsync();

    expect(mockCollection.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('(DISP-05) does NOT call findOneAndUpdate when retry also fails', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false }) // initial fails
      .mockResolvedValueOnce({ ok: false }); // retry also fails

    await service.dispatch(mockDb as unknown as Db, run, webhookUrl);
    await jest.runAllTimersAsync();

    expect(mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
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

  it('(FUP-07) schedules retry via setTimeout(60000) when POST fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });

    await service.dispatchFup(mockFupDb as unknown as Db, fup, fupWebhookUrl);

    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(mockFupCollection.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('(FUP-08) retry calls findOneAndUpdate when retry POST succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false }) // initial fails
      .mockResolvedValueOnce({ ok: true }); // retry succeeds

    await service.dispatchFup(mockFupDb as unknown as Db, fup, fupWebhookUrl);

    await jest.runAllTimersAsync();

    expect(mockFupCollection.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('(FUP-08) does NOT call findOneAndUpdate when retry also fails', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false }) // initial fails
      .mockResolvedValueOnce({ ok: false }); // retry also fails

    await service.dispatchFup(mockFupDb as unknown as Db, fup, fupWebhookUrl);
    await jest.runAllTimersAsync();

    expect(mockFupCollection.findOneAndUpdate).not.toHaveBeenCalled();
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

    mockMsgCollection = { findOneAndUpdate: jest.fn().mockResolvedValue(message) };
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

    await service.dispatchMessage(mockMsgDb as unknown as Db, message, messagesWebhookUrl);

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

    await service.dispatchMessage(mockMsgDb as unknown as Db, message, messagesWebhookUrl);

    const callOptions = fetchMock.mock.calls[0][1];
    expect(callOptions.signal).toBeDefined();
  });

  it('(MSG-05) calls findOneAndUpdate on messages collection when POST succeeds', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    await service.dispatchMessage(mockMsgDb as unknown as Db, message, messagesWebhookUrl);

    expect(mockMsgDb.collection).toHaveBeenCalledWith('messages');
    expect(mockMsgCollection.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('(MSG-06) findOneAndUpdate filter includes { _id: messageId, messageStatus: "pending" }', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    await service.dispatchMessage(mockMsgDb as unknown as Db, message, messagesWebhookUrl);

    const filterArg = mockMsgCollection.findOneAndUpdate.mock.calls[0][0];
    expect(filterArg).toMatchObject({ _id: message._id, messageStatus: 'pending' });
  });

  it('(MSG-05) findOneAndUpdate $set contains { messageStatus: "processing" }', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    await service.dispatchMessage(mockMsgDb as unknown as Db, message, messagesWebhookUrl);

    const updateArg = mockMsgCollection.findOneAndUpdate.mock.calls[0][1];
    expect(updateArg.$set.messageStatus).toBe('processing');
  });

  it('(MSG-07) schedules retry via setTimeout(60000) when POST fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });

    await service.dispatchMessage(mockMsgDb as unknown as Db, message, messagesWebhookUrl);

    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(mockMsgCollection.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('(MSG-07) retry calls findOneAndUpdate when retry POST succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false }) // initial fails
      .mockResolvedValueOnce({ ok: true }); // retry succeeds

    await service.dispatchMessage(mockMsgDb as unknown as Db, message, messagesWebhookUrl);

    await jest.runAllTimersAsync();

    expect(mockMsgCollection.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('(MSG-08) does NOT call findOneAndUpdate when retry also fails', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false }) // initial fails
      .mockResolvedValueOnce({ ok: false }); // retry also fails

    await service.dispatchMessage(mockMsgDb as unknown as Db, message, messagesWebhookUrl);
    await jest.runAllTimersAsync();

    expect(mockMsgCollection.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('fetch throw treated as failure (schedules retry, does not propagate)', async () => {
    fetchMock
      .mockRejectedValueOnce(new DOMException('signal timed out', 'AbortError'))
      .mockResolvedValueOnce({ ok: false }); // retry also fails

    await expect(
      service.dispatchMessage(mockMsgDb as unknown as Db, message, messagesWebhookUrl),
    ).resolves.not.toThrow();
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 60_000);
  });
});
