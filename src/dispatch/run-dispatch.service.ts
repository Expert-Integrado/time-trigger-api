import { Injectable, Logger } from '@nestjs/common';
import { MongoService } from '../mongo/mongo.service.js';
import { DatabaseScanService } from '../database/database-scan.service.js';
import { WebhookDispatchService } from './webhook-dispatch.service.js';
import { Db, Document } from 'mongodb';

interface TimeTriggerConfig {
  enabled: boolean;
  morningLimit: number;
  nightLimit: number;
  allowedDays: number[]; // 0=Domingo...6=Sábado
}

interface VarsDoc {
  timeTrigger?: TimeTriggerConfig;
}

interface WebhookDoc {
  'Processador de Runs'?: string;
  FUP?: string;
  'mensagens pendentes'?: string;
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

      const results = await Promise.allSettled(
        databases.map((dbName) => this.processDatabase(dbName)),
      );

      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          this.logger.error(
            `[${databases[i]}] Unhandled error during processing: ${String(r.reason)}`,
          );
        }
      });

      const errorCount = results.filter((r) => r.status === 'rejected').length;
      this.logger.log(
        `Cycle #${cycle} complete — ${databases.length} DBs, ${errorCount} errors`,
      );
    } catch (err) {
      this.logger.error(`Cycle #${cycle} failed: ${String(err)}`);
    } finally {
      this.isRunning = false;
    }
  }

  private async processDatabase(dbName: string): Promise<void> {
    const db: Db = this.mongoService.db(dbName);

    // --- timeTrigger-gated: runs + FUP ---
    // TRIG-01, TRIG-02: fresh vars read; timeTrigger obrigatório
    const vars = await db.collection('vars').findOne<VarsDoc>({});
    if (!vars?.timeTrigger) {
      this.logger.warn(`[${dbName}] timeTrigger not found in vars — skipping`);
    } else if (!vars.timeTrigger.enabled) {
      // TRIG-03: enabled flag
      this.logger.warn(`[${dbName}] timeTrigger.enabled is false — skipping`);
    } else if (
      // TRIG-04: time gate (TZ=America/Sao_Paulo makes getHours() return Brazil time)
      !this.isWithinTimeWindow(
        vars.timeTrigger.morningLimit,
        vars.timeTrigger.nightLimit,
      )
    ) {
      // silent skip — outside time window
    } else if (!this.isAllowedDay(vars.timeTrigger.allowedDays)) {
      // TRIG-05, TRIG-06: day-of-week gate — silent skip
    } else {
      // DETECT-03: fresh webhooks read every cycle
      const webhookDoc = await db
        .collection('webhooks')
        .findOne<WebhookDoc>({});
      const webhookUrl = webhookDoc?.['Processador de Runs'];
      if (!webhookUrl) {
        this.logger.warn(
          `[${dbName}] "Processador de Runs" URL missing from webhooks — skipping`,
        );
      } else {
        // DETECT-01: find waiting runs with waitUntil in the past
        const runs: Document[] = await db
          .collection('runs')
          .find({ runStatus: 'waiting', waitUntil: { $lte: Date.now() } })
          .toArray();

        for (const run of runs) {
          await this.webhookDispatchService.dispatch(db, run, webhookUrl);
        }
      }

      // FUP-01, FUP-04: detect eligible FUPs
      const fupWebhookUrl = webhookDoc?.['Gerenciador follow up'] as
        | string
        | undefined;
      if (!fupWebhookUrl) {
        this.logger.warn(
          `[${dbName}] "Gerenciador follow up" URL missing from webhooks — skipping FUP dispatch`,
        );
      } else {
        const fups: Document[] = await db
          .collection('fup')
          .find({
            status: 'on',
            nextInteractionTimestamp: { $lte: Date.now() },
          })
          .toArray();

        for (const fup of fups) {
          // FUP-09: dispatch each eligible FUP
          await this.webhookDispatchService.dispatchFup(db, fup, fupWebhookUrl);
        }
      }
    }

    // --- MSG-01/MSG-02/MSG-03: messages — NO time gate, NO day gate ---
    const messagesWebhookDoc = await db
      .collection('webhooks')
      .findOne<WebhookDoc>({});
    const messagesWebhookUrl = messagesWebhookDoc?.['mensagens pendentes'];
    if (!messagesWebhookUrl) {
      this.logger.warn(
        `[${dbName}] "mensagens pendentes" URL missing from webhooks — skipping messages dispatch`,
      );
    } else {
      const messages: Document[] = await db
        .collection('messages')
        .find({ messageStatus: 'pending' })
        .toArray();

      for (const message of messages) {
        await this.webhookDispatchService.dispatchMessage(
          db,
          message,
          messagesWebhookUrl,
        );
      }
    }
  }

  private isWithinTimeWindow(
    morningLimit: number,
    nightLimit: number,
  ): boolean {
    const currentHour = new Date().getHours(); // Brazil time due to TZ env
    return currentHour >= morningLimit && currentHour < nightLimit;
  }

  private isAllowedDay(allowedDays: number[]): boolean {
    const currentDay = new Date().getDay(); // Brazil time due to TZ env
    return allowedDays.includes(currentDay);
  }
}
