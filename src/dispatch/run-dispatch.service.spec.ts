import { Test, TestingModule } from '@nestjs/testing';
import { RunDispatchService } from './run-dispatch.service.js';
import { WebhookDispatchService } from './webhook-dispatch.service.js';
import { MongoService } from '../mongo/mongo.service.js';
import { DatabaseScanService } from '../database/database-scan.service.js';
import { Db } from 'mongodb';

describe('RunDispatchService', () => {
  let service: RunDispatchService;
  let webhookDispatchService: jest.Mocked<WebhookDispatchService>;
  let mongoService: jest.Mocked<MongoService>;
  let databaseScanService: jest.Mocked<DatabaseScanService>;

  // Helpers for building mock Db handles
  const makeDb = (
    vars: Record<string, unknown> | null,
    webhooks: Record<string, unknown> | null,
    runs: Record<string, unknown>[],
    fups: Record<string, unknown>[] = [],
    messages: Record<string, unknown>[] = [],
  ) => {
    const mockRunsFind = { toArray: jest.fn().mockResolvedValue(runs) };
    const mockFupsFind = { toArray: jest.fn().mockResolvedValue(fups) };
    const mockMessagesFind = { toArray: jest.fn().mockResolvedValue(messages) };
    const collections: Record<
      string,
      { findOne?: jest.Mock; find?: jest.Mock }
    > = {
      vars: { findOne: jest.fn().mockResolvedValue(vars) },
      webhooks: { findOne: jest.fn().mockResolvedValue(webhooks) },
      runs: { find: jest.fn().mockReturnValue(mockRunsFind) },
      fup: { find: jest.fn().mockReturnValue(mockFupsFind) },
      messages: { find: jest.fn().mockReturnValue(mockMessagesFind) },
    };
    return {
      collection: jest.fn((name: string) => collections[name]),
      _collections: collections,
    } as unknown as Db & { _collections: typeof collections };
  };

  const eligibleRun = {
    _id: 'run-001',
    runStatus: 'waiting',
    waitUntil: new Date('2020-01-01'),
  };

  const allowedDay = 1; // segunda-feira

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RunDispatchService,
        {
          provide: WebhookDispatchService,
          useValue: {
            dispatch: jest.fn().mockResolvedValue(undefined),
            dispatchFup: jest.fn().mockResolvedValue(undefined),
            dispatchMessage: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: MongoService,
          useValue: { db: jest.fn() },
        },
        {
          provide: DatabaseScanService,
          useValue: {
            getEligibleDatabases: jest.fn().mockResolvedValue(['test-db']),
          },
        },
      ],
    }).compile();

    service = module.get<RunDispatchService>(RunDispatchService);
    webhookDispatchService = module.get(WebhookDispatchService);
    mongoService = module.get(MongoService);
    databaseScanService = module.get(DatabaseScanService);
  });

  const withinWindowVars = {
    timeTrigger: {
      enabled: true,
      morningLimit: 8,
      nightLimit: 22,
      allowedDays: [0, 1, 2, 3, 4, 5, 6],
    },
  };
  const eligibleFup = {
    _id: 'fup-001',
    status: 'on',
    nextInteractionTimestamp: 1_000, // valor no passado
  };

  const webhooksDoc = {
    'Processador de Runs': 'https://hook.example.com',
    'Gerenciador follow up': 'https://fup.example.com',
  };

  // ---- runRunsCycle tests ----

  it('(DETECT-01) queries runs collection with runStatus:waiting and waitUntil <= now', async () => {
    const db = makeDb(withinWindowVars, webhooksDoc, []);
    mongoService.db.mockReturnValue(db as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
    jest.spyOn(Date.prototype, 'getDay').mockReturnValue(allowedDay);

    await service.runRunsCycle();

    const runsCollectionFind = (db as any)._collections.runs.find;
    expect(runsCollectionFind).toHaveBeenCalledWith(
      expect.objectContaining({
        runStatus: 'waiting',
        waitUntil: expect.objectContaining({ $lte: expect.any(Number) }),
      }),
    );
    jest.restoreAllMocks();
  });

  it('(DETECT-02) reads vars fresh on each processDatabaseRuns call (no caching)', async () => {
    const db = makeDb(withinWindowVars, webhooksDoc, []);
    mongoService.db.mockReturnValue(db as unknown as Db);
    databaseScanService.getEligibleDatabases
      .mockResolvedValueOnce(['db-1'])
      .mockResolvedValueOnce(['db-1']);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
    jest.spyOn(Date.prototype, 'getDay').mockReturnValue(allowedDay);

    await service.runRunsCycle();
    // Reset call count
    const varsFindOne = (db as any)._collections.vars.findOne as jest.Mock;
    const firstCallCount = varsFindOne.mock.calls.length;

    await service.runRunsCycle();
    const secondCallCount = varsFindOne.mock.calls.length;

    expect(secondCallCount).toBeGreaterThan(firstCallCount);
    jest.restoreAllMocks();
  });

  it('(DETECT-03) reads webhooks fresh on each processDatabaseRuns call (no caching)', async () => {
    const db = makeDb(withinWindowVars, webhooksDoc, []);
    mongoService.db.mockReturnValue(db as unknown as Db);
    databaseScanService.getEligibleDatabases
      .mockResolvedValueOnce(['db-1'])
      .mockResolvedValueOnce(['db-1']);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
    jest.spyOn(Date.prototype, 'getDay').mockReturnValue(allowedDay);

    await service.runRunsCycle();
    const webhooksFindOne = (db as any)._collections.webhooks
      .findOne as jest.Mock;
    const firstCallCount = webhooksFindOne.mock.calls.length;

    await service.runRunsCycle();
    const secondCallCount = webhooksFindOne.mock.calls.length;

    expect(secondCallCount).toBeGreaterThan(firstCallCount);
    jest.restoreAllMocks();
  });

  it('(TRIG-01) skips when timeTrigger field is absent from vars', async () => {
    const db = makeDb({ botIdentifier: 'x' }, webhooksDoc, [eligibleRun]);
    mongoService.db.mockReturnValue(db as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
    jest.spyOn(Date.prototype, 'getDay').mockReturnValue(allowedDay);

    await service.runRunsCycle();

    expect(webhookDispatchService.dispatch).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('(TRIG-02) skips when vars document is null', async () => {
    const db = makeDb(null, webhooksDoc, [eligibleRun]);
    mongoService.db.mockReturnValue(db as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
    jest.spyOn(Date.prototype, 'getDay').mockReturnValue(allowedDay);

    await service.runRunsCycle();

    expect(webhookDispatchService.dispatch).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('(TRIG-03) skips when timeTrigger.enabled is false', async () => {
    const db = makeDb(
      {
        timeTrigger: {
          enabled: false,
          morningLimit: 8,
          nightLimit: 22,
          allowedDays: [0, 1, 2, 3, 4, 5, 6],
        },
      },
      webhooksDoc,
      [eligibleRun],
    );
    mongoService.db.mockReturnValue(db as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
    jest.spyOn(Date.prototype, 'getDay').mockReturnValue(allowedDay);

    await service.runRunsCycle();

    expect(webhookDispatchService.dispatch).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('(TRIG-04) skips when currentHour < timeTrigger.morningLimit', async () => {
    const db = makeDb(
      {
        timeTrigger: {
          enabled: true,
          morningLimit: 8,
          nightLimit: 22,
          allowedDays: [0, 1, 2, 3, 4, 5, 6],
        },
      },
      webhooksDoc,
      [eligibleRun],
    );
    mongoService.db.mockReturnValue(db as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(6); // before 8am
    jest.spyOn(Date.prototype, 'getDay').mockReturnValue(allowedDay);

    await service.runRunsCycle();

    expect(webhookDispatchService.dispatch).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('(TRIG-04) skips when currentHour >= timeTrigger.nightLimit', async () => {
    const db = makeDb(
      {
        timeTrigger: {
          enabled: true,
          morningLimit: 8,
          nightLimit: 20,
          allowedDays: [0, 1, 2, 3, 4, 5, 6],
        },
      },
      webhooksDoc,
      [eligibleRun],
    );
    mongoService.db.mockReturnValue(db as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(23); // after 8pm
    jest.spyOn(Date.prototype, 'getDay').mockReturnValue(allowedDay);

    await service.runRunsCycle();

    expect(webhookDispatchService.dispatch).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('(TRIG-04) dispatches when currentHour within timeTrigger window', async () => {
    const db = makeDb(
      {
        timeTrigger: {
          enabled: true,
          morningLimit: 8,
          nightLimit: 22,
          allowedDays: [0, 1, 2, 3, 4, 5, 6],
        },
      },
      webhooksDoc,
      [eligibleRun],
    );
    mongoService.db.mockReturnValue(db as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10); // within window
    jest.spyOn(Date.prototype, 'getDay').mockReturnValue(allowedDay);

    await service.runRunsCycle();

    expect(webhookDispatchService.dispatch).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });

  it('(TRIG-06) skips when currentDay not in timeTrigger.allowedDays', async () => {
    const db = makeDb(
      {
        timeTrigger: {
          enabled: true,
          morningLimit: 8,
          nightLimit: 22,
          allowedDays: [1, 2, 3, 4, 5],
        },
      },
      webhooksDoc,
      [eligibleRun],
    );
    mongoService.db.mockReturnValue(db as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
    jest.spyOn(Date.prototype, 'getDay').mockReturnValue(0); // domingo, não permitido

    await service.runRunsCycle();

    expect(webhookDispatchService.dispatch).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('(TRIG-05/TRIG-06) dispatches when currentDay in timeTrigger.allowedDays', async () => {
    const db = makeDb(
      {
        timeTrigger: {
          enabled: true,
          morningLimit: 8,
          nightLimit: 22,
          allowedDays: [1, 2, 3, 4, 5],
        },
      },
      webhooksDoc,
      [eligibleRun],
    );
    mongoService.db.mockReturnValue(db as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
    jest.spyOn(Date.prototype, 'getDay').mockReturnValue(1); // segunda, permitido

    await service.runRunsCycle();

    expect(webhookDispatchService.dispatch).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });

  it('skips database and logs warning when vars document is null', async () => {
    const db = makeDb(null, webhooksDoc, [eligibleRun]);
    mongoService.db.mockReturnValue(db as unknown as Db);
    const warnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => {});

    await expect(service.runRunsCycle()).resolves.not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('timeTrigger'),
    );
    expect(webhookDispatchService.dispatch).not.toHaveBeenCalled();
  });

  it('skips database and logs warning when vars is missing timeTrigger', async () => {
    const db = makeDb({ botIdentifier: 'x' }, webhooksDoc, [eligibleRun]);
    mongoService.db.mockReturnValue(db as unknown as Db);
    const warnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => {});

    await expect(service.runRunsCycle()).resolves.not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    expect(webhookDispatchService.dispatch).not.toHaveBeenCalled();
  });

  it('skips database and logs warning when "Processador de Runs" URL is missing', async () => {
    const db = makeDb(withinWindowVars, {}, [eligibleRun]);
    mongoService.db.mockReturnValue(db as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
    jest.spyOn(Date.prototype, 'getDay').mockReturnValue(allowedDay);
    const warnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => {});

    await expect(service.runRunsCycle()).resolves.not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Processador de Runs'),
    );
    expect(webhookDispatchService.dispatch).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('(SCHED-03) does not re-enter runRunsCycle if isRunningRuns is true', async () => {
    // Simulate a slow cycle by making getEligibleDatabases hang
    let resolveFirst: () => void;
    const firstCyclePromise = new Promise<void>((res) => {
      resolveFirst = res;
    });
    databaseScanService.getEligibleDatabases.mockReturnValueOnce(
      firstCyclePromise.then(() => []),
    );

    const warnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => {});

    // Start first cycle (does not complete yet)
    const firstCycle = service.runRunsCycle();

    // Second cycle fires while first is still running
    await service.runRunsCycle();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Runs cycle skipped'),
    );

    // Finish first cycle
    resolveFirst!();
    await firstCycle;
  });

  it('(SCHED-03) resets isRunningRuns to false after runRunsCycle throws', async () => {
    databaseScanService.getEligibleDatabases.mockRejectedValueOnce(
      new Error('DB scan failed'),
    );

    await service.runRunsCycle(); // should not throw — error swallowed inside try/finally

    // isRunningRuns must be false — next cycle should not be skipped
    const warnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => {});
    databaseScanService.getEligibleDatabases.mockResolvedValueOnce([]);

    await service.runRunsCycle();

    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Runs cycle skipped'),
    );
  });

  it('(CONN-06) a failing DB does not prevent other DBs from being processed', async () => {
    const goodDb = makeDb(withinWindowVars, webhooksDoc, [eligibleRun]);
    const failingDbName = 'bad-db';
    const goodDbName = 'good-db';

    databaseScanService.getEligibleDatabases.mockResolvedValue([
      failingDbName,
      goodDbName,
    ]);
    mongoService.db.mockImplementation((name: string) => {
      if (name === failingDbName) throw new Error('connection refused');
      return goodDb as unknown as Db;
    });
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
    jest.spyOn(Date.prototype, 'getDay').mockReturnValue(allowedDay);

    await expect(service.runRunsCycle()).resolves.not.toThrow();
    expect(webhookDispatchService.dispatch).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });

  it('(CONN-06) cycle log includes DB count and error count after allSettled', async () => {
    const goodDb = makeDb(withinWindowVars, webhooksDoc, []);
    databaseScanService.getEligibleDatabases.mockResolvedValue([
      'db-a',
      'db-b',
    ]);
    mongoService.db.mockImplementation((name: string) => {
      if (name === 'db-b') throw new Error('oops');
      return goodDb as unknown as Db;
    });
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
    jest.spyOn(Date.prototype, 'getDay').mockReturnValue(allowedDay);
    const logSpy = jest
      .spyOn((service as any).logger, 'log')
      .mockImplementation(() => {});

    await service.runRunsCycle();

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/2 DBs.*1 errors/),
    );
    jest.restoreAllMocks();
  });

  // ---- FUP tests (via runRunsCycle — both share timeTrigger gate) ----

  it('(FUP-01) queries fup collection with { status: "on", nextInteractionTimestamp: { $lte: <number> } }', async () => {
    const db = makeDb(withinWindowVars, webhooksDoc, [], [eligibleFup]);
    mongoService.db.mockReturnValue(db as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
    jest.spyOn(Date.prototype, 'getDay').mockReturnValue(allowedDay);

    await service.runRunsCycle();

    const fupCollectionFind = (db as any)._collections.fup.find;
    expect(fupCollectionFind).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'on',
        nextInteractionTimestamp: expect.objectContaining({
          $lte: expect.any(Number),
        }),
      }),
    );
    jest.restoreAllMocks();
  });

  it('(FUP-02/FUP-03) FUP is NOT dispatched when outside time window (currentHour < morningLimit)', async () => {
    const db = makeDb(withinWindowVars, webhooksDoc, [], [eligibleFup]);
    mongoService.db.mockReturnValue(db as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(5); // before morningLimit
    jest.spyOn(Date.prototype, 'getDay').mockReturnValue(allowedDay);

    await service.runRunsCycle();

    expect(webhookDispatchService.dispatchFup).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('(FUP-02/FUP-03) FUP is NOT dispatched when day not in allowedDays', async () => {
    const restrictedVars = {
      timeTrigger: {
        enabled: true,
        morningLimit: 8,
        nightLimit: 22,
        allowedDays: [1, 2, 3, 4, 5], // só dias úteis
      },
    };
    const dbRestricted = makeDb(restrictedVars, webhooksDoc, [], [eligibleFup]);
    mongoService.db.mockReturnValue(dbRestricted as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
    jest.spyOn(Date.prototype, 'getDay').mockReturnValue(0); // domingo, não em allowedDays limitado

    await service.runRunsCycle();

    expect(webhookDispatchService.dispatchFup).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('(FUP-09) dispatchFup is called for each eligible FUP within window', async () => {
    const fup2 = {
      _id: 'fup-002',
      status: 'on',
      nextInteractionTimestamp: 500,
    };
    const db = makeDb(withinWindowVars, webhooksDoc, [], [eligibleFup, fup2]);
    mongoService.db.mockReturnValue(db as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
    jest.spyOn(Date.prototype, 'getDay').mockReturnValue(allowedDay);

    await service.runRunsCycle();

    expect(webhookDispatchService.dispatchFup).toHaveBeenCalledTimes(2);
    expect(webhookDispatchService.dispatchFup).toHaveBeenCalledWith(
      expect.anything(),
      eligibleFup,
      'https://fup.example.com',
    );
    jest.restoreAllMocks();
  });

  it('(FUP-09) runRunsCycle dispatches both runs and FUPs (both share timeTrigger gate)', async () => {
    const db = makeDb(
      withinWindowVars,
      webhooksDoc,
      [eligibleRun],
      [eligibleFup],
    );
    mongoService.db.mockReturnValue(db as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
    jest.spyOn(Date.prototype, 'getDay').mockReturnValue(allowedDay);

    await service.runRunsCycle();

    expect(webhookDispatchService.dispatch).toHaveBeenCalledTimes(1);
    expect(webhookDispatchService.dispatchFup).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });

  it('FUP URL absent → logs warn and does NOT call dispatchFup, but runs still dispatched', async () => {
    const webhooksWithoutFup = {
      'Processador de Runs': 'https://hook.example.com',
    };
    const db = makeDb(
      withinWindowVars,
      webhooksWithoutFup,
      [eligibleRun],
      [eligibleFup],
    );
    mongoService.db.mockReturnValue(db as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
    jest.spyOn(Date.prototype, 'getDay').mockReturnValue(allowedDay);
    const warnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => {});

    await service.runRunsCycle();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('FUP'));
    expect(webhookDispatchService.dispatchFup).not.toHaveBeenCalled();
    expect(webhookDispatchService.dispatch).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });

  // ---- runFupCycle tests ----

  it('(SCHED-03) does not re-enter runFupCycle if isRunningFup is true', async () => {
    let resolveFirst: () => void;
    const firstCyclePromise = new Promise<void>((res) => {
      resolveFirst = res;
    });
    databaseScanService.getEligibleDatabases.mockReturnValueOnce(
      firstCyclePromise.then(() => []),
    );

    const warnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => {});

    const firstCycle = service.runFupCycle();
    await service.runFupCycle();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('FUP cycle skipped'),
    );

    resolveFirst!();
    await firstCycle;
  });

  it('(SCHED-03) resets isRunningFup to false after runFupCycle throws', async () => {
    databaseScanService.getEligibleDatabases.mockRejectedValueOnce(
      new Error('DB scan failed'),
    );

    await service.runFupCycle();

    const warnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => {});
    databaseScanService.getEligibleDatabases.mockResolvedValueOnce([]);

    await service.runFupCycle();

    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('FUP cycle skipped'),
    );
  });

  it('runFupCycle dispatches FUPs within time window', async () => {
    const db = makeDb(withinWindowVars, webhooksDoc, [], [eligibleFup]);
    mongoService.db.mockReturnValue(db as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
    jest.spyOn(Date.prototype, 'getDay').mockReturnValue(allowedDay);

    await service.runFupCycle();

    expect(webhookDispatchService.dispatchFup).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });

  it('runFupCycle does NOT dispatch FUPs outside time window', async () => {
    const db = makeDb(withinWindowVars, webhooksDoc, [], [eligibleFup]);
    mongoService.db.mockReturnValue(db as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(3); // before morningLimit
    jest.spyOn(Date.prototype, 'getDay').mockReturnValue(allowedDay);

    await service.runFupCycle();

    expect(webhookDispatchService.dispatchFup).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  // ---- runMessagesCycle tests ----

  it('(SCHED-03) does not re-enter runMessagesCycle if isRunningMessages is true', async () => {
    let resolveFirst: () => void;
    const firstCyclePromise = new Promise<void>((res) => {
      resolveFirst = res;
    });
    databaseScanService.getEligibleDatabases.mockReturnValueOnce(
      firstCyclePromise.then(() => []),
    );

    const warnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => {});

    const firstCycle = service.runMessagesCycle();
    await service.runMessagesCycle();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Messages cycle skipped'),
    );

    resolveFirst!();
    await firstCycle;
  });

  it('(SCHED-03) resets isRunningMessages to false after runMessagesCycle throws', async () => {
    databaseScanService.getEligibleDatabases.mockRejectedValueOnce(
      new Error('DB scan failed'),
    );

    await service.runMessagesCycle();

    const warnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => {});
    databaseScanService.getEligibleDatabases.mockResolvedValueOnce([]);

    await service.runMessagesCycle();

    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Messages cycle skipped'),
    );
  });

  // ---- Messages tests (via runMessagesCycle) ----

  const eligibleMessage = {
    _id: 'msg-001',
    messageStatus: 'pending',
  };

  const webhooksDocWithMessages = {
    'Processador de Runs': 'https://hook.example.com',
    'Gerenciador follow up': 'https://fup.example.com',
    'mensagens pendentes': 'https://messages.example.com',
  };

  it('(MSG-01) queries messages collection with { messageStatus: "pending" } — no timestamp condition', async () => {
    const db = makeDb(
      withinWindowVars,
      webhooksDocWithMessages,
      [],
      [],
      [eligibleMessage],
    );
    mongoService.db.mockReturnValue(db as unknown as Db);

    await service.runMessagesCycle();

    const messagesCollectionFind = (db as any)._collections.messages.find;
    expect(messagesCollectionFind).toHaveBeenCalledWith(
      expect.objectContaining({ messageStatus: 'pending' }),
    );
    // Ensure no timestamp condition is present
    const filterArg = messagesCollectionFind.mock.calls[0][0];
    expect(filterArg).not.toHaveProperty('waitUntil');
    expect(filterArg).not.toHaveProperty('nextInteractionTimestamp');
  });

  it('(MSG-02) messages dispatched even when currentHour is outside morningLimit/nightLimit', async () => {
    const db = makeDb(
      withinWindowVars,
      webhooksDocWithMessages,
      [],
      [],
      [eligibleMessage],
    );
    mongoService.db.mockReturnValue(db as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(3); // before morningLimit

    await service.runMessagesCycle();

    expect(webhookDispatchService.dispatchMessage).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });

  it('(MSG-03) messages dispatched even when currentDay is not in allowedDays', async () => {
    const restrictedVars = {
      timeTrigger: {
        enabled: true,
        morningLimit: 8,
        nightLimit: 22,
        allowedDays: [1, 2, 3, 4, 5], // só dias úteis
      },
    };
    const db = makeDb(
      restrictedVars,
      webhooksDocWithMessages,
      [],
      [],
      [eligibleMessage],
    );
    mongoService.db.mockReturnValue(db as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
    jest.spyOn(Date.prototype, 'getDay').mockReturnValue(0); // domingo — não permitido

    await service.runMessagesCycle();

    expect(webhookDispatchService.dispatchMessage).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });

  it('(MSG-02/MSG-03) messages dispatched even when timeTrigger is absent in vars', async () => {
    const db = makeDb(
      { botIdentifier: 'x' },
      webhooksDocWithMessages,
      [],
      [],
      [eligibleMessage],
    );
    mongoService.db.mockReturnValue(db as unknown as Db);

    await service.runMessagesCycle();

    expect(webhookDispatchService.dispatchMessage).toHaveBeenCalledTimes(1);
  });

  it('mensagens pendentes URL absent → logs warn, skips messages', async () => {
    const webhooksWithoutMessages = {
      'Processador de Runs': 'https://hook.example.com',
      'Gerenciador follow up': 'https://fup.example.com',
    };
    const db = makeDb(
      withinWindowVars,
      webhooksWithoutMessages,
      [],
      [],
      [eligibleMessage],
    );
    mongoService.db.mockReturnValue(db as unknown as Db);
    const warnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => {});

    await service.runMessagesCycle();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('mensagens pendentes'),
    );
    expect(webhookDispatchService.dispatchMessage).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('dispatchMessage called once per eligible message', async () => {
    const message2 = { _id: 'msg-002', messageStatus: 'pending' };
    const db = makeDb(
      withinWindowVars,
      webhooksDocWithMessages,
      [],
      [],
      [eligibleMessage, message2],
    );
    mongoService.db.mockReturnValue(db as unknown as Db);

    await service.runMessagesCycle();

    expect(webhookDispatchService.dispatchMessage).toHaveBeenCalledTimes(2);
    jest.restoreAllMocks();
  });

  // ---- CRON-06: Guard independence tests ----

  it('(CRON-06) isRunningRuns=true does NOT prevent runFupCycle from executing', async () => {
    // Make runRunsCycle hang via slow getEligibleDatabases
    let resolveFirst!: () => void;
    databaseScanService.getEligibleDatabases.mockReturnValueOnce(
      new Promise<string[]>((res) => {
        resolveFirst = () => res([]);
      }),
    );
    const firstCycle = service.runRunsCycle(); // hangs

    // FUP cycle must proceed independently
    databaseScanService.getEligibleDatabases.mockResolvedValueOnce([]);
    await service.runFupCycle(); // must NOT be blocked

    resolveFirst();
    await firstCycle;
    // if we got here without hanging, the test passes
  });

  it('(CRON-06) isRunningRuns=true does NOT prevent runMessagesCycle from executing', async () => {
    let resolveFirst!: () => void;
    databaseScanService.getEligibleDatabases.mockReturnValueOnce(
      new Promise<string[]>((res) => {
        resolveFirst = () => res([]);
      }),
    );
    const firstCycle = service.runRunsCycle(); // hangs

    databaseScanService.getEligibleDatabases.mockResolvedValueOnce([]);
    await service.runMessagesCycle(); // must NOT be blocked

    resolveFirst();
    await firstCycle;
  });

  it('(CRON-06) isRunningFup=true does NOT prevent runRunsCycle from executing', async () => {
    let resolveFirst!: () => void;
    databaseScanService.getEligibleDatabases.mockReturnValueOnce(
      new Promise<string[]>((res) => {
        resolveFirst = () => res([]);
      }),
    );
    const firstCycle = service.runFupCycle(); // hangs

    databaseScanService.getEligibleDatabases.mockResolvedValueOnce([]);
    await service.runRunsCycle(); // must NOT be blocked

    resolveFirst();
    await firstCycle;
  });

  it('(CRON-06) isRunningMessages=true does NOT prevent runRunsCycle from executing', async () => {
    let resolveFirst!: () => void;
    databaseScanService.getEligibleDatabases.mockReturnValueOnce(
      new Promise<string[]>((res) => {
        resolveFirst = () => res([]);
      }),
    );
    const firstCycle = service.runMessagesCycle(); // hangs

    databaseScanService.getEligibleDatabases.mockResolvedValueOnce([]);
    await service.runRunsCycle(); // must NOT be blocked

    resolveFirst();
    await firstCycle;
  });
});
