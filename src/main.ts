import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const REQUIRED_ENV_VARS = [
  'MONGODB_URI',
  'CRON_INTERVAL_RUNS',
  'CRON_INTERVAL_FUP',
  'CRON_INTERVAL_MESSAGES',
  'CRON_INTERVAL_RECOVERY',
  'TZ',
] as const;

export function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(
      `[Bootstrap] Missing required environment variables: ${missing.join(', ')}`,
    );
    process.exit(1);
  }
}

async function bootstrap() {
  validateEnv();
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env['PORT'] ?? 3000);
}

// Only run bootstrap when executed as the entry point, not when imported in tests
if (require.main === module) {
  bootstrap();
}
