import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MongoService } from './mongo.service.js';

const mockCommand = jest.fn();
const mockDb = jest.fn().mockReturnValue({ command: mockCommand });
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockClose = jest.fn().mockResolvedValue(undefined);

const mockMongoClient = {
  connect: mockConnect,
  close: mockClose,
  db: mockDb,
};

jest.mock('mongodb', () => ({
  MongoClient: jest.fn().mockImplementation(() => mockMongoClient),
}));

describe('MongoService', () => {
  let service: MongoService;
  let configService: ConfigService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCommand.mockResolvedValue({
      databases: [{ name: 'sdr-4blue' }, { name: 'acade-system' }],
      ok: 1,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MongoService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue('mongodb://localhost:27017'),
          },
        },
      ],
    }).compile();

    service = module.get<MongoService>(MongoService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('connects using URI from ConfigService on onModuleInit', async () => {
    await service.onModuleInit();
    expect(configService.getOrThrow).toHaveBeenCalledWith('MONGODB_URI');
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('closes the client on onModuleDestroy', async () => {
    await service.onModuleInit();
    await service.onModuleDestroy();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('returns a Db handle via db() without reconnecting', async () => {
    await service.onModuleInit();
    service.db('test-db');
    expect(mockDb).toHaveBeenCalledWith('test-db');
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('calls listDatabases admin command with nameOnly:true', async () => {
    await service.onModuleInit();
    await service.listDatabaseNames();
    expect(mockDb).toHaveBeenCalledWith('admin');
    expect(mockCommand).toHaveBeenCalledWith({ listDatabases: 1, nameOnly: true });
  });

  it('returns database name strings from listDatabaseNames', async () => {
    await service.onModuleInit();
    const names = await service.listDatabaseNames();
    expect(names).toEqual(['sdr-4blue', 'acade-system']);
  });
});
