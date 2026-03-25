import { Injectable, Logger } from '@nestjs/common';
import { MongoService } from '../mongo/mongo.service.js';

const SYSTEM_DATABASES = new Set(['admin', 'local', 'config']);
const REQUIRED_COLLECTIONS = ['runs', 'webhooks', 'vars'] as const;

@Injectable()
export class DatabaseScanService {
  private readonly logger = new Logger(DatabaseScanService.name);

  constructor(private readonly mongoService: MongoService) {}

  async getEligibleDatabases(): Promise<string[]> {
    const allDbs = await this.mongoService.listDatabaseNames();
    const clientDbs = allDbs.filter((name) => !SYSTEM_DATABASES.has(name));

    const eligible: string[] = [];
    const skipped: string[] = [];

    for (const dbName of clientDbs) {
      const db = this.mongoService.db(dbName);
      const collections = await db.listCollections().toArray();
      const names = new Set(collections.map((c: { name: string }) => c.name));
      const hasAll = REQUIRED_COLLECTIONS.every((col) => names.has(col));

      if (hasAll) {
        eligible.push(dbName);
      } else {
        skipped.push(dbName);
      }
    }

    this.logger.log(
      `DB scan: ${clientDbs.length} client DBs, ${eligible.length} eligible, ${skipped.length} skipped`,
    );

    return eligible;
  }
}
