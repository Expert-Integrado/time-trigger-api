import { Injectable, Logger } from '@nestjs/common';
import { Db, Document, ObjectId } from 'mongodb';

@Injectable()
export class WebhookDispatchService {
  private readonly logger = new Logger(WebhookDispatchService.name);

  async dispatch(db: Db, run: Document, webhookUrl: string): Promise<boolean> {
    const runId = run['_id'] as ObjectId;

    // DISP-02: Claim first - atomically update runStatus 'waiting' → 'queued' before POST
    const claimResult = await db
      .collection('runs')
      .findOneAndUpdate(
        { _id: runId, runStatus: 'waiting' },
        { $set: { runStatus: 'queued', queuedAt: new Date() } },
      );

    if (!claimResult) {
      this.logger.warn(
        `Run ${String(runId)} already claimed by another cycle`,
      );
      return false;
    }

    // DISP-02: POST to webhook after successful claim
    const success = await this.post(webhookUrl, run);

    if (!success) {
      // DISP-02: Revert status 'queued' → 'waiting' on failed POST
      await db
        .collection('runs')
        .findOneAndUpdate(
          { _id: runId, runStatus: 'queued' },
          { $set: { runStatus: 'waiting' }, $unset: { queuedAt: '' } },
        );

      // DISP-04: single non-blocking retry after 60s with claim-first pattern
      const retryFn = (): void => {
        void (async () => {
          // DISP-02: Retry also uses claim-first pattern
          const retryClaimResult = await db
            .collection('runs')
            .findOneAndUpdate(
              { _id: runId, runStatus: 'waiting' },
              { $set: { runStatus: 'queued', queuedAt: new Date() } },
            );

          if (!retryClaimResult) {
            return;
          }

          const retrySuccess = await this.post(webhookUrl, run);

          if (!retrySuccess) {
            // DISP-02: Revert retry claim on failure
            await db
              .collection('runs')
              .findOneAndUpdate(
                { _id: runId, runStatus: 'queued' },
                { $set: { runStatus: 'waiting' }, $unset: { queuedAt: '' } },
              );
          }
          // DISP-05: if retry succeeds, status stays 'queued' — webhook processes
        })();
      };
      setTimeout(retryFn, 60_000);
      return false;
    }

    // DISP-02: Success - status stays 'queued'
    return true;
  }

  async dispatchFup(
    db: Db,
    fup: Document,
    webhookUrl: string,
  ): Promise<boolean> {
    const fupId = fup['_id'] as ObjectId;

    // FUP-06: Claim first - atomically update status 'on' → 'queued' before POST
    const claimResult = await db
      .collection('fup')
      .findOneAndUpdate(
        { _id: fupId, status: 'on' },
        { $set: { status: 'queued' } },
      );

    if (!claimResult) {
      this.logger.warn(`FUP ${String(fupId)} already claimed by another cycle`);
      return false;
    }

    // FUP-06: POST to webhook after successful claim
    const success = await this.post(webhookUrl, fup);

    if (!success) {
      // FUP-06: Revert status 'queued' → 'on' on failed POST
      await db
        .collection('fup')
        .findOneAndUpdate(
          { _id: fupId, status: 'queued' },
          { $set: { status: 'on' } },
        );

      // FUP-07: single non-blocking retry after 60s with claim-first pattern
      const retryFn = (): void => {
        void (async () => {
          // FUP-06: Retry also uses claim-first pattern
          const retryClaimResult = await db
            .collection('fup')
            .findOneAndUpdate(
              { _id: fupId, status: 'on' },
              { $set: { status: 'queued' } },
            );

          if (!retryClaimResult) {
            return;
          }

          const retrySuccess = await this.post(webhookUrl, fup);

          if (!retrySuccess) {
            // FUP-06: Revert retry claim on failure
            await db
              .collection('fup')
              .findOneAndUpdate(
                { _id: fupId, status: 'queued' },
                { $set: { status: 'on' } },
              );
          }
          // FUP-08: if retry succeeds, status stays 'queued' — webhook processes
        })();
      };
      setTimeout(retryFn, 60_000);
      return false;
    }

    // FUP-06: Success - status stays 'queued'
    return true;
  }

  async dispatchMessage(
    db: Db,
    message: Document,
    webhookUrl: string,
  ): Promise<boolean> {
    const messageId = message['_id'] as ObjectId;

    // MSG-05: Claim first - atomically update messageStatus 'pending' → 'processing' before POST
    const claimResult = await db.collection('messages').findOneAndUpdate(
      { _id: messageId, messageStatus: 'pending' },
      {
        $set: {
          messageStatus: 'processing',
          processingStartedAt: new Date(),
        },
      },
    );

    if (!claimResult) {
      this.logger.warn(
        `Message ${String(messageId)} already claimed by another cycle`,
      );
      return false;
    }

    // MSG-05: POST to webhook after successful claim
    const success = await this.post(webhookUrl, message);

    if (!success) {
      // MSG-05: Revert status 'processing' → 'pending' on failed POST
      await db.collection('messages').findOneAndUpdate(
        { _id: messageId, messageStatus: 'processing' },
        {
          $set: { messageStatus: 'pending' },
          $unset: { processingStartedAt: '' },
        },
      );

      // MSG-07: single non-blocking retry after 60s with claim-first pattern
      const retryFn = (): void => {
        void (async () => {
          // MSG-05: Retry also uses claim-first pattern
          const retryClaimResult = await db
            .collection('messages')
            .findOneAndUpdate(
              { _id: messageId, messageStatus: 'pending' },
              {
                $set: {
                  messageStatus: 'processing',
                  processingStartedAt: new Date(),
                },
              },
            );

          if (!retryClaimResult) {
            return;
          }

          const retrySuccess = await this.post(webhookUrl, message);

          if (!retrySuccess) {
            // MSG-05: Revert retry claim on failure
            await db.collection('messages').findOneAndUpdate(
              { _id: messageId, messageStatus: 'processing' },
              {
                $set: { messageStatus: 'pending' },
                $unset: { processingStartedAt: '' },
              },
            );
          }
          // MSG-08: if retry succeeds, status stays 'processing' — webhook processes
        })();
      };
      setTimeout(retryFn, 60_000);
      return false;
    }

    // MSG-05: Success - status stays 'processing'
    return true;
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
