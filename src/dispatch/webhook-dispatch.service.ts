import { Injectable, Logger } from '@nestjs/common';
import { Db, Document } from 'mongodb';

@Injectable()
export class WebhookDispatchService {
  private readonly logger = new Logger(WebhookDispatchService.name);

  async dispatch(db: Db, run: Document, webhookUrl: string): Promise<void> {
    const success = await this.post(webhookUrl, run);

    if (success) {
      const result = await db.collection('runs').findOneAndUpdate(
        { _id: run._id, runStatus: 'waiting' },
        { $set: { runStatus: 'queued', queuedAt: new Date() } },
      );
      if (!result) {
        this.logger.warn(`Run ${String(run._id)} already claimed by another cycle`);
      }
      return;
    }

    // DISP-04: single non-blocking retry after 60s
    setTimeout(async () => {
      const retrySuccess = await this.post(webhookUrl, run);
      if (retrySuccess) {
        await db.collection('runs').findOneAndUpdate(
          { _id: run._id, runStatus: 'waiting' },
          { $set: { runStatus: 'queued', queuedAt: new Date() } },
        );
      }
      // DISP-05: if retry fails, leave run as 'waiting' — next cycle picks up
    }, 60_000);
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
