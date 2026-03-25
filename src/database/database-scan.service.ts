import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongoService } from '../mongo/mongo.service.js';

const SYSTEM_DATABASES = new Set(['admin', 'local', 'config']);
const REQUIRED_COLLECTIONS = ['runs', 'webhooks', 'vars'] as const;

@Injectable()
export class DatabaseScanService {
  private readonly logger = new Logger(DatabaseScanService.name);

  constructor(
    private readonly mongoService: MongoService,
    private readonly configService: ConfigService,
  ) {}

  async getEligibleDatabases(): Promise<string[]> {
    const allDbs = await this.mongoService.listDatabaseNames();
    const clientDbs = allDbs.filter((name) => !SYSTEM_DATABASES.has(name));

    const targetRaw = this.configService.get<string>('TARGET_DATABASES');
    const useAllDbs = !targetRaw || targetRaw.trim() === '*';

    let filteredDbs: string[];
    let excludedByFilter = 0;

    if (useAllDbs) {
      filteredDbs = clientDbs;
    } else {
      const allowList = new Set(
        targetRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
      filteredDbs = clientDbs.filter((name) => allowList.has(name));
      excludedByFilter = clientDbs.length - filteredDbs.length;
      this.logger.log(
        `TARGET_DATABASES filter: ${filteredDbs.length} allowed, ${excludedByFilter} excluded`,
      );
    }

    const eligible: string[] = [];
    const skipped: string[] = [];

    for (const dbName of filteredDbs) {
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
      `DB scan: ${filteredDbs.length} client DBs, ${eligible.length} eligible, ${skipped.length} skipped`,
    );

    return eligible;
  }
}
