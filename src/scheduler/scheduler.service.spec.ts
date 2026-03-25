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
            getOrThrow: jest.fn().mockReturnValue('10000'),
          },
        },
        {
          provide: RunDispatchService,
          useValue: {
            runCycle: jest.fn().mockResolvedValue(undefined),
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

  it('(SCHED-01/SCHED-02) reads CRON_INTERVAL from ConfigService in onModuleInit', () => {
    service.onModuleInit();

    expect(configService.getOrThrow).toHaveBeenCalledWith('CRON_INTERVAL');
  });

  it('(SCHED-02) registers the interval with SchedulerRegistry under "dispatch-cycle"', () => {
    service.onModuleInit();

    expect(schedulerRegistry.addInterval).toHaveBeenCalledWith(
      'dispatch-cycle',
      expect.anything(),
    );
  });

  it('(SCHED-01) the setInterval callback calls runDispatchService.runCycle()', () => {
    service.onModuleInit();

    jest.advanceTimersByTime(10000);

    expect(runDispatchService.runCycle).toHaveBeenCalled();
  });

  it('onModuleDestroy calls schedulerRegistry.deleteInterval("dispatch-cycle")', () => {
    service.onModuleInit();
    service.onModuleDestroy();

    expect(schedulerRegistry.deleteInterval).toHaveBeenCalledWith('dispatch-cycle');
  });

  it('CRON_INTERVAL string is converted to a Number before being passed to setInterval', () => {
    // Spy on the global setInterval to capture its arguments
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    configService.getOrThrow.mockReturnValue('10000' as any);

    service.onModuleInit();

    const delayArg = setIntervalSpy.mock.calls[0][1];
    expect(typeof delayArg).toBe('number');
    expect(delayArg).toBe(10000);
    setIntervalSpy.mockRestore();
  });
});
