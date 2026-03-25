import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { RunDispatchService } from './run-dispatch.service.js';
import { WebhookDispatchService } from './webhook-dispatch.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [RunDispatchService, WebhookDispatchService],
  exports: [RunDispatchService, WebhookDispatchService],
})
export class DispatchModule {}
