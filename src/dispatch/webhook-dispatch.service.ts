import { Injectable, Logger } from '@nestjs/common';
import { Db, Document, ObjectId } from 'mongodb';

@Injectable()
export class WebhookDispatchService {
  private readonly logger = new Logger(WebhookDispatchService.name);

  async dispatch(db: Db, run: Document, webhookUrl: string): Promise<boolean> {
    const runId = run['_id'] as ObjectId;
    const success = await this.post(webhookUrl, run);

    if (success) {
      const result = await db
        .collection('runs')
        .findOneAndUpdate(
          { _id: runId, runStatus: 'waiting' },
          { $set: { runStatus: 'queued', queuedAt: new Date() } },
        );
      if (!result) {
        this.logger.warn(
          `Run ${String(runId)} already claimed by another cycle`,
        );
        return false;
      }
      return true;
    }

    // DISP-04: single non-blocking retry after 60s
    const retryFn = (): void => {
      void this.post(webhookUrl, run).then(async (retrySuccess) => {
        if (retrySuccess) {
          await db
            .collection('runs')
            .findOneAndUpdate(
              { _id: runId, runStatus: 'waiting' },
              { $set: { runStatus: 'queued', queuedAt: new Date() } },
            );
        }
        // DISP-05: if retry fails, leave run as 'waiting' — next cycle picks up
      });
    };
    setTimeout(retryFn, 60_000);
    return false;
  }

  async dispatchFup(
    db: Db,
    fup: Document,
    webhookUrl: string,
  ): Promise<boolean> {
    const fupId = fup['_id'] as ObjectId;
    const success = await this.post(webhookUrl, fup);

    if (success) {
      const result = await db
        .collection('fup')
        .findOneAndUpdate(
          { _id: fupId, status: 'on' },
          { $set: { status: 'queued' } },
        );
      if (!result) {
        this.logger.warn(
          `FUP ${String(fupId)} already claimed by another cycle`,
        );
        return false;
      }
      return true;
    }

    // FUP-07: single non-blocking retry after 60s
    const retryFn = (): void => {
      void this.post(webhookUrl, fup).then(async (retrySuccess) => {
        if (retrySuccess) {
          await db
            .collection('fup')
            .findOneAndUpdate(
              { _id: fupId, status: 'on' },
              { $set: { status: 'queued' } },
            );
        }
        // FUP-08: if retry fails, leave fup as 'on' — next cycle picks up
      });
    };
    setTimeout(retryFn, 60_000);
    return false;
  }

  async dispatchMessage(
    db: Db,
    message: Document,
    webhookUrl: string,
  ): Promise<boolean> {
    const messageId = message['_id'] as ObjectId;
    const success = await this.post(webhookUrl, message);

    if (success) {
      const result = await db
        .collection('messages')
        .findOneAndUpdate(
          { _id: messageId, messageStatus: 'pending' },
          { $set: { messageStatus: 'processing' } },
        );
      if (!result) {
        this.logger.warn(
          `Message ${String(messageId)} already claimed by another cycle`,
        );
        return false;
      }
      return true;
    }

    // MSG-07: single non-blocking retry after 60s
    const retryFn = (): void => {
      void this.post(webhookUrl, message).then(async (retrySuccess) => {
        if (retrySuccess) {
          await db
            .collection('messages')
            .findOneAndUpdate(
              { _id: messageId, messageStatus: 'pending' },
              { $set: { messageStatus: 'processing' } },
            );
        }
        // MSG-08: if retry fails, leave message as 'pending' — next cycle picks up
      });
    };
    setTimeout(retryFn, 60_000);
    return false;
  }

  private async post(url: string, run: Document): Promise<boolean> {
    try {
      // DISP-06: explicit 10s timeout prevents a hanging webhook from stalling the cycle
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(run),
        signal: AbortSignal.timeout(10_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
