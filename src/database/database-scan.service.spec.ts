import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DatabaseScanService } from './database-scan.service.js';
import { MongoService } from '../mongo/mongo.service.js';

describe('DatabaseScanService', () => {
  let service: DatabaseScanService;
  let mongoService: jest.Mocked<MongoService>;
  let configService: jest.Mocked<ConfigService>;

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

    const mockConfigService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseScanService,
        { provide: MongoService, useValue: mockMongoService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<DatabaseScanService>(DatabaseScanService);
    mongoService = module.get(MongoService);
    configService = module.get(ConfigService);

    // Default: TARGET_DATABASES ausente (todos os bancos)
    configService.get.mockReturnValue(undefined);
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

  describe('TARGET_DATABASES filter', () => {
    it('TARGET_DATABASES ausente → processa todos os bancos elegíveis (comportamento padrão)', async () => {
      configService.get.mockReturnValue(undefined);
      mongoService.listDatabaseNames.mockResolvedValue(['sdr-4blue', 'dev', 'other-db']);
      mongoService.db.mockReturnValue(makeDb(['runs', 'webhooks', 'vars']) as any);

      const result = await service.getEligibleDatabases();

      expect(result).toContain('sdr-4blue');
      expect(result).toContain('dev');
      expect(result).toContain('other-db');
      expect(mongoService.db).toHaveBeenCalledWith('sdr-4blue');
      expect(mongoService.db).toHaveBeenCalledWith('dev');
      expect(mongoService.db).toHaveBeenCalledWith('other-db');
    });

    it("TARGET_DATABASES='*' → processa todos os bancos elegíveis (nenhum filtro aplicado)", async () => {
      configService.get.mockReturnValue('*');
      mongoService.listDatabaseNames.mockResolvedValue(['sdr-4blue', 'dev', 'other-db']);
      mongoService.db.mockReturnValue(makeDb(['runs', 'webhooks', 'vars']) as any);

      const result = await service.getEligibleDatabases();

      expect(result).toContain('sdr-4blue');
      expect(result).toContain('dev');
      expect(result).toContain('other-db');
      expect(mongoService.db).toHaveBeenCalledWith('sdr-4blue');
      expect(mongoService.db).toHaveBeenCalledWith('dev');
      expect(mongoService.db).toHaveBeenCalledWith('other-db');
    });

    it("TARGET_DATABASES='sdr-4blue,dev' → apenas sdr-4blue e dev são checados; outros bancos ignorados", async () => {
      configService.get.mockReturnValue('sdr-4blue,dev');
      mongoService.listDatabaseNames.mockResolvedValue(['sdr-4blue', 'dev', 'other-db']);
      mongoService.db.mockReturnValue(makeDb(['runs', 'webhooks', 'vars']) as any);

      const result = await service.getEligibleDatabases();

      expect(result).toContain('sdr-4blue');
      expect(result).toContain('dev');
      expect(result).not.toContain('other-db');
      // other-db nunca deve ter db() chamado (filtrado antes de listCollections)
      expect(mongoService.db).toHaveBeenCalledWith('sdr-4blue');
      expect(mongoService.db).toHaveBeenCalledWith('dev');
      expect(mongoService.db).not.toHaveBeenCalledWith('other-db');
    });

    it("TARGET_DATABASES='sdr-4blue' (banco não existe no Mongo) → retorna array vazio", async () => {
      configService.get.mockReturnValue('sdr-4blue');
      mongoService.listDatabaseNames.mockResolvedValue(['dev', 'other-db']);
      mongoService.db.mockReturnValue(makeDb(['runs', 'webhooks', 'vars']) as any);

      const result = await service.getEligibleDatabases();

      expect(result).toHaveLength(0);
      // nenhum db() deve ser chamado — sdr-4blue não existe, dev e other-db foram filtrados
      expect(mongoService.db).not.toHaveBeenCalled();
    });

    it('log inclui contagem de bancos excluídos quando filtro TARGET_DATABASES está ativo', async () => {
      const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
      configService.get.mockReturnValue('sdr-4blue');
      mongoService.listDatabaseNames.mockResolvedValue(['sdr-4blue', 'dev', 'other-db']);
      mongoService.db.mockReturnValue(makeDb(['runs', 'webhooks', 'vars']) as any);

      await service.getEligibleDatabases();

      // Deve emitir log sobre o filtro TARGET_DATABASES
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringMatching(/TARGET_DATABASES.*1 allowed.*2 excluded|TARGET_DATABASES.*allowed.*excluded/),
      );
    });
  });
});
