import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap() {
    await NestFactory.createApplicationContext(WorkerModule, { logger: ['log', 'warn', 'error'] });
    // Keep process alive; worker loop starts on module init.
    console.log(`[Worker] Durable queue worker started (pid=${process.pid})`);
}

bootstrap().catch((error) => {
    console.error('[Worker] bootstrap failed:', error);
    process.exit(1);
});
