import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { RunDispatchService } from './run-dispatch.service.js';
import { WebhookDispatchService } from './webhook-dispatch.service.js';
import { MessageCheckService } from './message-check.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [RunDispatchService, WebhookDispatchService, MessageCheckService],
  exports: [RunDispatchService, WebhookDispatchService, MessageCheckService],
})
export class DispatchModule {}
