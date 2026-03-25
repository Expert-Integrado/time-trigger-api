import { Injectable, Logger } from '@nestjs/common';
import { MongoService } from '../mongo/mongo.service.js';
import { DatabaseScanService } from '../database/database-scan.service.js';
import { WebhookDispatchService } from './webhook-dispatch.service.js';
import { Db, Document } from 'mongodb';

interface VarsDoc {
  morningLimit?: number;
  nightLimit?: number;
}

interface WebhookDoc {
  'Processador de Runs'?: string;
}

@Injectable()
export class RunDispatchService {
  private readonly logger = new Logger(RunDispatchService.name);
  private isRunning = false;
  private cycleCount = 0;

  constructor(
    private readonly mongoService: MongoService,
    private readonly databaseScanService: DatabaseScanService,
    private readonly webhookDispatchService: WebhookDispatchService,
  ) {}

  async runCycle(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Cycle skipped — previous cycle still running');
      return;
    }
    this.isRunning = true;
    this.cycleCount++;
    const cycle = this.cycleCount;

    try {
      this.logger.log(`Cycle #${cycle} started`);
      const databases = await this.databaseScanService.getEligibleDatabases();

      for (const dbName of databases) {
        try {
          await this.processDatabase(dbName);
        } catch (err) {
          this.logger.error(`[${dbName}] Unhandled error during processing: ${String(err)}`);
        }
      }

      this.logger.log(`Cycle #${cycle} complete`);
    } catch (err) {
      this.logger.error(`Cycle #${cycle} failed: ${String(err)}`);
    } finally {
      this.isRunning = false;
    }
  }

  private async processDatabase(dbName: string): Promise<void> {
    const db: Db = this.mongoService.db(dbName);

    // DETECT-02: fresh vars read every cycle
    const vars = await db.collection('vars').findOne<VarsDoc>({});
    if (!vars?.morningLimit || !vars?.nightLimit) {
      this.logger.warn(
        `[${dbName}] Missing morningLimit/nightLimit in vars — skipping`,
      );
      return;
    }

    // DETECT-04: time gate (TZ=America/Sao_Paulo makes getHours() return Brazil time)
    if (!this.isWithinTimeWindow(vars.morningLimit, vars.nightLimit)) {
      return;
    }

    // DETECT-03: fresh webhooks read every cycle
    const webhookDoc = await db.collection('webhooks').findOne<WebhookDoc>({});
    const webhookUrl = webhookDoc?.['Processador de Runs'];
    if (!webhookUrl) {
      this.logger.warn(
        `[${dbName}] "Processador de Runs" URL missing from webhooks — skipping`,
      );
      return;
    }

    // DETECT-01: find waiting runs with waitUntil in the past
    const runs: Document[] = await db
      .collection('runs')
      .find({ runStatus: 'waiting', waitUntil: { $lte: new Date() } })
      .toArray();

    for (const run of runs) {
      await this.webhookDispatchService.dispatch(db, run, webhookUrl);
    }
  }

  private isWithinTimeWindow(morningLimit: number, nightLimit: number): boolean {
    const currentHour = new Date().getHours(); // Brazil time due to TZ env
    return currentHour >= morningLimit && currentHour < nightLimit;
  }
}
