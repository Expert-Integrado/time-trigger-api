import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DispatchModule } from '../dispatch/dispatch.module.js';
import { SchedulerService } from './scheduler.service.js';

@Module({
  imports: [ScheduleModule.forRoot(), DispatchModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
