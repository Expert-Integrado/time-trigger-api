import { Module } from '@nestjs/common';
import { DatabaseScanService } from './database-scan.service.js';

@Module({
  providers: [DatabaseScanService],
  exports: [DatabaseScanService],
})
export class DatabaseModule {}
