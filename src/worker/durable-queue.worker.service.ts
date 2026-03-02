import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { performance } from 'perf_hooks';
import { hostname } from 'os';
import { ImageStrategyFactory } from '../image-gen/image-strategy.factory';
import { PostgresStorageService, QueueTaskRow } from '../storage/postgres-storage.service';
import { ObservabilityGateway } from '../observability/observability.gateway';

@Injectable()
export class DurableQueueWorkerService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(DurableQueueWorkerService.name);
    private readonly workerId = process.env.WORKER_ID || `worker-${process.pid}`;
    private readonly pollMs = Math.max(250, Number(process.env.DURABLE_QUEUE_POLL_MS || 1000));
    private readonly leaseSeconds = Math.max(30, Number(process.env.DURABLE_QUEUE_LEASE_SECONDS || 120));
    private readonly heartbeatMs = Math.max(10000, Number(process.env.DURABLE_QUEUE_HEARTBEAT_MS || 30000));
    private readonly staleMinutes = Math.max(1, Number(process.env.DURABLE_QUEUE_STALE_MINUTES || 10));
    private readonly retryDelaySeconds = Math.max(5, Number(process.env.DURABLE_QUEUE_RETRY_DELAY_SECONDS || 30));
    private readonly taskTimeoutMs = Math.max(60000, Number(process.env.MANIFEST_TASK_TIMEOUT_MS || 120000));
    private readonly janitorEveryMs = Math.max(30000, Number(process.env.DURABLE_QUEUE_JANITOR_EVERY_MS || 60000));
    private readonly workerHeartbeatMs = Math.max(2000, Number(process.env.WORKER_HEARTBEAT_MS || process.env.DURABLE_QUEUE_HEARTBEAT_MS || 10000));
    private readonly workerHost = hostname();

    private running = false;
    private janitorTimer: NodeJS.Timeout | null = null;
    private workerHeartbeatTimer: NodeJS.Timeout | null = null;
    private currentTaskId: string | null = null;

    constructor(
        private readonly storage: PostgresStorageService,
        private readonly strategyFactory: ImageStrategyFactory,
        private readonly observability: ObservabilityGateway,
    ) {}

    async onModuleInit(): Promise<void> {
        const enabled = String(process.env.DURABLE_QUEUE_ENABLED || 'true').toLowerCase() === 'true';
        if (!enabled || !this.storage.isEnabled()) {
            this.logger.log('Durable queue worker disabled (DURABLE_QUEUE_ENABLED or POSTGRES_ENABLED false).');
            return;
        }
        this.running = true;
        this.logger.log(`Starting durable queue worker ${this.workerId}`);
        await this.storage.upsertWorkerHeartbeat({
            workerId: this.workerId,
            pid: process.pid,
            host: this.workerHost,
            signature: 'viz-worker',
            status: 'ACTIVE',
            metadata: { started_at: new Date().toISOString() },
        });
        this.startWorkerHeartbeat();
        this.startJanitor();
        void this.loop();
    }

    async onModuleDestroy(): Promise<void> {
        this.running = false;
        if (this.janitorTimer) clearInterval(this.janitorTimer);
        if (this.workerHeartbeatTimer) clearInterval(this.workerHeartbeatTimer);
        await this.storage.markWorkerStatus(this.workerId, 'SHUTDOWN', { stopped_at: new Date().toISOString() });
    }

    private async loop(): Promise<void> {
        while (this.running) {
            try {
                const row = await this.storage.claimNextQueuedTask(this.workerId, this.leaseSeconds);
                if (!row) {
                    await this.sleep(this.pollMs);
                    continue;
                }
                await this.processClaimedTask(row);
            } catch (error: any) {
                this.logger.warn(`Worker loop error: ${error?.message || error}`);
                await this.sleep(this.pollMs);
            }
        }
    }

    private async processClaimedTask(row: QueueTaskRow): Promise<void> {
        const task = row?.payload || {};
        const taskId = String(row.task_id || task?.id || '').trim();
        const batchId = String(row.batch_id || task?.metadata?.batch_id || '').trim() || undefined;
        if (!taskId) return;
        this.currentTaskId = taskId;
        await this.storage.setWorkerCurrentTask(this.workerId, taskId);

        const heartbeat = setInterval(() => {
            void this.storage.heartbeatTask(taskId, this.workerId, this.leaseSeconds);
        }, this.heartbeatMs);

        const startedAt = new Date();
        const perfStart = performance.now();
        this.observability.emitProgress({ taskId, batchId, status: 'processing', stage: 'Starting Generation...' } as any);
        this.observability.emitLog('info', `Worker claimed task (attempt ${row.attempts}/${row.max_attempts})`, 'Worker', taskId, batchId);

        try {
            const strategy = this.strategyFactory.getStrategy(task);
            const result: any = await this.withTimeout((strategy as any).performGeneration(task, 1), this.taskTimeoutMs, `Task timeout after ${this.taskTimeoutMs}ms`);
            const durationMs = performance.now() - perfStart;
            const endedAt = new Date();

            await this.storage.completeDurableTask(taskId, result?.url || null, {
                started_at: startedAt.toISOString(),
                ended_at: endedAt.toISOString(),
                duration_ms: durationMs.toFixed(2),
                output_dir: result?.payload?.output_dir,
                image_prompts: result?.payload?.image_prompts,
                blueprint_prompt: result?.payload?.blueprint_prompt,
                source_provider: result?.payload?.source_provider,
                source_query: result?.payload?.source_query,
                sourced_queries: result?.payload?.sourced_queries,
                sourced_candidates: result?.payload?.sourced_candidates,
                sourced_query_signals: result?.payload?.sourced_query_signals,
                sourced_query_config: result?.payload?.sourced_query_config,
                clip_score: result?.payload?.metrics?.clip_score,
                vision_score: result?.payload?.metrics?.vision_score,
                styling_guidance: task?.metadata?.styling_guidance,
            }, result?.payload?.metrics || {});

            this.observability.emitProgress({
                taskId,
                batchId,
                status: 'completed',
                url: result?.url,
                metrics: result?.payload?.metrics || {},
                details: {
                    started_at: startedAt.toISOString(),
                    ended_at: endedAt.toISOString(),
                    duration_ms: durationMs.toFixed(2),
                    output_dir: result?.payload?.output_dir,
                    image_prompts: result?.payload?.image_prompts,
                    blueprint_prompt: result?.payload?.blueprint_prompt,
                    source_provider: result?.payload?.source_provider,
                    source_query: result?.payload?.source_query,
                    sourced_queries: result?.payload?.sourced_queries,
                    sourced_candidates: result?.payload?.sourced_candidates,
                    sourced_query_signals: result?.payload?.sourced_query_signals,
                    sourced_query_config: result?.payload?.sourced_query_config,
                    clip_score: result?.payload?.metrics?.clip_score,
                    vision_score: result?.payload?.metrics?.vision_score,
                    styling_guidance: task?.metadata?.styling_guidance,
                }
            } as any);

            this.observability.emitLog('success', `Worker completed task in ${durationMs.toFixed(0)}ms`, 'Worker', taskId, batchId);
        } catch (error: any) {
            const message = String(error?.message || 'Unknown task failure');
            const disposition = await this.storage.failOrRequeueDurableTask(taskId, message, this.retryDelaySeconds);
            this.observability.emitProgress({
                taskId,
                batchId,
                status: disposition === 'failed' ? 'failed' : 'pending',
                stage: disposition === 'failed' ? 'Failed' : 'Queued for Retry',
                details: { error: message }
            } as any);
            this.observability.emitLog(
                disposition === 'failed' ? 'error' : 'warn',
                `Worker task ${disposition}: ${message}`,
                'Worker',
                taskId,
                batchId
            );
        } finally {
            clearInterval(heartbeat);
            this.currentTaskId = null;
            await this.storage.setWorkerCurrentTask(this.workerId, null);
            if (batchId) await this.storage.updateBatchRunProgress(batchId);
        }
    }

    private startJanitor(): void {
        this.janitorTimer = setInterval(() => {
            void (async () => {
                const recovered = await this.storage.requeueOrphanedProcessingTasks(this.staleMinutes);
                if (recovered > 0) {
                    this.observability.emitLog('warn', `Janitor recovered ${recovered} orphaned task(s)`, 'Worker');
                }
            })();
        }, this.janitorEveryMs);
    }

    private startWorkerHeartbeat(): void {
        this.workerHeartbeatTimer = setInterval(() => {
            void this.storage.touchWorkerHeartbeat(this.workerId, this.currentTaskId);
        }, this.workerHeartbeatMs);
    }

    private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
        let timer: NodeJS.Timeout | null = null;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                const err: any = new Error(timeoutMessage);
                err.code = 'TASK_TIMEOUT';
                reject(err);
            }, timeoutMs);
        });
        try {
            return await Promise.race([promise, timeoutPromise]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    private async sleep(ms: number): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, ms));
    }
}
