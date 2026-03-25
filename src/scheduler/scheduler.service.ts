import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { RunDispatchService } from '../dispatch/run-dispatch.service.js';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly configService: ConfigService,
    private readonly runDispatchService: RunDispatchService,
  ) {}

  onModuleInit(): void {
    // SCHED-02: dynamic registration at runtime (not static @Interval() decorator)
    // SCHED-01: interval period from CRON_INTERVAL env var
    // Pitfall 7: env vars are strings — cast explicitly with Number()
    const intervalMs = Number(this.configService.getOrThrow<string>('CRON_INTERVAL'));
    const intervalId = setInterval(
      () => void this.runDispatchService.runCycle(),
      intervalMs,
    );
    this.schedulerRegistry.addInterval('dispatch-cycle', intervalId);
    this.logger.log(`Dispatch interval registered: ${intervalMs}ms`);
  }

  onModuleDestroy(): void {
    this.schedulerRegistry.deleteInterval('dispatch-cycle');
  }
}
