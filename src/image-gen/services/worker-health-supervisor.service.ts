import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PostgresStorageService } from '../../storage/postgres-storage.service';
import { ObservabilityGateway } from '../../observability/observability.gateway';

@Injectable()
export class WorkerHealthSupervisorService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(WorkerHealthSupervisorService.name);
    private readonly enabled =
        String(process.env.DURABLE_QUEUE_ENABLED || 'true').toLowerCase() === 'true'
        && String(process.env.WORKER_SUPERVISOR_ENABLED || 'true').toLowerCase() === 'true';
    private readonly workerTimeoutMs = Math.max(5000, Number(process.env.WORKER_TIMEOUT_MS || 30000));
    private readonly pollMs = Math.max(2000, Number(process.env.WORKER_SUPERVISOR_POLL_MS || process.env.WORKER_HEARTBEAT_MS || 10000));
    private timer: NodeJS.Timeout | null = null;

    constructor(
        private readonly storage: PostgresStorageService,
        private readonly observability: ObservabilityGateway,
    ) {}

    onModuleInit(): void {
        if (!this.enabled || !this.storage.isEnabled()) return;
        this.timer = setInterval(() => void this.tick(), this.pollMs);
        this.logger.log(`Worker supervisor enabled (poll=${this.pollMs}ms timeout=${this.workerTimeoutMs}ms)`);
    }

    onModuleDestroy(): void {
        if (this.timer) clearInterval(this.timer);
    }

    private async tick(): Promise<void> {
        const recovered = await this.storage.recoverTimedOutWorkers(this.workerTimeoutMs);
        if (!recovered.workers.length) return;
        const msg = `Supervisor recovered workers=${recovered.workers.length} tasks=${recovered.tasks.length}`;
        this.logger.warn(msg);
        this.observability.emitLog('warn', msg, 'Supervisor');
    }
}

