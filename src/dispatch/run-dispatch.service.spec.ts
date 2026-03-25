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
  ) => {
    const mockFind = { toArray: jest.fn().mockResolvedValue(runs) };
    const collections: Record<string, { findOne?: jest.Mock; find?: jest.Mock }> = {
      vars: { findOne: jest.fn().mockResolvedValue(vars) },
      webhooks: { findOne: jest.fn().mockResolvedValue(webhooks) },
      runs: { find: jest.fn().mockReturnValue(mockFind) },
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RunDispatchService,
        {
          provide: WebhookDispatchService,
          useValue: { dispatch: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: MongoService,
          useValue: { db: jest.fn() },
        },
        {
          provide: DatabaseScanService,
          useValue: { getEligibleDatabases: jest.fn().mockResolvedValue(['test-db']) },
        },
      ],
    }).compile();

    service = module.get<RunDispatchService>(RunDispatchService);
    webhookDispatchService = module.get(WebhookDispatchService);
    mongoService = module.get(MongoService);
    databaseScanService = module.get(DatabaseScanService);
  });

  const withinWindowVars = { morningLimit: 8, nightLimit: 22 };
  const webhooksDoc = { 'Processador de Runs': 'https://hook.example.com' };

  it('(DETECT-01) queries runs collection with runStatus:waiting and waitUntil <= now', async () => {
    const db = makeDb(withinWindowVars, webhooksDoc, []);
    mongoService.db.mockReturnValue(db as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);

    await service.runCycle();

    const runsCollectionFind = (db as any)._collections.runs.find;
    expect(runsCollectionFind).toHaveBeenCalledWith(
      expect.objectContaining({
        runStatus: 'waiting',
        waitUntil: expect.objectContaining({ $lte: expect.any(Date) }),
      }),
    );
    jest.restoreAllMocks();
  });

  it('(DETECT-02) reads vars fresh on each processDatabase call (no caching)', async () => {
    const db = makeDb(withinWindowVars, webhooksDoc, []);
    mongoService.db.mockReturnValue(db as unknown as Db);
    databaseScanService.getEligibleDatabases
      .mockResolvedValueOnce(['db-1'])
      .mockResolvedValueOnce(['db-1']);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);

    await service.runCycle();
    // Reset call count
    const varsFindOne = (db as any)._collections.vars.findOne as jest.Mock;
    const firstCallCount = varsFindOne.mock.calls.length;

    await service.runCycle();
    const secondCallCount = varsFindOne.mock.calls.length;

    expect(secondCallCount).toBeGreaterThan(firstCallCount);
    jest.restoreAllMocks();
  });

  it('(DETECT-03) reads webhooks fresh on each processDatabase call (no caching)', async () => {
    const db = makeDb(withinWindowVars, webhooksDoc, []);
    mongoService.db.mockReturnValue(db as unknown as Db);
    databaseScanService.getEligibleDatabases
      .mockResolvedValueOnce(['db-1'])
      .mockResolvedValueOnce(['db-1']);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);

    await service.runCycle();
    const webhooksFindOne = (db as any)._collections.webhooks.findOne as jest.Mock;
    const firstCallCount = webhooksFindOne.mock.calls.length;

    await service.runCycle();
    const secondCallCount = webhooksFindOne.mock.calls.length;

    expect(secondCallCount).toBeGreaterThan(firstCallCount);
    jest.restoreAllMocks();
  });

  it('(DETECT-04) skips dispatch when currentHour < morningLimit', async () => {
    const db = makeDb({ morningLimit: 8, nightLimit: 22 }, webhooksDoc, [eligibleRun]);
    mongoService.db.mockReturnValue(db as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(6); // before 8am

    await service.runCycle();

    expect(webhookDispatchService.dispatch).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('(DETECT-04) skips dispatch when currentHour >= nightLimit', async () => {
    const db = makeDb({ morningLimit: 8, nightLimit: 22 }, webhooksDoc, [eligibleRun]);
    mongoService.db.mockReturnValue(db as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(23); // after 10pm

    await service.runCycle();

    expect(webhookDispatchService.dispatch).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('(DETECT-04) dispatches runs when currentHour is within [morningLimit, nightLimit)', async () => {
    const db = makeDb({ morningLimit: 8, nightLimit: 22 }, webhooksDoc, [eligibleRun]);
    mongoService.db.mockReturnValue(db as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10); // within window

    await service.runCycle();

    expect(webhookDispatchService.dispatch).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });

  it('skips database and logs warning when vars document is null', async () => {
    const db = makeDb(null, webhooksDoc, [eligibleRun]);
    mongoService.db.mockReturnValue(db as unknown as Db);
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});

    await expect(service.runCycle()).resolves.not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('morningLimit'));
    expect(webhookDispatchService.dispatch).not.toHaveBeenCalled();
  });

  it('skips database and logs warning when vars is missing morningLimit', async () => {
    const db = makeDb({ nightLimit: 22 }, webhooksDoc, [eligibleRun]);
    mongoService.db.mockReturnValue(db as unknown as Db);
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});

    await expect(service.runCycle()).resolves.not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    expect(webhookDispatchService.dispatch).not.toHaveBeenCalled();
  });

  it('skips database and logs warning when "Processador de Runs" URL is missing', async () => {
    const db = makeDb(withinWindowVars, {}, [eligibleRun]);
    mongoService.db.mockReturnValue(db as unknown as Db);
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});

    await expect(service.runCycle()).resolves.not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Processador de Runs'));
    expect(webhookDispatchService.dispatch).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('(SCHED-03) does not re-enter runCycle if isRunning is true', async () => {
    // Simulate a slow cycle by making getEligibleDatabases hang
    let resolveFirst: () => void;
    const firstCyclePromise = new Promise<void>((res) => {
      resolveFirst = res;
    });
    databaseScanService.getEligibleDatabases.mockReturnValueOnce(
      firstCyclePromise.then(() => []),
    );

    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});

    // Start first cycle (does not complete yet)
    const firstCycle = service.runCycle();

    // Second cycle fires while first is still running
    await service.runCycle();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('previous cycle'));

    // Finish first cycle
    resolveFirst!();
    await firstCycle;
  });

  it('(SCHED-03) resets isRunning to false after runCycle throws', async () => {
    databaseScanService.getEligibleDatabases.mockRejectedValueOnce(
      new Error('DB scan failed'),
    );

    await service.runCycle(); // should not throw — error swallowed inside try/finally

    // isRunning must be false — next cycle should not be skipped
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
    databaseScanService.getEligibleDatabases.mockResolvedValueOnce([]);

    await service.runCycle();

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('previous cycle'));
  });

  it('(CONN-06) a failing DB does not prevent other DBs from being processed', async () => {
    const goodDb = makeDb(withinWindowVars, webhooksDoc, [eligibleRun]);
    const failingDbName = 'bad-db';
    const goodDbName = 'good-db';

    databaseScanService.getEligibleDatabases.mockResolvedValue([failingDbName, goodDbName]);
    mongoService.db.mockImplementation((name: string) => {
      if (name === failingDbName) throw new Error('connection refused');
      return goodDb as unknown as Db;
    });
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);

    await expect(service.runCycle()).resolves.not.toThrow();
    expect(webhookDispatchService.dispatch).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });

  it('(CONN-06) cycle log includes DB count and error count after allSettled', async () => {
    const goodDb = makeDb(withinWindowVars, webhooksDoc, []);
    databaseScanService.getEligibleDatabases.mockResolvedValue(['db-a', 'db-b']);
    mongoService.db.mockImplementation((name: string) => {
      if (name === 'db-b') throw new Error('oops');
      return goodDb as unknown as Db;
    });
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
    const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});

    await service.runCycle();

    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/2 DBs.*1 errors/));
    jest.restoreAllMocks();
  });
});
