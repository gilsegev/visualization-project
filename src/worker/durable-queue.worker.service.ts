import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { performance } from 'perf_hooks';
import { hostname } from 'os';
import { ImageStrategyFactory } from '../image-gen/image-strategy.factory';
import { DailyUsageAssetType, PostgresStorageService, QueueTaskRow } from '../storage/postgres-storage.service';
import { ObservabilityGateway } from '../observability/observability.gateway';

@Injectable()
export class DurableQueueWorkerService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(DurableQueueWorkerService.name);
    private readonly workerId = (() => {
        const explicit = String(process.env.WORKER_ID || '').trim();
        if (explicit) return explicit;
        const slot = String(process.env.WORKER_SLOT || '0').trim() || '0';
        return `${hostname()}-w${slot}`;
    })();
    private readonly pollMs = Math.max(250, Number(process.env.DURABLE_QUEUE_POLL_MS || 1000));
    private readonly leaseSeconds = Math.max(30, Number(process.env.DURABLE_QUEUE_LEASE_SECONDS || 120));
    private readonly heartbeatMs = Math.max(5000, Number(process.env.DURABLE_QUEUE_HEARTBEAT_MS || 10000));
    private readonly staleMinutes = Math.max(1, Number(process.env.DURABLE_QUEUE_STALE_MINUTES || 10));
    private readonly retryDelaySeconds = Math.max(5, Number(process.env.DURABLE_QUEUE_RETRY_DELAY_SECONDS || 30));
    private readonly taskTimeoutMs = Math.max(60000, Number(process.env.MANIFEST_TASK_TIMEOUT_MS || 120000));
    private readonly janitorEveryMs = Math.max(30000, Number(process.env.DURABLE_QUEUE_JANITOR_EVERY_MS || 60000));
    private readonly workerHeartbeatMs = Math.max(2000, Number(process.env.WORKER_HEARTBEAT_MS || process.env.DURABLE_QUEUE_HEARTBEAT_MS || 10000));
    private readonly workerHost = hostname();
    private readonly costStoryUsd = Math.max(0, Number(process.env.TASK_COST_STORY_IMAGE_USD || 0.02));
    private readonly costSourcedUsd = Math.max(0, Number(process.env.TASK_COST_SOURCED_IMAGE_USD || 0.03));
    private readonly costDataVizUsd = Math.max(0, Number(process.env.TASK_COST_DATA_VIZ_USD || 0.01));
    private readonly costInfographicUsd = Math.max(0, Number(process.env.TASK_COST_INFOGRAPHIC_USD || 0.01));
    private readonly quotaSourcedImage = Math.max(0, Number(process.env.QUOTA_SOURCED_IMAGE || 100));
    private readonly quotaGeneratedImage = Math.max(0, Number(process.env.QUOTA_GENERATED_IMAGE || 20));
    private readonly quotaChart = Math.max(0, Number(process.env.QUOTA_CHART || 50));
    private readonly quotaInfographic = Math.max(0, Number(process.env.QUOTA_INFOGRAPHIC || 10));

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
        const userId = this.resolveUserId(task, row);
        const estimatedCostUsd = this.estimateTaskCostUsd(task);
        const assetType = this.resolveDailyAssetType(task);
        const assetQuotaLimit = this.resolveDailyAssetQuotaLimit(assetType);
        this.currentTaskId = taskId;
        await this.storage.setWorkerCurrentTask(this.workerId, taskId);

        const heartbeat = setInterval(() => {
            void this.storage.heartbeatTask(taskId, this.workerId, this.leaseSeconds);
        }, this.heartbeatMs);

        const startedAt = new Date();
        const perfStart = performance.now();
        this.logger.log(`Claimed task ${taskId} (attempt ${row.attempts}/${row.max_attempts})`);
        this.observability.emitProgress({ taskId, batchId, status: 'processing', stage: 'Starting Generation...' } as any);
        this.observability.emitLog('info', `Worker claimed task (attempt ${row.attempts}/${row.max_attempts})`, 'Worker', taskId, batchId);

        try {
            await this.storage.recordTaskCost(taskId, {
                estimated_usd: estimatedCostUsd,
                actual_usd: 0,
                provider: task?.type || 'worker',
                model: String(task?.metadata?.template_type || task?.type || 'unknown'),
            });
            if (userId) {
                const quotaResult = await this.storage.reserveDailyAssetQuota(userId, assetType, assetQuotaLimit);
                if (!quotaResult.allowed) {
                    const quotaMsg = `429 Too Many Requests: daily quota exceeded for ${assetType} user=${userId} count=${quotaResult.currentCount} limit=${assetQuotaLimit} date=${quotaResult.usageDateUtc}`;
                    await this.storage.failDurableTaskImmediately(taskId, quotaMsg);
                    this.observability.emitProgress({
                        taskId,
                        batchId,
                        status: 'failed',
                        stage: 'Rate Limit Exceeded',
                        details: {
                            error: quotaMsg,
                            user_id: userId,
                            http_status: 429,
                            asset_type: assetType,
                            quota_limit: assetQuotaLimit,
                            quota_count: quotaResult.currentCount,
                            usage_date_utc: quotaResult.usageDateUtc,
                            estimated_cost_usd: estimatedCostUsd.toFixed(6),
                        }
                    } as any);
                    this.observability.emitLog('warn', quotaMsg, 'Worker', taskId, batchId);
                    return;
                }
                const budget = await this.storage.getUserDailyBudget(userId);
                const projected = budget.estimatedUsd + budget.actualUsd + estimatedCostUsd;
                if (Number.isFinite(budget.dailyQuotaUsd) && projected > Number(budget.dailyQuotaUsd)) {
                    const quotaMsg = `Daily quota exceeded for user ${userId}: projected=$${projected.toFixed(4)} quota=$${Number(budget.dailyQuotaUsd).toFixed(4)}`;
                    await this.storage.recordTaskCost(taskId, {
                        estimated_usd: estimatedCostUsd,
                        actual_usd: 0,
                        provider: 'quota_guard',
                        model: String(task?.type || 'unknown'),
                    });
                    await this.storage.failDurableTaskImmediately(taskId, quotaMsg);
                    this.observability.emitProgress({
                        taskId,
                        batchId,
                        status: 'failed',
                        stage: 'Quota Exceeded',
                        details: { error: quotaMsg, user_id: userId, estimated_cost_usd: estimatedCostUsd.toFixed(6) }
                    } as any);
                    this.observability.emitLog('warn', quotaMsg, 'Worker', taskId, batchId);
                    return;
                }
            }
            const strategy = this.strategyFactory.getStrategy(task);
            const result: any = await this.withTimeout((strategy as any).generate(task, 1), this.taskTimeoutMs, `Task timeout after ${this.taskTimeoutMs}ms`);
            const durationMs = performance.now() - perfStart;
            const endedAt = new Date();
            const actualCostUsd = this.resolveActualCostUsd(result, estimatedCostUsd);

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
            await this.storage.recordTaskCost(taskId, {
                estimated_usd: estimatedCostUsd,
                actual_usd: actualCostUsd,
                provider: result?.payload?.source_provider || task?.type || 'worker',
                model: result?.payload?.model || result?.payload?.metrics?.model || undefined,
            });

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

            this.observability.emitLog(
                'success',
                `Worker completed task in ${durationMs.toFixed(0)}ms | est_cost_usd=${estimatedCostUsd.toFixed(6)} actual_cost_usd=${actualCostUsd.toFixed(6)}`,
                'Worker',
                taskId,
                batchId
            );
            this.logger.log(`Completed task ${taskId} in ${durationMs.toFixed(0)}ms`);
        } catch (error: any) {
            const message = String(error?.message || 'Unknown task failure');
            const stack = typeof error?.stack === 'string'
                ? error.stack.split('\n').slice(0, 5).join(' | ')
                : undefined;
            await this.storage.recordTaskCost(taskId, {
                estimated_usd: estimatedCostUsd,
                actual_usd: 0,
                provider: task?.type || 'worker',
            });
            const disposition = await this.storage.failOrRequeueDurableTask(taskId, message, this.retryDelaySeconds);
            this.logger.error(
                `Task ${taskId} ${disposition}. message="${message}"${stack ? ` stack="${stack}"` : ''}`
            );
            this.observability.emitProgress({
                taskId,
                batchId,
                status: disposition === 'failed' ? 'failed' : 'pending',
                stage: disposition === 'failed' ? 'Failed' : 'Queued for Retry',
                details: { error: message, stack }
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

    private resolveUserId(task: any, row: QueueTaskRow): number | null {
        const raw = task?.metadata?.user_id ?? row?.metadata?.user_id;
        const parsed = Number(raw);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    private estimateTaskCostUsd(task: any): number {
        const type = String(task?.type || task?.metadata?.task_type || '').toLowerCase();
        if (type === 'sourced_image') return this.costSourcedUsd;
        if (type === 'story_image') return this.costStoryUsd;
        if (type === 'data_viz') return this.costDataVizUsd;
        return this.costInfographicUsd;
    }

    private resolveActualCostUsd(result: any, fallback: number): number {
        const fromActual = Number(result?.payload?.metrics?.actual_cost_usd);
        if (Number.isFinite(fromActual) && fromActual >= 0) return fromActual;
        const fromEstimated = Number(result?.payload?.metrics?.estimated_cost_usd);
        if (Number.isFinite(fromEstimated) && fromEstimated >= 0) return fromEstimated;
        return fallback;
    }

    private resolveDailyAssetType(task: any): DailyUsageAssetType {
        const t = String(task?.type || task?.metadata?.task_type || '').toLowerCase();
        if (t === 'sourced_image') return 'SOURCED_IMAGE';
        if (t === 'story_image') return 'GENERATED_IMAGE';
        if (t === 'data_viz') return 'CHART';
        return 'INFOGRAPHIC';
    }

    private resolveDailyAssetQuotaLimit(assetType: DailyUsageAssetType): number {
        if (assetType === 'SOURCED_IMAGE') return this.quotaSourcedImage;
        if (assetType === 'GENERATED_IMAGE') return this.quotaGeneratedImage;
        if (assetType === 'CHART') return this.quotaChart;
        return this.quotaInfographic;
    }
}
