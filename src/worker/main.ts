import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['log', 'warn', 'error'] });
    // Keep process alive; worker loop starts on module init.
    console.log(`[Worker] Durable queue worker started (pid=${process.pid})`);

    const shutdown = async () => {
        try {
            await app.close();
        } finally {
            process.exit(0);
        }
    };

    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
}

bootstrap().catch((error) => {
    console.error('[Worker] bootstrap failed:', error);
    process.exit(1);
});
