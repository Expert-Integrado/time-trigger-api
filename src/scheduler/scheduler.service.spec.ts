import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerService } from './scheduler.service.js';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { RunDispatchService } from '../dispatch/run-dispatch.service.js';

describe('SchedulerService', () => {
  let service: SchedulerService;
  let schedulerRegistry: jest.Mocked<SchedulerRegistry>;
  let configService: jest.Mocked<ConfigService>;
  let runDispatchService: jest.Mocked<RunDispatchService>;

  beforeEach(async () => {
    jest.useFakeTimers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulerService,
        {
          provide: SchedulerRegistry,
          useValue: {
            addInterval: jest.fn(),
            deleteInterval: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            // CRON-07: 3 different values to prove independence
            getOrThrow: jest.fn().mockImplementation((key: string) => {
              if (key === 'CRON_INTERVAL_RUNS') return '30000';
              if (key === 'CRON_INTERVAL_FUP') return '15000';
              if (key === 'CRON_INTERVAL_MESSAGES') return '5000';
              throw new Error(`Unexpected env var: ${key}`);
            }),
          },
        },
        {
          provide: RunDispatchService,
          useValue: {
            runRunsCycle: jest.fn().mockResolvedValue(undefined),
            runFupCycle: jest.fn().mockResolvedValue(undefined),
            runMessagesCycle: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<SchedulerService>(SchedulerService);
    schedulerRegistry = module.get(SchedulerRegistry);
    configService = module.get(ConfigService);
    runDispatchService = module.get(RunDispatchService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('(CRON-01) reads CRON_INTERVAL_RUNS from ConfigService in onModuleInit', () => {
    service.onModuleInit();
    expect(configService.getOrThrow).toHaveBeenCalledWith('CRON_INTERVAL_RUNS');
  });

  it('(CRON-02) reads CRON_INTERVAL_FUP from ConfigService in onModuleInit', () => {
    service.onModuleInit();
    expect(configService.getOrThrow).toHaveBeenCalledWith('CRON_INTERVAL_FUP');
  });

  it('(CRON-03) reads CRON_INTERVAL_MESSAGES from ConfigService in onModuleInit', () => {
    service.onModuleInit();
    expect(configService.getOrThrow).toHaveBeenCalledWith(
      'CRON_INTERVAL_MESSAGES',
    );
  });

  it('(CRON-04) does NOT read old CRON_INTERVAL from ConfigService', () => {
    service.onModuleInit();
    expect(configService.getOrThrow).not.toHaveBeenCalledWith('CRON_INTERVAL');
  });

  it('(CRON-05) registers dispatch-runs interval with SchedulerRegistry', () => {
    service.onModuleInit();
    expect(schedulerRegistry.addInterval).toHaveBeenCalledWith(
      'dispatch-runs',
      expect.anything(),
    );
  });

  it('(CRON-05) registers dispatch-fup interval with SchedulerRegistry', () => {
    service.onModuleInit();
    expect(schedulerRegistry.addInterval).toHaveBeenCalledWith(
      'dispatch-fup',
      expect.anything(),
    );
  });

  it('(CRON-05) registers dispatch-messages interval with SchedulerRegistry', () => {
    service.onModuleInit();
    expect(schedulerRegistry.addInterval).toHaveBeenCalledWith(
      'dispatch-messages',
      expect.anything(),
    );
  });

  it('dispatch-runs interval fires runRunsCycle()', () => {
    service.onModuleInit();
    jest.advanceTimersByTime(30000);
    expect(runDispatchService.runRunsCycle).toHaveBeenCalled();
  });

  it('dispatch-fup interval fires runFupCycle()', () => {
    service.onModuleInit();
    jest.advanceTimersByTime(15000);
    expect(runDispatchService.runFupCycle).toHaveBeenCalled();
  });

  it('dispatch-messages interval fires runMessagesCycle()', () => {
    service.onModuleInit();
    jest.advanceTimersByTime(5000);
    expect(runDispatchService.runMessagesCycle).toHaveBeenCalled();
  });

  it('(CRON-07) each interval uses its own configured millisecond value', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    service.onModuleInit();
    const delays = setIntervalSpy.mock.calls.map((call) => call[1]);
    expect(delays).toContain(30000);
    expect(delays).toContain(15000);
    expect(delays).toContain(5000);
    setIntervalSpy.mockRestore();
  });

  it('env var strings are converted to Number before setInterval', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    service.onModuleInit();
    setIntervalSpy.mock.calls.forEach((call) => {
      expect(typeof call[1]).toBe('number');
    });
    setIntervalSpy.mockRestore();
  });

  it('onModuleDestroy deletes dispatch-runs', () => {
    service.onModuleInit();
    service.onModuleDestroy();
    expect(schedulerRegistry.deleteInterval).toHaveBeenCalledWith(
      'dispatch-runs',
    );
  });

  it('onModuleDestroy deletes dispatch-fup', () => {
    service.onModuleInit();
    service.onModuleDestroy();
    expect(schedulerRegistry.deleteInterval).toHaveBeenCalledWith(
      'dispatch-fup',
    );
  });

  it('onModuleDestroy deletes dispatch-messages', () => {
    service.onModuleInit();
    service.onModuleDestroy();
    expect(schedulerRegistry.deleteInterval).toHaveBeenCalledWith(
      'dispatch-messages',
    );
  });

  it('does NOT register old dispatch-cycle interval', () => {
    service.onModuleInit();
    const registeredNames = schedulerRegistry.addInterval.mock.calls.map(
      (call) => call[0],
    );
    expect(registeredNames).not.toContain('dispatch-cycle');
  });
});
