import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseScanService } from './database-scan.service.js';
import { MongoService } from '../mongo/mongo.service.js';

describe('DatabaseScanService', () => {
  let service: DatabaseScanService;
  let mongoService: jest.Mocked<MongoService>;

  const makeDb = (collectionNames: string[]) => ({
    listCollections: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue(
        collectionNames.map((name) => ({ name, type: 'collection' })),
      ),
    }),
  });

  beforeEach(async () => {
    const mockMongoService = {
      listDatabaseNames: jest.fn(),
      db: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseScanService,
        { provide: MongoService, useValue: mockMongoService },
      ],
    }).compile();

    service = module.get<DatabaseScanService>(DatabaseScanService);
    mongoService = module.get(MongoService);
  });

  it('skips system databases (admin, local, config) without calling listCollections on them', async () => {
    mongoService.listDatabaseNames.mockResolvedValue(['admin', 'local', 'config', 'sdr-4blue']);
    mongoService.db.mockReturnValue(makeDb(['runs', 'webhooks', 'vars']) as any);

    await service.getEligibleDatabases();

    // db() should never be called with system DB names
    expect(mongoService.db).not.toHaveBeenCalledWith('admin');
    expect(mongoService.db).not.toHaveBeenCalledWith('local');
    expect(mongoService.db).not.toHaveBeenCalledWith('config');
    expect(mongoService.db).toHaveBeenCalledWith('sdr-4blue');
  });

  it('includes a database that has all three required collections', async () => {
    mongoService.listDatabaseNames.mockResolvedValue(['sdr-4blue']);
    mongoService.db.mockReturnValue(makeDb(['runs', 'webhooks', 'vars']) as any);

    const result = await service.getEligibleDatabases();

    expect(result).toContain('sdr-4blue');
  });

  it('excludes a database missing the runs collection', async () => {
    mongoService.listDatabaseNames.mockResolvedValue(['partial-db']);
    mongoService.db.mockReturnValue(makeDb(['webhooks', 'vars']) as any);

    const result = await service.getEligibleDatabases();

    expect(result).not.toContain('partial-db');
  });

  it('excludes a database missing the webhooks collection', async () => {
    mongoService.listDatabaseNames.mockResolvedValue(['partial-db']);
    mongoService.db.mockReturnValue(makeDb(['runs', 'vars']) as any);

    const result = await service.getEligibleDatabases();

    expect(result).not.toContain('partial-db');
  });

  it('excludes a database missing the vars collection', async () => {
    mongoService.listDatabaseNames.mockResolvedValue(['partial-db']);
    mongoService.db.mockReturnValue(makeDb(['runs', 'webhooks']) as any);

    const result = await service.getEligibleDatabases();

    expect(result).not.toContain('partial-db');
  });

  it('excludes a database with only unrelated collections (e.g. chats)', async () => {
    mongoService.listDatabaseNames.mockResolvedValue(['n8-santosbarrosadvogados']);
    mongoService.db.mockReturnValue(makeDb(['chats']) as any);

    const result = await service.getEligibleDatabases();

    expect(result).not.toContain('n8-santosbarrosadvogados');
  });

  it('emits a log line with client DB count, eligible count, and skipped count', async () => {
    const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
    mongoService.listDatabaseNames.mockResolvedValue(['admin', 'sdr-4blue', 'chats-only']);
    mongoService.db.mockImplementation((name: string) => {
      if (name === 'sdr-4blue') return makeDb(['runs', 'webhooks', 'vars']) as any;
      return makeDb(['chats']) as any;
    });

    await service.getEligibleDatabases();

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/2 client DB|1 eligible|1 skipped/),
    );
  });
});
