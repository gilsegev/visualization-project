import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { ObservabilityGateway } from '../observability/observability.gateway';

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['log', 'warn', 'error'] });
    try {
        const observability = app.get(ObservabilityGateway);
        observability.emitLog(
            'info',
            'Startup config snapshot',
            'Startup',
            undefined,
            undefined,
            {
                metadata: {
                    event_kind: 'startup_snapshot',
                    process_role: 'worker',
                    pid: process.pid,
                    worker_id: String(process.env.WORKER_ID || '').trim() || null,
                    worker_slot: String(process.env.WORKER_SLOT || '').trim() || null,
                    durable_queue_poll_ms: Math.max(250, Number(process.env.DURABLE_QUEUE_POLL_MS || 1000)),
                    durable_queue_heartbeat_ms: Math.max(5000, Number(process.env.DURABLE_QUEUE_HEARTBEAT_MS || 10000)),
                    manifest_task_timeout_ms: Math.max(60000, Number(process.env.MANIFEST_TASK_TIMEOUT_MS || 120000)),
                    quota_infographic: Math.max(0, Number(process.env.QUOTA_INFOGRAPHIC || 10)),
                    quota_chart: Math.max(0, Number(process.env.QUOTA_CHART || 50)),
                    quota_generated_image: Math.max(0, Number(process.env.QUOTA_GENERATED_IMAGE || 20)),
                    quota_sourced_image: Math.max(0, Number(process.env.QUOTA_SOURCED_IMAGE || 100)),
                },
            },
        );
    } catch {
        // Best effort diagnostics only.
    }
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
