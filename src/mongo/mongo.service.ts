import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Db, MongoClient } from 'mongodb';

@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MongoService.name);
  private client: MongoClient;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const uri = this.configService.getOrThrow<string>('MONGODB_URI');
    this.client = new MongoClient(uri, {
      maxPoolSize: 20,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
    });
    await this.client.connect();
    this.logger.log('MongoDB connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.close();
    this.logger.log('MongoDB connection closed');
  }

  db(name: string): Db {
    return this.client.db(name);
  }

  async listDatabaseNames(): Promise<string[]> {
    const result = (await this.client
      .db('admin')
      .command({ listDatabases: 1, nameOnly: true })) as {
      databases: { name: string }[];
    };
    return result.databases.map((d) => d.name);
  }
}
