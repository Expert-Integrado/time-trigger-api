import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
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
    // CRON-01: runs interval
    const runsMs = Number(
      this.configService.getOrThrow<string>('CRON_INTERVAL_RUNS'),
    );
    const runsId = setInterval(
      () => void this.runDispatchService.runRunsCycle(),
      runsMs,
    );
    this.schedulerRegistry.addInterval('dispatch-runs', runsId);
    this.logger.log(`Runs dispatch interval registered: ${runsMs}ms`);

    // CRON-02: FUP interval
    const fupMs = Number(
      this.configService.getOrThrow<string>('CRON_INTERVAL_FUP'),
    );
    const fupId = setInterval(
      () => void this.runDispatchService.runFupCycle(),
      fupMs,
    );
    this.schedulerRegistry.addInterval('dispatch-fup', fupId);
    this.logger.log(`FUP dispatch interval registered: ${fupMs}ms`);

    // CRON-03: messages interval
    const messagesMs = Number(
      this.configService.getOrThrow<string>('CRON_INTERVAL_MESSAGES'),
    );
    const messagesId = setInterval(
      () => void this.runDispatchService.runMessagesCycle(),
      messagesMs,
    );
    this.schedulerRegistry.addInterval('dispatch-messages', messagesId);
    this.logger.log(`Messages dispatch interval registered: ${messagesMs}ms`);

    // TOUT-03: recovery interval — independent of dispatch-messages
    const recoveryMs = Number(
      this.configService.getOrThrow<string>('CRON_INTERVAL_RECOVERY'),
    );
    const recoveryId = setInterval(
      () => void this.runDispatchService.runRecoveryCycle(),
      recoveryMs,
    );
    this.schedulerRegistry.addInterval('recover-messages', recoveryId);
    this.logger.log(`Recovery interval registered: ${recoveryMs}ms`);
  }

  onModuleDestroy(): void {
    this.schedulerRegistry.deleteInterval('dispatch-runs');
    this.schedulerRegistry.deleteInterval('dispatch-fup');
    this.schedulerRegistry.deleteInterval('dispatch-messages');
    this.schedulerRegistry.deleteInterval('recover-messages');
  }
}
