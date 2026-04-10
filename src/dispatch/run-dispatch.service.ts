import { Injectable, Logger } from '@nestjs/common';
import { MongoService } from '../mongo/mongo.service.js';
import { DatabaseScanService } from '../database/database-scan.service.js';
import { WebhookDispatchService } from './webhook-dispatch.service.js';
import { MessageCheckService } from './message-check.service.js';
import { Db, Document } from 'mongodb';

interface TimeTriggerConfig {
  enabled?: boolean; // DEPRECATED - backward compat only
  enabledRuns?: boolean; // NEW - controls runs dispatch
  enabledFups?: boolean; // NEW - controls FUP dispatch
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
  private isRunningRuns = false;
  private isRunningFup = false;
  private isRunningMessages = false;
  private isRunningRecovery = false;

  private readonly rateLimitRuns = parseInt(
    process.env['RATE_LIMIT_RUNS'] ?? '10',
    10,
  );
  private readonly rateLimitFup = parseInt(
    process.env['RATE_LIMIT_FUP'] ?? '10',
    10,
  );
  private readonly rateLimitMessages = parseInt(
    process.env['RATE_LIMIT_MESSAGES'] ?? '10',
    10,
  );
  private readonly timeoutMinutes = parseInt(
    process.env['MESSAGE_TIMEOUT_MINUTES'] ?? '10',
    10,
  );

  constructor(
    private readonly mongoService: MongoService,
    private readonly databaseScanService: DatabaseScanService,
    private readonly webhookDispatchService: WebhookDispatchService,
    private readonly messageCheckService: MessageCheckService,
  ) {}

  async runRunsCycle(): Promise<void> {
    if (this.isRunningRuns) {
      this.logger.warn('Runs cycle skipped — previous cycle still running');
      return;
    }
    this.isRunningRuns = true;

    try {
      this.logger.log('Runs cycle started');
      const databases = await this.databaseScanService.getEligibleDatabases();

      const results = await Promise.allSettled(
        databases.map((dbName) => this.processDatabaseRuns(dbName)),
      );

      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          this.logger.error(
            `[${databases[i]}] Unhandled error during runs processing: ${String(r.reason)}`,
          );
        }
      });

      const errorCount = results.filter((r) => r.status === 'rejected').length;
      this.logger.log(
        `Runs cycle complete — ${databases.length} DBs, ${errorCount} errors`,
      );
    } catch (err) {
      this.logger.error(`Runs cycle failed: ${String(err)}`);
    } finally {
      this.isRunningRuns = false;
    }
  }

  async runFupCycle(): Promise<void> {
    if (this.isRunningFup) {
      this.logger.warn('FUP cycle skipped — previous cycle still running');
      return;
    }
    this.isRunningFup = true;

    try {
      this.logger.log('FUP cycle started');
      const databases = await this.databaseScanService.getEligibleDatabases();

      const results = await Promise.allSettled(
        databases.map((dbName) => this.processDatabaseFup(dbName)),
      );

      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          this.logger.error(
            `[${databases[i]}] Unhandled error during FUP processing: ${String(r.reason)}`,
          );
        }
      });

      const errorCount = results.filter((r) => r.status === 'rejected').length;
      this.logger.log(
        `FUP cycle complete — ${databases.length} DBs, ${errorCount} errors`,
      );
    } catch (err) {
      this.logger.error(`FUP cycle failed: ${String(err)}`);
    } finally {
      this.isRunningFup = false;
    }
  }

  async runMessagesCycle(): Promise<void> {
    if (this.isRunningMessages) {
      this.logger.warn('Messages cycle skipped — previous cycle still running');
      return;
    }
    this.isRunningMessages = true;

    try {
      this.logger.log('Messages cycle started');
      const databases = await this.databaseScanService.getEligibleDatabases();

      const results = await Promise.allSettled(
        databases.map((dbName) => this.processDatabaseMessages(dbName)),
      );

      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          this.logger.error(
            `[${databases[i]}] Unhandled error during messages processing: ${String(r.reason)}`,
          );
        }
      });

      const errorCount = results.filter((r) => r.status === 'rejected').length;
      this.logger.log(
        `Messages cycle complete — ${databases.length} DBs, ${errorCount} errors`,
      );
    } catch (err) {
      this.logger.error(`Messages cycle failed: ${String(err)}`);
    } finally {
      this.isRunningMessages = false;
    }
  }

  async runRecoveryCycle(): Promise<void> {
    if (this.isRunningRecovery) {
      this.logger.warn('Recovery cycle skipped — previous cycle still running');
      return;
    }
    this.isRunningRecovery = true;

    try {
      this.logger.log('Recovery cycle started');
      const databases = await this.databaseScanService.getEligibleDatabases();

      const results = await Promise.allSettled(
        databases.map((dbName) => this.recoverTimedOutMessages(dbName)),
      );

      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          this.logger.error(
            `[${databases[i]}] Unhandled error during recovery: ${String(r.reason)}`,
          );
        }
      });

      const errorCount = results.filter((r) => r.status === 'rejected').length;
      this.logger.log(
        `Recovery cycle complete — ${databases.length} DBs, ${errorCount} errors`,
      );
    } catch (err) {
      this.logger.error(`Recovery cycle failed: ${String(err)}`);
    } finally {
      this.isRunningRecovery = false;
    }
  }

  private async recoverTimedOutMessages(dbName: string): Promise<void> {
    const db: Db = this.mongoService.db(dbName);
    const cutoff = new Date(Date.now() - this.timeoutMinutes * 60 * 1000);
    const result = await db.collection('messages').updateMany(
      {
        messageStatus: 'processing',
        processingStartedAt: { $lte: cutoff },
      },
      { $set: { messageStatus: 'pending' } },
    );
    if (result.modifiedCount > 0) {
      this.logger.warn(
        `[${dbName}] Recovery: ${result.modifiedCount} message(s) reset to pending (timeout: ${this.timeoutMinutes}min)`,
      );
    }
  }

  private async processDatabaseRuns(dbName: string): Promise<void> {
    const db: Db = this.mongoService.db(dbName);

    // TRIG-01, TRIG-02: fresh vars read; timeTrigger obrigatório
    const vars = await db.collection('vars').findOne<VarsDoc>({});
    if (!vars?.timeTrigger) {
      this.logger.warn(`[${dbName}] timeTrigger not found in vars — skipping`);
      return;
    }
    if (
      // TRIG-04: time gate (TZ=America/Sao_Paulo makes getHours() return Brazil time)
      !this.isWithinTimeWindow(
        vars.timeTrigger.morningLimit,
        vars.timeTrigger.nightLimit,
      )
    ) {
      // silent skip — outside time window
      return;
    }
    if (!this.isAllowedDay(vars.timeTrigger.allowedDays)) {
      // TRIG-05, TRIG-06: day-of-week gate — silent skip
      return;
    }

    let counterRuns = 0;
    let counterFup = 0;

    // DETECT-03: fresh webhooks read every cycle
    const webhookDoc = await db.collection('webhooks').findOne<WebhookDoc>({});

    // Check enabledRuns before processing runs
    if (!this.isRunsEnabled(vars.timeTrigger)) {
      this.logger.warn(
        `[${dbName}] timeTrigger.enabledRuns is false — skipping runs`,
      );
    } else {
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
          if (counterRuns >= this.rateLimitRuns) {
            this.logger.warn(
              `[${dbName}] Rate limit reached for runs (${counterRuns}/${this.rateLimitRuns}) — skipping remaining items`,
            );
            break;
          }
          // DEP-02, DEP-03, DEP-04, DEP-05: dependency guard — block run if matching message is processing
          const botIdentifier = run['botIdentifier'] as string | undefined;
          const chatDataId = run['chatDataId'] as string | undefined;
          if (botIdentifier && chatDataId) {
            const blocked = await this.messageCheckService.hasProcessingMessage(
              db,
              botIdentifier,
              chatDataId,
            );
            if (blocked) {
              this.logger.warn(
                `[${dbName}] Run ${String(run['_id'])} blocked — message still processing (chatDataId: ${chatDataId}, botIdentifier: ${botIdentifier})`,
              );
              continue;
            }
          }
          // Resolve per-run webhook URL: bot-specific takes priority over generic
          let runWebhookUrl = webhookUrl; // default to generic
          if (botIdentifier) {
            const botWebhookDoc = await db
              .collection('webhooks')
              .findOne<WebhookDoc>({ botIdentifier });
            const botSpecificUrl = botWebhookDoc?.['Processador de Runs'];
            if (botSpecificUrl) {
              runWebhookUrl = botSpecificUrl;
            }
          }
          const claimed = await this.webhookDispatchService.dispatch(
            db,
            run,
            runWebhookUrl,
          );
          if (claimed) {
            counterRuns++;
          }
        }
      }
    }

    // FUP-01, FUP-04: detect eligible FUPs (same timeTrigger gate scope as runs)
    // Check enabledFups before processing FUPs
    if (!this.isFupsEnabled(vars.timeTrigger)) {
      this.logger.warn(
        `[${dbName}] timeTrigger.enabledFups is false — skipping FUP`,
      );
    } else {
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
          if (counterFup >= this.rateLimitFup) {
            this.logger.warn(
              `[${dbName}] Rate limit reached for FUP (${counterFup}/${this.rateLimitFup}) — skipping remaining items`,
            );
            break;
          }
          // FUP-09: dispatch each eligible FUP with bot-specific URL resolution
          const fupBotIdentifier = fup['botIdentifier'] as string | undefined;
          let resolvedFupUrl = fupWebhookUrl;
          if (fupBotIdentifier) {
            const botWebhookDoc = await db
              .collection('webhooks')
              .findOne<WebhookDoc>({ botIdentifier: fupBotIdentifier });
            const botSpecificUrl = botWebhookDoc?.['Gerenciador follow up'] as
              | string
              | undefined;
            if (botSpecificUrl) {
              resolvedFupUrl = botSpecificUrl;
            }
          }
          const claimed = await this.webhookDispatchService.dispatchFup(
            db,
            fup,
            resolvedFupUrl,
          );
          if (claimed) {
            counterFup++;
          }
        }
      }
    }

    this.logger.log(
      `[${dbName}] Runs: ${counterRuns}/${this.rateLimitRuns} dispatched`,
    );
    this.logger.log(
      `[${dbName}] FUP: ${counterFup}/${this.rateLimitFup} dispatched`,
    );
  }

  private async processDatabaseFup(dbName: string): Promise<void> {
    const db: Db = this.mongoService.db(dbName);

    // Fresh vars read; timeTrigger gate applies to standalone FUP cycle too
    const vars = await db.collection('vars').findOne<VarsDoc>({});
    if (!vars?.timeTrigger) {
      this.logger.warn(`[${dbName}] timeTrigger not found in vars — skipping`);
      return;
    }
    if (!this.isFupsEnabled(vars.timeTrigger)) {
      this.logger.warn(
        `[${dbName}] timeTrigger.enabledFups is false — skipping`,
      );
      return;
    }
    if (
      !this.isWithinTimeWindow(
        vars.timeTrigger.morningLimit,
        vars.timeTrigger.nightLimit,
      )
    ) {
      return;
    }
    if (!this.isAllowedDay(vars.timeTrigger.allowedDays)) {
      return;
    }

    const webhookDoc = await db.collection('webhooks').findOne<WebhookDoc>({});
    const fupWebhookUrl = webhookDoc?.['Gerenciador follow up'] as
      | string
      | undefined;
    if (!fupWebhookUrl) {
      this.logger.warn(
        `[${dbName}] "Gerenciador follow up" URL missing from webhooks — skipping FUP dispatch`,
      );
      return;
    }

    let counterFup = 0;

    const fups: Document[] = await db
      .collection('fup')
      .find({
        status: 'on',
        nextInteractionTimestamp: { $lte: Date.now() },
      })
      .toArray();

    for (const fup of fups) {
      if (counterFup >= this.rateLimitFup) {
        this.logger.warn(
          `[${dbName}] Rate limit reached for FUP (${counterFup}/${this.rateLimitFup}) — skipping remaining items`,
        );
        break;
      }
      const fupBotIdentifier = fup['botIdentifier'] as string | undefined;
      let resolvedFupUrl = fupWebhookUrl;
      if (fupBotIdentifier) {
        const botWebhookDoc = await db
          .collection('webhooks')
          .findOne<WebhookDoc>({ botIdentifier: fupBotIdentifier });
        const botSpecificUrl = botWebhookDoc?.['Gerenciador follow up'] as
          | string
          | undefined;
        if (botSpecificUrl) {
          resolvedFupUrl = botSpecificUrl;
        }
      }
      const claimed = await this.webhookDispatchService.dispatchFup(
        db,
        fup,
        resolvedFupUrl,
      );
      if (claimed) {
        counterFup++;
      }
    }

    this.logger.log(
      `[${dbName}] FUP: ${counterFup}/${this.rateLimitFup} dispatched`,
    );
  }

  private async processDatabaseMessages(dbName: string): Promise<void> {
    const db: Db = this.mongoService.db(dbName);

    // MSG-01/MSG-02/MSG-03: messages — NO time gate, NO day gate
    const webhookDoc = await db.collection('webhooks').findOne<WebhookDoc>({});
    const messagesWebhookUrl = webhookDoc?.['mensagens pendentes'];
    if (!messagesWebhookUrl) {
      this.logger.warn(
        `[${dbName}] "mensagens pendentes" URL missing from webhooks — skipping messages dispatch`,
      );
      return;
    }

    let counterMessages = 0;

    const messages: Document[] = await db
      .collection('messages')
      .find({ messageStatus: 'pending' })
      .toArray();

    for (const message of messages) {
      if (counterMessages >= this.rateLimitMessages) {
        this.logger.warn(
          `[${dbName}] Rate limit reached for messages (${counterMessages}/${this.rateLimitMessages}) — skipping remaining items`,
        );
        break;
      }
      const msgBotIdentifier = message['botIdentifier'] as string | undefined;
      let resolvedMsgUrl = messagesWebhookUrl;
      if (msgBotIdentifier) {
        const botWebhookDoc = await db
          .collection('webhooks')
          .findOne<WebhookDoc>({ botIdentifier: msgBotIdentifier });
        const botSpecificUrl = botWebhookDoc?.['mensagens pendentes'];
        if (botSpecificUrl) {
          resolvedMsgUrl = botSpecificUrl;
        }
      }
      const claimed = await this.webhookDispatchService.dispatchMessage(
        db,
        message,
        resolvedMsgUrl,
      );
      if (claimed) {
        counterMessages++;
      }
    }

    this.logger.log(
      `[${dbName}] Messages: ${counterMessages}/${this.rateLimitMessages} dispatched`,
    );
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

  private isRunsEnabled(config: TimeTriggerConfig): boolean {
    if (config.enabledRuns !== undefined) return config.enabledRuns;
    return config.enabled ?? false; // default false - must be explicitly enabled
  }

  private isFupsEnabled(config: TimeTriggerConfig): boolean {
    if (config.enabledFups !== undefined) return config.enabledFups;
    return config.enabled ?? false; // default false - must be explicitly enabled
  }
}
