import { Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module.js';
import { DatabaseScanService } from './database/database-scan.service.js';
import { MongoModule } from './mongo/mongo.module.js';
import { SchedulerModule } from './scheduler/scheduler.module.js';
import { HealthModule } from './health/health.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    MongoModule,
    DatabaseModule,
    SchedulerModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements OnApplicationBootstrap {
  private readonly logger = new Logger('Bootstrap');

  constructor(private readonly databaseScanService: DatabaseScanService) {}

  async onApplicationBootstrap(): Promise<void> {
    const eligible = await this.databaseScanService.getEligibleDatabases();
    this.logger.log(
      `Startup scan complete: ${eligible.length} eligible databases found`,
    );
  }
}
