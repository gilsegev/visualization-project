import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { createHash } from 'crypto';
import { normalizeDbResultPath } from '../common/path-safety.util';

export type AuthUser = {
    id: number;
    email: string;
    name: string;
    role: string;
    daily_quota: number | null;
};

export type QueueTaskRow = {
    task_id: string;
    batch_id: string | null;
    queue_status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
    attempts: number;
    max_attempts: number;
    payload: any;
    metadata: any;
    details: any;
};

export type DocumentJobState =
    | 'queued'
    | 'analyzing'
    | 'planning'
    | 'generating_assets'
    | 'inserting'
    | 'packaging'
    | 'completed'
    | 'failed';

export type DocumentJobRow = {
    job_id: string;
    user_id: number;
    request_hash: string | null;
    queue_status: 'queued' | 'processing' | 'completed' | 'failed';
    state: DocumentJobState;
    source_object_key: string;
    doc_version_hash: string;
    manifest_version: number;
    attempts: number;
    max_attempts: number;
    metadata: any;
};

export type WorkerHeartbeatStatus = 'ACTIVE' | 'SHUTDOWN' | 'TERMINATED';

export type WorkerHeartbeatRow = {
    worker_id: string;
    pid: number | null;
    host: string | null;
    signature: string | null;
    status: WorkerHeartbeatStatus;
    started_at: string;
    last_seen_at: string;
    current_task_id: string | null;
    metadata: any;
};

export type QueueHealthStats = {
    pending: number;
    completed: number;
    failed: number;
};

export type DailyUsageAssetType = 'SOURCED_IMAGE' | 'GENERATED_IMAGE' | 'CHART' | 'INFOGRAPHIC';

export type TaskDeltaRow = {
    task_id: string;
    batch_id: string | null;
    status: string | null;
    stage: string | null;
    url: string | null;
    details: any;
    metadata: any;
    updated_at: string;
};

export type SystemLogRow = {
    id: number;
    created_at: string;
    level: string;
    message: string;
    context: string | null;
    task_id: string | null;
    batch_id: string | null;
    event_id: string | null;
    source_role: string | null;
    source_pid: number | null;
    source_worker_id: string | null;
    metadata: any;
};

export type StrategyTelemetryRow = {
    strategy: string;
    total: number;
    completed: number;
    failed: number;
    success_rate_pct: number;
    avg_latency_ms: number;
};

export type DocumentQueueHealthStats = {
    queued: number;
    processing: number;
    completed: number;
    failed: number;
};

export type DocumentObservabilityMetrics = {
    completed_total: number;
    failed_total: number;
    retries_total: number;
    avg_duration_ms: number;
    p95_duration_ms: number;
    flowchart_fallback_total: number;
};

export type DocumentJobObsRow = {
    job_id: string;
    user_id: number;
    state: string;
    queue_status: string;
    attempts: number;
    max_attempts: number;
    updated_at: string;
};

export type DocumentArtifactObsRow = {
    artifact_type: string;
    object_key: string;
    byte_size: number | null;
    checksum_sha256: string | null;
    metadata: any;
    created_at: string;
};

@Injectable()
export class PostgresStorageService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(PostgresStorageService.name);
    private readonly enabled: boolean;
    private pool: Pool | null = null;

    constructor(private readonly configService: ConfigService) {
        this.enabled = String(this.configService.get<string>('POSTGRES_ENABLED') || 'false').toLowerCase() === 'true';
    }

    async onModuleInit(): Promise<void> {
        if (!this.enabled) return;
        const connectionString = String(this.configService.get<string>('DATABASE_URL') || '').trim();
        this.pool = connectionString
            ? new Pool({ connectionString })
            : new Pool({
                host: this.configService.get<string>('PGHOST'),
                port: Number(this.configService.get<string>('PGPORT') || 5432),
                user: this.configService.get<string>('PGUSER'),
                password: this.configService.get<string>('PGPASSWORD'),
                database: this.configService.get<string>('PGDATABASE'),
            });
        await this.ensureSchema();
        await this.ensureInitialAdmin();
        this.logger.log('PostgreSQL storage enabled');
    }

    async onModuleDestroy(): Promise<void> {
        if (this.pool) await this.pool.end();
    }

    async upsertBatchInitialized(tasks: Record<string, any>): Promise<void> {
        if (!this.pool) return;
        const entries = Object.entries(tasks || {});
        if (!entries.length) return;
        const first = entries[0][1] || {};
        const batchId = String(first?.batchId || first?.metadata?.batch_id || '').trim();
        if (!batchId) return;
        await this.query(
            `INSERT INTO batch_runs (batch_id, total, status, started_at, metadata)
             VALUES ($1, $2, 'running', NOW(), $3::jsonb)
             ON CONFLICT (batch_id) DO UPDATE
             SET total = EXCLUDED.total,
                 status = 'running',
                 metadata = COALESCE(batch_runs.metadata, '{}'::jsonb) || EXCLUDED.metadata`,
            [batchId, entries.length, JSON.stringify({ initialized_tasks: entries.length })]
        );
    }

    async enqueueDurableTasks(batchId: string, courseTitle: string | null, tasks: any[]): Promise<void> {
        if (!this.pool || !batchId || !Array.isArray(tasks) || !tasks.length) return;
        await this.query(
            `INSERT INTO batch_runs (batch_id, total, status, started_at, metadata, course_title)
             VALUES ($1, $2, 'queued', NOW(), $3::jsonb, $4)
             ON CONFLICT (batch_id) DO UPDATE
             SET total = EXCLUDED.total,
                 status = 'queued',
                 metadata = COALESCE(batch_runs.metadata, '{}'::jsonb) || EXCLUDED.metadata,
                 course_title = COALESCE(EXCLUDED.course_title, batch_runs.course_title),
                 updated_at = NOW()`,
            [batchId, tasks.length, JSON.stringify({ enqueued_tasks: tasks.length }), courseTitle || null]
        );

        for (const task of tasks) {
            const taskId = String(task?.id || '').trim();
            if (!taskId) continue;
            const payload = task?.payload ?? {};
            const metadata = task?.metadata ?? {};
            await this.query(
                `INSERT INTO tasks (
                    task_id, batch_id, user_id, queue_status, status, stage, title, attempts, max_attempts,
                    available_at, payload, metadata, details, updated_at
                ) VALUES (
                    $1, $2, $3, 'queued', 'pending', 'Queued for Generation', $4, 0, $5, NOW(),
                    $6::jsonb, $7::jsonb, $8::jsonb, NOW()
                )
                ON CONFLICT (task_id) DO UPDATE SET
                    batch_id = COALESCE(EXCLUDED.batch_id, tasks.batch_id),
                    user_id = COALESCE(EXCLUDED.user_id, tasks.user_id),
                    queue_status = 'queued',
                    status = 'pending',
                    stage = 'Queued for Generation',
                    title = COALESCE(EXCLUDED.title, tasks.title),
                    payload = EXCLUDED.payload,
                    metadata = COALESCE(EXCLUDED.metadata, tasks.metadata),
                    details = COALESCE(EXCLUDED.details, tasks.details),
                    available_at = NOW(),
                    lease_owner = NULL,
                    lease_expires_at = NULL,
                    last_heartbeat_at = NULL,
                    updated_at = NOW()`,
                [
                    taskId,
                    batchId,
                    metadata?.user_id || null,
                    String(metadata?.title || metadata?.lesson_title || task?.refined_prompt || '').slice(0, 500) || null,
                    Number(process.env.DURABLE_QUEUE_MAX_ATTEMPTS || 3) || 3,
                    JSON.stringify(task),
                    JSON.stringify(metadata || {}),
                    JSON.stringify({
                        refined_prompt: task?.refined_prompt || null,
                        original_instruction: metadata?.original_instruction || null,
                        styling_guidance: metadata?.styling_guidance || null,
                    }),
                ]
            );
        }
    }

    async enqueueDocumentJob(input: {
        jobId: string;
        userId: number;
        requestHash?: string | null;
        sourceObjectKey: string;
        docVersionHash: string;
        metadata?: any;
        maxAttempts?: number;
    }): Promise<void> {
        if (!this.pool || !input?.jobId || !input?.userId) return;
        await this.query(
            `INSERT INTO document_jobs (
                job_id, user_id, request_hash, queue_status, state, source_object_key, doc_version_hash,
                manifest_version, attempts, max_attempts, available_at, metadata, created_at, updated_at
            ) VALUES (
                $1, $2, $3, 'queued', 'queued', $4, $5, 1, 0, $6, NOW(), $7::jsonb, NOW(), NOW()
            )
            ON CONFLICT (job_id) DO UPDATE SET
                user_id = EXCLUDED.user_id,
                request_hash = COALESCE(EXCLUDED.request_hash, document_jobs.request_hash),
                source_object_key = EXCLUDED.source_object_key,
                doc_version_hash = EXCLUDED.doc_version_hash,
                queue_status = 'queued',
                state = 'queued',
                max_attempts = EXCLUDED.max_attempts,
                available_at = NOW(),
                lease_owner = NULL,
                lease_expires_at = NULL,
                last_heartbeat_at = NULL,
                metadata = COALESCE(document_jobs.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
                updated_at = NOW()`,
            [
                String(input.jobId).trim(),
                Number(input.userId),
                input.requestHash ? String(input.requestHash).trim() : null,
                String(input.sourceObjectKey || '').trim(),
                String(input.docVersionHash || '').trim(),
                Math.max(1, Number(input.maxAttempts || 3)),
                input.metadata ? JSON.stringify(input.metadata) : null
            ]
        );
    }

    async claimNextQueuedDocumentJob(workerId: string, leaseSeconds: number): Promise<DocumentJobRow | null> {
        if (!this.pool) return null;
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const selected = await client.query(
                `SELECT job_id
                 FROM document_jobs
                 WHERE queue_status = 'queued'
                   AND (available_at IS NULL OR available_at <= NOW())
                 ORDER BY updated_at ASC
                 FOR UPDATE SKIP LOCKED
                 LIMIT 1`
            );
            const jobId = selected.rows?.[0]?.job_id;
            if (!jobId) {
                await client.query('COMMIT');
                return null;
            }
            const claimed = await client.query(
                `UPDATE document_jobs
                 SET queue_status = 'processing',
                     attempts = COALESCE(attempts, 0) + 1,
                     lease_owner = $2,
                     lease_expires_at = NOW() + (($3::text || ' seconds')::interval),
                     last_heartbeat_at = NOW(),
                     updated_at = NOW()
                 WHERE job_id = $1
                 RETURNING job_id, user_id, request_hash, queue_status, state, source_object_key, doc_version_hash, manifest_version, attempts, max_attempts, metadata`,
                [jobId, workerId, Math.max(30, leaseSeconds || 120)]
            );
            await client.query('COMMIT');
            return claimed.rows?.[0] || null;
        } catch (error: any) {
            await client.query('ROLLBACK');
            this.logger.warn(`Document queue claim failed: ${error?.message || error}`);
            return null;
        } finally {
            client.release();
        }
    }

    async updateDocumentJobState(jobId: string, state: DocumentJobState, metadata?: any): Promise<void> {
        if (!this.pool || !jobId) return;
        const isTerminal = state === 'completed' || state === 'failed';
        await this.query(
            `UPDATE document_jobs
             SET state = $2,
                 queue_status = CASE WHEN $2 = 'completed' THEN 'completed' WHEN $2 = 'failed' THEN 'failed' ELSE queue_status END,
                 lease_owner = CASE WHEN $2 IN ('completed', 'failed') THEN NULL ELSE lease_owner END,
                 lease_expires_at = CASE WHEN $2 IN ('completed', 'failed') THEN NULL ELSE lease_expires_at END,
                 last_heartbeat_at = CASE WHEN $2 IN ('completed', 'failed') THEN NULL ELSE last_heartbeat_at END,
                 metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE($3::jsonb, '{}'::jsonb),
                 updated_at = NOW()
             WHERE job_id = $1`,
            [jobId, state, metadata ? JSON.stringify(metadata) : null]
        );
        if (isTerminal) {
            await this.query(
                `UPDATE document_assets
                 SET updated_at = NOW()
                 WHERE job_id = $1`,
                [jobId]
            );
        }
    }

    async upsertDocumentAsset(input: {
        assetTaskId: string;
        jobId: string;
        userId: number;
        anchorId?: string | null;
        prompt?: string | null;
        status?: 'queued' | 'running' | 'completed' | 'failed';
        objectKey?: string | null;
        metadata?: any;
    }): Promise<void> {
        if (!this.pool || !input?.assetTaskId || !input?.jobId) return;
        await this.query(
            `INSERT INTO document_assets (
                asset_task_id, job_id, user_id, anchor_id, prompt, status, object_key, metadata, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW(), NOW()
            )
            ON CONFLICT (asset_task_id) DO UPDATE SET
                anchor_id = COALESCE(EXCLUDED.anchor_id, document_assets.anchor_id),
                prompt = COALESCE(EXCLUDED.prompt, document_assets.prompt),
                status = COALESCE(EXCLUDED.status, document_assets.status),
                object_key = COALESCE(EXCLUDED.object_key, document_assets.object_key),
                metadata = COALESCE(document_assets.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
                updated_at = NOW()`,
            [
                input.assetTaskId,
                input.jobId,
                Number(input.userId || 0),
                input.anchorId || null,
                input.prompt || null,
                input.status || 'queued',
                input.objectKey || null,
                input.metadata ? JSON.stringify(input.metadata) : null
            ]
        );
    }

    async upsertDocumentArtifact(input: {
        jobId: string;
        userId: number;
        artifactType: string;
        objectKey: string;
        byteSize?: number | null;
        checksumSha256?: string | null;
        metadata?: any;
    }): Promise<void> {
        if (!this.pool || !input?.jobId || !input?.artifactType || !input?.objectKey) return;
        await this.query(
            `INSERT INTO document_artifacts (
                job_id, user_id, artifact_type, object_key, byte_size, checksum_sha256, metadata, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), NOW()
            )
            ON CONFLICT (job_id, artifact_type, object_key) DO UPDATE SET
                byte_size = COALESCE(EXCLUDED.byte_size, document_artifacts.byte_size),
                checksum_sha256 = COALESCE(EXCLUDED.checksum_sha256, document_artifacts.checksum_sha256),
                metadata = COALESCE(document_artifacts.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
                updated_at = NOW()`,
            [
                input.jobId,
                Number(input.userId || 0),
                String(input.artifactType).trim().slice(0, 80),
                input.objectKey,
                Number.isFinite(Number(input.byteSize)) ? Number(input.byteSize) : null,
                input.checksumSha256 || null,
                input.metadata ? JSON.stringify(input.metadata) : null
            ]
        );
    }

    async upsertDocumentManifestValidation(input: {
        jobId: string;
        userId: number;
        manifest: any;
        valid: boolean;
        errors?: string[];
    }): Promise<void> {
        if (!this.pool || !input?.jobId || !Number.isFinite(Number(input?.userId))) return;
        const objectKey = `inline://documents/${input.jobId}/analysis/manifest.json`;
        await this.upsertDocumentArtifact({
            jobId: input.jobId,
            userId: Number(input.userId),
            artifactType: 'manifest_json',
            objectKey,
            metadata: {
                valid: Boolean(input.valid),
                errors: Array.isArray(input.errors) ? input.errors : [],
                manifest_version: input?.manifest?.metadata?.manifest_version || 1,
                manifest: input.manifest
            }
        });
    }

    async getDocumentJobStatusForUser(jobId: string, userId: number): Promise<{
        job_id: string;
        state: string;
        queue_status: string;
        attempts: number;
        max_attempts: number;
        updated_at: string;
        doc_version_hash: string;
    } | null> {
        if (!this.pool || !jobId || !Number.isFinite(Number(userId))) return null;
        const rows = await this.queryRows<any>(
            `SELECT job_id, state, queue_status, attempts, max_attempts, updated_at::text, doc_version_hash
             FROM document_jobs
             WHERE job_id = $1 AND user_id = $2
             LIMIT 1`,
            [jobId, Number(userId)]
        );
        return rows[0] || null;
    }

    async getDocumentArtifactKeyForUser(jobId: string, userId: number, artifactType: string): Promise<string | null> {
        if (!this.pool || !jobId || !artifactType || !Number.isFinite(Number(userId))) return null;
        const rows = await this.queryRows<{ object_key: string }>(
            `SELECT object_key
             FROM document_artifacts
             WHERE job_id = $1 AND user_id = $2 AND artifact_type = $3
             ORDER BY created_at DESC
             LIMIT 1`,
            [jobId, Number(userId), artifactType]
        );
        return rows[0]?.object_key || null;
    }

    async listDocumentArtifactsForUser(jobId: string, userId: number): Promise<DocumentArtifactObsRow[]> {
        if (!this.pool || !jobId || !Number.isFinite(Number(userId))) return [];
        return this.queryRows<DocumentArtifactObsRow>(
            `SELECT artifact_type, object_key, byte_size, checksum_sha256, metadata, created_at::text
             FROM document_artifacts
             WHERE job_id = $1 AND user_id = $2
             ORDER BY created_at DESC`,
            [jobId, Number(userId)]
        );
    }

    async claimNextQueuedTask(workerId: string, leaseSeconds: number): Promise<QueueTaskRow | null> {
        if (!this.pool) return null;
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const selected = await client.query(
                `SELECT task_id
                 FROM tasks
                 WHERE queue_status = 'queued'
                   AND (available_at IS NULL OR available_at <= NOW())
                 ORDER BY updated_at ASC
                 FOR UPDATE SKIP LOCKED
                 LIMIT 1`
            );
            const taskId = selected.rows?.[0]?.task_id;
            if (!taskId) {
                await client.query('COMMIT');
                return null;
            }
            const claimed = await client.query(
                `UPDATE tasks
                 SET queue_status = 'processing',
                     status = 'processing',
                     stage = 'Starting Generation...',
                     attempts = COALESCE(attempts, 0) + 1,
                     lease_owner = $2,
                     lease_expires_at = NOW() + (($3::text || ' seconds')::interval),
                     last_heartbeat_at = NOW(),
                     updated_at = NOW()
                 WHERE task_id = $1
                 RETURNING task_id, batch_id, queue_status, attempts, max_attempts, payload, metadata, details`,
                [taskId, workerId, Math.max(30, leaseSeconds || 120)]
            );
            await client.query('COMMIT');
            return claimed.rows?.[0] || null;
        } catch (error: any) {
            await client.query('ROLLBACK');
            this.logger.warn(`Queue claim failed: ${error?.message || error}`);
            return null;
        } finally {
            client.release();
        }
    }

    async heartbeatTask(taskId: string, workerId: string, leaseSeconds: number): Promise<void> {
        if (!this.pool || !taskId) return;
        await this.query(
            `UPDATE tasks
             SET last_heartbeat_at = NOW(),
                 lease_expires_at = NOW() + (($3::text || ' seconds')::interval),
                 updated_at = NOW()
             WHERE task_id = $1
               AND queue_status = 'processing'
               AND lease_owner = $2`,
            [taskId, workerId, Math.max(30, leaseSeconds || 120)]
        );
    }

    async completeDurableTask(taskId: string, resultUrl?: string | null, details?: any, metrics?: any): Promise<void> {
        if (!this.pool || !taskId) return;
        const safeResultPath = normalizeDbResultPath(resultUrl);
        await this.query(
            `UPDATE tasks
             SET queue_status = 'completed',
                 status = 'completed',
                 stage = 'Completed',
                 result_url = COALESCE($2, result_url),
                 details = COALESCE(details, '{}'::jsonb) || COALESCE($3::jsonb, '{}'::jsonb),
                 metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('metrics', COALESCE($4::jsonb, '{}'::jsonb)),
                 lease_owner = NULL,
                 lease_expires_at = NULL,
                 last_heartbeat_at = NULL,
                 updated_at = NOW()
             WHERE task_id = $1`,
            [taskId, safeResultPath, details ? JSON.stringify(details) : null, metrics ? JSON.stringify(metrics) : null]
        );
    }

    async failOrRequeueDurableTask(taskId: string, errorMessage: string, retryDelaySeconds = 30): Promise<'requeued' | 'failed' | 'none'> {
        if (!this.pool || !taskId) return 'none';
        const rows = await this.queryRows<{ attempts: number; max_attempts: number }>(
            `SELECT attempts, max_attempts FROM tasks WHERE task_id = $1 LIMIT 1`,
            [taskId]
        );
        const row = rows[0];
        if (!row) return 'none';
        const attempts = Number(row.attempts || 0);
        const maxAttempts = Math.max(1, Number(row.max_attempts || 3));
        const shouldRetry = attempts < maxAttempts;
        const sql = `UPDATE tasks
             SET queue_status = ${shouldRetry ? `'queued'` : `'failed'`},
                 status = ${shouldRetry ? `'pending'` : `'failed'`},
                 stage = ${shouldRetry ? `'Queued for Retry'` : `'Failed'`},
                 error_log = LEFT(COALESCE(error_log, '') || E'\n[' || NOW() || '] ' || $2, 20000),
                 available_at = ${shouldRetry ? `NOW() + (($3::text || ' seconds')::interval)` : `NULL`},
                 lease_owner = NULL,
                 lease_expires_at = NULL,
                 last_heartbeat_at = NULL,
                 updated_at = NOW()
             WHERE task_id = $1`;
        const params: any[] = [taskId, String(errorMessage || 'Unknown error').slice(0, 2000)];
        if (shouldRetry) {
            params.push(Math.max(5, retryDelaySeconds || 30));
        }
        await this.query(sql, params);
        return shouldRetry ? 'requeued' : 'failed';
    }

    async requeueOrphanedProcessingTasks(staleMinutes = 10): Promise<number> {
        if (!this.pool) return 0;
        const rows = await this.queryRows<{ task_id: string }>(
            `UPDATE tasks
             SET queue_status = 'queued',
                 status = 'pending',
                 stage = 'Queued (Recovered)',
                 lease_owner = NULL,
                 lease_expires_at = NULL,
                 last_heartbeat_at = NULL,
                 available_at = NOW(),
                 error_log = LEFT(COALESCE(error_log, '') || E'\n[' || NOW() || '] recovered stale processing lease', 20000),
                 updated_at = NOW()
             WHERE queue_status = 'processing'
               AND (lease_expires_at IS NULL OR lease_expires_at < NOW() - (($1::text || ' minutes')::interval))
             RETURNING task_id`,
            [Math.max(1, staleMinutes || 10)]
        );
        return rows.length;
    }

    async upsertWorkerHeartbeat(input: {
        workerId: string;
        pid?: number | null;
        host?: string | null;
        status?: 'ACTIVE' | 'SHUTDOWN' | 'TERMINATED';
        signature?: string | null;
        capabilities?: any;
        currentTaskId?: string | null;
        metadata?: any;
    }): Promise<void> {
        if (!this.pool || !input?.workerId) return;
        await this.query(
            `INSERT INTO worker_heartbeats (
                worker_id, pid, host, status, signature, capabilities, current_task_id, metadata, started_at, last_seen_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, NOW(), NOW(), NOW()
            )
            ON CONFLICT (worker_id) DO UPDATE SET
                pid = EXCLUDED.pid,
                host = EXCLUDED.host,
                status = EXCLUDED.status,
                signature = EXCLUDED.signature,
                capabilities = COALESCE(EXCLUDED.capabilities, worker_heartbeats.capabilities),
                current_task_id = EXCLUDED.current_task_id,
                metadata = COALESCE(worker_heartbeats.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
                last_seen_at = NOW(),
                updated_at = NOW()`,
            [
                input.workerId,
                input.pid || null,
                input.host || null,
                input.status || 'ACTIVE',
                input.signature || null,
                input.capabilities ? JSON.stringify(input.capabilities) : null,
                input.currentTaskId || null,
                input.metadata ? JSON.stringify(input.metadata) : null,
            ]
        );
    }

    async setWorkerCurrentTask(workerId: string, taskId: string | null): Promise<void> {
        if (!this.pool || !workerId) return;
        await this.query(
            `UPDATE worker_heartbeats
             SET current_task_id = $2,
                 last_seen_at = NOW(),
                 updated_at = NOW()
             WHERE worker_id = $1`,
            [workerId, taskId || null]
        );
    }

    async touchWorkerHeartbeat(workerId: string, currentTaskId?: string | null): Promise<void> {
        return this.setWorkerCurrentTask(workerId, currentTaskId || null);
    }

    async markWorkerStatus(workerId: string, status: 'ACTIVE' | 'SHUTDOWN' | 'TERMINATED', metadata?: any): Promise<void> {
        if (!this.pool || !workerId) return;
        await this.query(
            `UPDATE worker_heartbeats
             SET status = $2,
                 current_task_id = CASE WHEN $2 = 'ACTIVE' THEN current_task_id ELSE NULL END,
                 metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE($3::jsonb, '{}'::jsonb),
                 last_seen_at = NOW(),
                 updated_at = NOW()
             WHERE worker_id = $1`,
            [workerId, status, metadata ? JSON.stringify(metadata) : null]
        );
    }

    async markWorkerHeartbeatStatus(workerId: string, status: WorkerHeartbeatStatus, metadata?: any): Promise<void> {
        await this.markWorkerStatus(workerId, status, metadata);
    }

    async listActiveWorkerHeartbeats(host: string): Promise<WorkerHeartbeatRow[]> {
        if (!this.pool) return [];
        return this.queryRows<WorkerHeartbeatRow>(
            `SELECT worker_id, pid, host, signature, status, started_at, last_seen_at, current_task_id, metadata
             FROM worker_heartbeats
             WHERE status = 'ACTIVE'
               AND host = $1`,
            [String(host || '').trim().slice(0, 255) || 'unknown-host']
        );
    }

    async terminateWorkerAndRecoverTask(workerId: string, reason: string): Promise<string | null> {
        if (!this.pool || !workerId) return null;
        const rows = await this.queryRows<{ current_task_id: string | null }>(
            `SELECT current_task_id FROM worker_heartbeats WHERE worker_id = $1 LIMIT 1`,
            [workerId]
        );
        const taskId = rows[0]?.current_task_id || null;
        await this.query(
            `UPDATE worker_heartbeats
             SET status = 'TERMINATED',
                 current_task_id = NULL,
                 metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('gc_reason', $2::text, 'gc_at', NOW()::text),
                 updated_at = NOW()
             WHERE worker_id = $1`,
            [workerId, String(reason || 'orphan_worker_cleanup').slice(0, 300)]
        );
        if (taskId) {
            await this.query(
                `UPDATE tasks
                 SET queue_status = 'queued',
                     status = 'pending',
                     stage = 'Queued (Worker GC)',
                     lease_owner = NULL,
                     lease_expires_at = NULL,
                     last_heartbeat_at = NULL,
                     available_at = NOW(),
                     error_log = LEFT(COALESCE(error_log, '') || E'\n[' || NOW() || '] Worker GC: ' || $2, 20000),
                     updated_at = NOW()
                 WHERE task_id = $1
                   AND queue_status = 'processing'`,
                [taskId, String(reason || 'orphan_worker_cleanup').slice(0, 300)]
            );
        }
        return taskId;
    }

    async recoverTimedOutWorkers(timeoutMs = 30000): Promise<{ workers: string[]; tasks: string[] }> {
        if (!this.pool) return { workers: [], tasks: [] };
        const timeoutSec = Math.max(5, Math.floor(timeoutMs / 1000));
        const staleWorkers = await this.queryRows<{ worker_id: string; current_task_id: string | null }>(
            `SELECT worker_id, current_task_id
             FROM worker_heartbeats
             WHERE status = 'ACTIVE'
               AND last_seen_at < NOW() - (($1::text || ' seconds')::interval)`,
            [timeoutSec]
        );
        if (!staleWorkers.length) return { workers: [], tasks: [] };

        const workers = staleWorkers.map((w) => w.worker_id);
        const taskIds = staleWorkers.map((w) => w.current_task_id).filter(Boolean) as string[];

        await this.query(
            `UPDATE worker_heartbeats
             SET status = 'TERMINATED',
                 current_task_id = NULL,
                 updated_at = NOW()
             WHERE worker_id = ANY($1::text[])`,
            [workers]
        );

        if (taskIds.length) {
            await this.query(
                `UPDATE tasks
                 SET queue_status = 'queued',
                     status = 'pending',
                     stage = 'Queued (Worker Timeout)',
                     lease_owner = NULL,
                     lease_expires_at = NULL,
                     last_heartbeat_at = NULL,
                     available_at = NOW(),
                     error_log = LEFT(COALESCE(error_log, '') || E'\n[' || NOW() || '] Worker Timeout detected by supervisor', 20000),
                     updated_at = NOW()
                 WHERE task_id = ANY($1::text[])
                   AND queue_status = 'processing'`,
                [taskIds]
            );
        }
        return { workers, tasks: taskIds };
    }

    async getUserDailyBudget(userId: number): Promise<{
        dailyQuotaUsd: number | null;
        estimatedUsd: number;
        actualUsd: number;
        taskCount: number;
    }> {
        if (!this.pool || !Number.isFinite(userId) || userId <= 0) {
            return { dailyQuotaUsd: null, estimatedUsd: 0, actualUsd: 0, taskCount: 0 };
        }
        const rows = await this.queryRows<{ daily_quota: any; metadata: any }>(
            `SELECT u.daily_quota, t.metadata
             FROM users u
             LEFT JOIN tasks t
               ON t.user_id = u.id
              AND t.created_at >= date_trunc('day', NOW())
             WHERE u.id = $1`,
            [Number(userId)]
        );
        if (!rows.length) return { dailyQuotaUsd: null, estimatedUsd: 0, actualUsd: 0, taskCount: 0 };
        const dailyQuotaUsd = rows[0]?.daily_quota != null ? this.toUsd(rows[0].daily_quota) : null;
        let estimatedUsd = 0;
        let actualUsd = 0;
        let taskCount = 0;
        for (const row of rows) {
            if (!row?.metadata || typeof row.metadata !== 'object') continue;
            taskCount++;
            const cost = row.metadata?.cost || {};
            estimatedUsd += this.toUsd(cost?.estimated_usd ?? row.metadata?.metrics?.estimated_cost_usd);
            actualUsd += this.toUsd(cost?.actual_usd ?? row.metadata?.metrics?.actual_cost_usd);
        }
        return { dailyQuotaUsd, estimatedUsd, actualUsd, taskCount };
    }

    async recordTaskCost(taskId: string, cost: { estimated_usd?: number; actual_usd?: number; provider?: string; model?: string; }): Promise<void> {
        if (!this.pool || !taskId) return;
        const payload: any = {};
        if (Number.isFinite(cost?.estimated_usd)) payload.estimated_usd = Number(cost.estimated_usd).toFixed(6);
        if (Number.isFinite(cost?.actual_usd)) payload.actual_usd = Number(cost.actual_usd).toFixed(6);
        if (cost?.provider) payload.provider = String(cost.provider).slice(0, 120);
        if (cost?.model) payload.model = String(cost.model).slice(0, 180);
        payload.recorded_at = new Date().toISOString();
        await this.query(
            `UPDATE tasks
             SET metadata = COALESCE(metadata, '{}'::jsonb)
                 || jsonb_build_object(
                    'cost',
                    COALESCE(metadata->'cost', '{}'::jsonb) || $2::jsonb
                 ),
                 updated_at = NOW()
             WHERE task_id = $1`,
            [taskId, JSON.stringify(payload)]
        );
    }

    async reserveDailyAssetQuota(userId: number, assetType: DailyUsageAssetType, limit: number): Promise<{
        allowed: boolean;
        currentCount: number;
        usageDateUtc: string;
    }> {
        if (!this.pool || !Number.isFinite(userId) || userId <= 0) {
            return { allowed: true, currentCount: 0, usageDateUtc: new Date().toISOString().slice(0, 10) };
        }
        const effectiveLimit = Math.max(0, Number(limit || 0));
        const usageDateRows = await this.queryRows<{ usage_date: string }>(
            `SELECT (NOW() AT TIME ZONE 'UTC')::date::text AS usage_date`
        );
        const usageDateUtc = usageDateRows[0]?.usage_date || new Date().toISOString().slice(0, 10);
        if (effectiveLimit <= 0) return { allowed: true, currentCount: 0, usageDateUtc };

        const upserted = await this.queryRows<{ current_count: number; usage_date: string }>(
            `INSERT INTO daily_usage (user_id, asset_type, usage_date, current_count, updated_at)
             VALUES ($1, $2, (NOW() AT TIME ZONE 'UTC')::date, 1, NOW())
             ON CONFLICT (user_id, asset_type, usage_date) DO UPDATE
             SET current_count = daily_usage.current_count + 1,
                 updated_at = NOW()
             WHERE daily_usage.current_count < $3
             RETURNING current_count, usage_date::text`,
            [Number(userId), assetType, effectiveLimit]
        );
        if (upserted.length) {
            return {
                allowed: true,
                currentCount: Number(upserted[0].current_count || 0),
                usageDateUtc: upserted[0].usage_date || usageDateUtc,
            };
        }
        const current = await this.queryRows<{ current_count: number }>(
            `SELECT current_count
             FROM daily_usage
             WHERE user_id = $1
               AND asset_type = $2
               AND usage_date = (NOW() AT TIME ZONE 'UTC')::date
             LIMIT 1`,
            [Number(userId), assetType]
        );
        return {
            allowed: false,
            currentCount: Number(current[0]?.current_count || effectiveLimit),
            usageDateUtc,
        };
    }

    async failDurableTaskImmediately(taskId: string, errorMessage: string): Promise<void> {
        if (!this.pool || !taskId) return;
        await this.query(
            `UPDATE tasks
             SET queue_status = 'failed',
                 status = 'failed',
                 stage = 'Failed',
                 error_log = LEFT(COALESCE(error_log, '') || E'\n[' || NOW() || '] ' || $2, 20000),
                 lease_owner = NULL,
                 lease_expires_at = NULL,
                 last_heartbeat_at = NULL,
                 available_at = NULL,
                 updated_at = NOW()
             WHERE task_id = $1`,
            [taskId, String(errorMessage || 'Unknown error').slice(0, 2000)]
        );
    }

    async updateBatchRunProgress(batchId: string): Promise<void> {
        if (!this.pool || !batchId) return;
        const rows = await this.queryRows<{ total: number; completed: number; failed: number }>(
            `SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE queue_status = 'completed')::int AS completed,
                COUNT(*) FILTER (WHERE queue_status = 'failed')::int AS failed
             FROM tasks
             WHERE batch_id = $1`,
            [batchId]
        );
        const row = rows[0];
        if (!row) return;
        const total = Number(row.total || 0);
        const completed = Number(row.completed || 0);
        const failed = Number(row.failed || 0);
        const finished = completed + failed;
        const status = finished >= total && total > 0 ? 'completed' : 'running';
        await this.query(
            `UPDATE batch_runs
             SET total = $2,
                 completed = $3,
                 failed = $4,
                 status = $5,
                 ended_at = CASE WHEN $5 = 'completed' THEN COALESCE(ended_at, NOW()) ELSE NULL END,
                 updated_at = NOW()
             WHERE batch_id = $1`,
            [batchId, total, completed, failed, status]
        );
    }

    async getQueueHealthStats(): Promise<QueueHealthStats> {
        if (!this.pool) return { pending: 0, completed: 0, failed: 0 };
        const rows = await this.queryRows<{ pending: number; completed: number; failed: number }>(
            `SELECT
                COUNT(*) FILTER (WHERE queue_status IN ('queued', 'processing'))::int AS pending,
                COUNT(*) FILTER (WHERE queue_status = 'completed')::int AS completed,
                COUNT(*) FILTER (WHERE queue_status = 'failed')::int AS failed
             FROM tasks`
        );
        return rows[0] || { pending: 0, completed: 0, failed: 0 };
    }

    async getWorkerHealthStats(timeoutMs = 30000): Promise<any[]> {
        if (!this.pool) return [];
        const timeoutSec = Math.max(5, Math.floor(timeoutMs / 1000));
        const showDeadMinutes = Math.max(0, Number(process.env.WORKER_HEARTBEAT_SHOW_DEAD_MINUTES || 0));
        return this.queryRows<any>(
            `SELECT
                worker_id, pid, host, status, current_task_id, started_at, last_seen_at,
                CASE
                    WHEN status = 'ACTIVE' AND last_seen_at >= NOW() - (($1::text || ' seconds')::interval)
                    THEN true ELSE false
                END AS healthy
             FROM worker_heartbeats
             WHERE
                (status = 'ACTIVE' AND last_seen_at >= NOW() - (($1::text || ' seconds')::interval))
                OR ($2::int > 0 AND status <> 'ACTIVE' AND last_seen_at >= NOW() - (($2::text || ' minutes')::interval))
             ORDER BY started_at DESC`,
            [timeoutSec, showDeadMinutes]
        );
    }

    async purgeDeadWorkerHeartbeats(retentionMinutes = 60): Promise<number> {
        if (!this.pool) return 0;
        const mins = Math.max(1, Number(retentionMinutes || 60));
        const rows = await this.queryRows<{ worker_id: string }>(
            `DELETE FROM worker_heartbeats
             WHERE status IN ('TERMINATED', 'SHUTDOWN')
               AND last_seen_at < NOW() - (($1::text || ' minutes')::interval)
             RETURNING worker_id`,
            [mins]
        );
        return rows.length;
    }

    async getDatabaseHealthStats(): Promise<any> {
        if (!this.pool) return {};
        const [taskRows, batchRows, dbRows, connRows, telemetryRows] = await Promise.all([
            this.queryRows<{ total: number; today_completed: number; today_failed: number; avg_duration_seconds: number }>(
                `SELECT
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE status = 'completed' AND queued_at >= date_trunc('day', NOW()))::int AS today_completed,
                    COUNT(*) FILTER (WHERE status = 'failed' AND queued_at >= date_trunc('day', NOW()))::int AS today_failed,
                    COALESCE(AVG(EXTRACT(EPOCH FROM (ended_at - started_at))) FILTER (WHERE started_at IS NOT NULL AND ended_at IS NOT NULL), 0)::float AS avg_duration_seconds
                 FROM task_runs`
            ),
            this.queryRows<{ total: number; running: number }>(
                `SELECT
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE status = 'running')::int AS running
                 FROM batch_runs`
            ),
            this.queryRows<{ size_pretty: string; size_bytes: string }>(
                `SELECT pg_size_pretty(pg_database_size(current_database())) AS size_pretty,
                        pg_database_size(current_database())::text AS size_bytes`
            ),
            this.queryRows<{ total: number; active: number }>(
                `SELECT
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE state = 'active')::int AS active
                 FROM pg_stat_activity
                 WHERE datname = current_database()`
            ),
            this.queryRows<StrategyTelemetryRow>(
                `WITH strategy_runs AS (
                    SELECT
                        UPPER(COALESCE(NULLIF(t.payload->>'type', ''), NULLIF(tr.metadata->>'strategy', ''), 'UNKNOWN')) AS strategy,
                        COALESCE(NULLIF(t.queue_status, ''), NULLIF(tr.status, ''), 'unknown') AS status,
                        CASE
                            WHEN (tr.metadata->'metrics'->>'total_ms') ~ '^[0-9]+(\\.[0-9]+)?$'
                                THEN (tr.metadata->'metrics'->>'total_ms')::double precision
                            WHEN tr.started_at IS NOT NULL AND tr.ended_at IS NOT NULL
                                THEN EXTRACT(EPOCH FROM (tr.ended_at - tr.started_at)) * 1000
                            ELSE NULL
                        END AS latency_ms
                    FROM tasks t
                    LEFT JOIN task_runs tr ON tr.task_id = t.task_id
                    WHERE t.updated_at >= NOW() - INTERVAL '24 hours'
                )
                SELECT
                    strategy,
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE status IN ('completed'))::int AS completed,
                    COUNT(*) FILTER (WHERE status IN ('failed'))::int AS failed,
                    ROUND((COUNT(*) FILTER (WHERE status IN ('completed'))::numeric * 100.0) / NULLIF(COUNT(*), 0), 2)::float AS success_rate_pct,
                    ROUND(COALESCE(AVG(latency_ms)::numeric, 0), 2)::float AS avg_latency_ms
                FROM strategy_runs
                WHERE status IN ('completed', 'failed')
                GROUP BY strategy
                ORDER BY total DESC, strategy ASC
                LIMIT 10`
            ),
        ]);
        const telemetry = telemetryRows?.length
            ? telemetryRows
            : await this.queryRows<StrategyTelemetryRow>(
                `WITH strategy_runs AS (
                    SELECT
                        UPPER(COALESCE(NULLIF(t.payload->>'type', ''), NULLIF(tr.metadata->>'strategy', ''), 'UNKNOWN')) AS strategy,
                        COALESCE(NULLIF(t.queue_status, ''), NULLIF(tr.status, ''), 'unknown') AS status,
                        CASE
                            WHEN (tr.metadata->'metrics'->>'total_ms') ~ '^[0-9]+(\\.[0-9]+)?$'
                                THEN (tr.metadata->'metrics'->>'total_ms')::double precision
                            WHEN tr.started_at IS NOT NULL AND tr.ended_at IS NOT NULL
                                THEN EXTRACT(EPOCH FROM (tr.ended_at - tr.started_at)) * 1000
                            ELSE NULL
                        END AS latency_ms
                    FROM tasks t
                    LEFT JOIN task_runs tr ON tr.task_id = t.task_id
                )
                SELECT
                    strategy,
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE status IN ('completed'))::int AS completed,
                    COUNT(*) FILTER (WHERE status IN ('failed'))::int AS failed,
                    ROUND((COUNT(*) FILTER (WHERE status IN ('completed'))::numeric * 100.0) / NULLIF(COUNT(*), 0), 2)::float AS success_rate_pct,
                    ROUND(COALESCE(AVG(latency_ms)::numeric, 0), 2)::float AS avg_latency_ms
                FROM strategy_runs
                WHERE status IN ('completed', 'failed')
                GROUP BY strategy
                ORDER BY total DESC, strategy ASC
                LIMIT 10`
            );

        return {
            tasks: taskRows[0] || { total: 0, today_completed: 0, today_failed: 0, avg_duration_seconds: 0 },
            batches: batchRows[0] || { total: 0, running: 0 },
            storage: dbRows[0] || { size_pretty: 'n/a', size_bytes: '0' },
            connections: connRows[0] || { total: 0, active: 0 },
            telemetry: { strategies_24h: telemetry || [] },
        };
    }

    async getRecentTaskDeltas(sinceIso: string | null, limit = 200): Promise<TaskDeltaRow[]> {
        if (!this.pool) return [];
        const cap = Math.max(1, Math.min(500, Number(limit || 200)));
        if (sinceIso) {
            return this.queryRows<TaskDeltaRow>(
                `SELECT
                    tr.task_id,
                    tr.batch_id,
                    tr.status,
                    tr.stage,
                    tr.url,
                    tr.details,
                    COALESCE(tr.metadata, '{}'::jsonb)
                      || jsonb_build_object(
                        'metrics',
                        COALESCE(tr.metadata->'metrics', t.metadata->'metrics', '{}'::jsonb)
                      ) AS metadata,
                    tr.updated_at::text AS updated_at
                 FROM task_runs tr
                 LEFT JOIN tasks t ON t.task_id = tr.task_id
                 WHERE tr.updated_at > $1::timestamptz
                 ORDER BY tr.updated_at ASC
                 LIMIT $2`,
                [sinceIso, cap]
            );
        }
        return this.queryRows<TaskDeltaRow>(
            `SELECT
                tr.task_id,
                tr.batch_id,
                tr.status,
                tr.stage,
                tr.url,
                tr.details,
                COALESCE(tr.metadata, '{}'::jsonb)
                  || jsonb_build_object(
                    'metrics',
                    COALESCE(tr.metadata->'metrics', t.metadata->'metrics', '{}'::jsonb)
                  ) AS metadata,
                tr.updated_at::text AS updated_at
             FROM task_runs tr
             LEFT JOIN tasks t ON t.task_id = tr.task_id
             ORDER BY tr.updated_at DESC
             LIMIT $1`,
            [cap]
        );
    }

    async getRecentSystemLogs(afterId: number | null, limit = 300): Promise<SystemLogRow[]> {
        if (!this.pool) return [];
        const cap = Math.max(1, Math.min(1000, Number(limit || 300)));
        if (Number.isFinite(afterId as number) && Number(afterId) > 0) {
            return this.queryRows<SystemLogRow>(
                `SELECT id, created_at::text, level, message, context, task_id, batch_id, event_id, source_role, source_pid, source_worker_id, metadata
                 FROM system_logs
                 WHERE id > $1
                 ORDER BY id ASC
                 LIMIT $2`,
                [Number(afterId), cap]
            );
        }
        return this.queryRows<SystemLogRow>(
            `SELECT id, created_at::text, level, message, context, task_id, batch_id, event_id, source_role, source_pid, source_worker_id, metadata
             FROM system_logs
             ORDER BY id DESC
             LIMIT $1`,
            [cap]
        );
    }

    async getDocumentQueueHealthStats(): Promise<DocumentQueueHealthStats> {
        if (!this.pool) return { queued: 0, processing: 0, completed: 0, failed: 0 };
        const rows = await this.queryRows<DocumentQueueHealthStats>(
            `SELECT
                COUNT(*) FILTER (WHERE queue_status = 'queued')::int AS queued,
                COUNT(*) FILTER (WHERE queue_status = 'processing')::int AS processing,
                COUNT(*) FILTER (WHERE queue_status = 'completed')::int AS completed,
                COUNT(*) FILTER (WHERE queue_status = 'failed')::int AS failed
             FROM document_jobs`
        );
        return rows[0] || { queued: 0, processing: 0, completed: 0, failed: 0 };
    }

    async getRecentDocumentJobs(limit = 50): Promise<DocumentJobObsRow[]> {
        if (!this.pool) return [];
        const cap = Math.max(1, Math.min(200, Number(limit || 50)));
        return this.queryRows<DocumentJobObsRow>(
            `SELECT job_id, user_id, state, queue_status, attempts, max_attempts, updated_at::text
             FROM document_jobs
             ORDER BY updated_at DESC
             LIMIT $1`,
            [cap]
        );
    }

    async getDocumentArtifactTypeCounts(limit = 20): Promise<Array<{ artifact_type: string; count: number }>> {
        if (!this.pool) return [];
        const cap = Math.max(1, Math.min(100, Number(limit || 20)));
        return this.queryRows<Array<{ artifact_type: string; count: number }>[number]>(
            `SELECT artifact_type, COUNT(*)::int AS count
             FROM document_artifacts
             GROUP BY artifact_type
             ORDER BY count DESC
             LIMIT $1`,
            [cap]
        );
    }

    async getDocumentObservabilityMetrics(): Promise<DocumentObservabilityMetrics> {
        if (!this.pool) {
            return {
                completed_total: 0,
                failed_total: 0,
                retries_total: 0,
                avg_duration_ms: 0,
                p95_duration_ms: 0,
                flowchart_fallback_total: 0,
            };
        }
        const rows = await this.queryRows<DocumentObservabilityMetrics>(
            `SELECT
                COUNT(*) FILTER (WHERE queue_status = 'completed')::int AS completed_total,
                COUNT(*) FILTER (WHERE queue_status = 'failed')::int AS failed_total,
                COALESCE(SUM(GREATEST(attempts - 1, 0)), 0)::int AS retries_total,
                COALESCE(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) * 1000) FILTER (WHERE queue_status = 'completed'), 0)::int AS avg_duration_ms,
                COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (updated_at - created_at)) * 1000) FILTER (WHERE queue_status = 'completed'), 0)::int AS p95_duration_ms,
                (
                    SELECT COUNT(*)::int
                    FROM document_artifacts da
                    WHERE da.artifact_type = 'manifest_json'
                      AND da.metadata::text LIKE '%mermaid_validation_failed_after_single_retry%'
                ) AS flowchart_fallback_total
             FROM document_jobs`
        );
        return rows[0] || {
            completed_total: 0,
            failed_total: 0,
            retries_total: 0,
            avg_duration_ms: 0,
            p95_duration_ms: 0,
            flowchart_fallback_total: 0,
        };
    }

    async querySystemLogs(filters: { taskId?: string; userId?: number; limit?: number }): Promise<SystemLogRow[]> {
        if (!this.pool) return [];
        const where: string[] = [];
        const params: any[] = [];
        if (filters.taskId) {
            params.push(filters.taskId);
            where.push(`task_id = $${params.length}`);
        }
        if (Number.isFinite(Number(filters.userId)) && Number(filters.userId) > 0) {
            params.push(String(Number(filters.userId)));
            where.push(`metadata->>'user_id' = $${params.length}`);
        }
        const cap = Math.max(1, Math.min(1000, Number(filters.limit || 200)));
        params.push(cap);
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        return this.queryRows<SystemLogRow>(
            `SELECT id, created_at::text, level, message, context, task_id, batch_id, event_id, source_role, source_pid, source_worker_id, metadata
             FROM system_logs
             ${clause}
             ORDER BY id DESC
             LIMIT $${params.length}`,
            params
        );
    }

    async upsertTaskProgress(data: {
        taskId: string;
        status: string;
        stage?: string;
        batchId?: string;
        url?: string;
        details?: any;
        metadata?: any;
        metrics?: any;
    }): Promise<void> {
        if (!this.pool) return;
        const taskId = String(data.taskId || '').trim();
        if (!taskId) return;
        const batchId = String(data.batchId || data?.metadata?.batch_id || '').trim() || null;
        const now = new Date().toISOString();
        const details = data.details ?? null;
        const metadata = data.metadata ?? null;
        const metrics = data.metrics ?? null;
        const title = String(details?.title || metadata?.title || metadata?.lesson_title || '').trim() || null;
        await this.query(
            `INSERT INTO task_runs (
                task_id, batch_id, status, stage, title, lesson_id, lesson_title, course_id, queued_at, started_at, ended_at, url, details, metadata, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz, $11::timestamptz, $12, $13::jsonb, $14::jsonb, NOW()
            )
            ON CONFLICT (task_id) DO UPDATE SET
                batch_id = COALESCE(EXCLUDED.batch_id, task_runs.batch_id),
                status = EXCLUDED.status,
                stage = EXCLUDED.stage,
                title = COALESCE(EXCLUDED.title, task_runs.title),
                lesson_id = COALESCE(EXCLUDED.lesson_id, task_runs.lesson_id),
                lesson_title = COALESCE(EXCLUDED.lesson_title, task_runs.lesson_title),
                course_id = COALESCE(EXCLUDED.course_id, task_runs.course_id),
                queued_at = COALESCE(EXCLUDED.queued_at, task_runs.queued_at),
                started_at = COALESCE(task_runs.started_at, EXCLUDED.started_at),
                ended_at = COALESCE(EXCLUDED.ended_at, task_runs.ended_at),
                url = COALESCE(EXCLUDED.url, task_runs.url),
                details = COALESCE(EXCLUDED.details, task_runs.details),
                metadata = COALESCE(task_runs.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
                updated_at = NOW()`,
            [
                taskId,
                batchId,
                data.status || null,
                data.stage || null,
                title,
                metadata?.lesson_id || null,
                metadata?.lesson_title || null,
                metadata?.course_id || null,
                metadata?.queued_at || null,
                data.status === 'processing' ? now : null,
                (data.status === 'completed' || data.status === 'failed') ? now : null,
                data.url || null,
                details ? JSON.stringify(details) : null,
                (metadata || metrics)
                    ? JSON.stringify({
                        ...(metadata || {}),
                        ...(metrics ? { metrics } : {}),
                    })
                    : null,
            ]
        );
        await this.query(
            `INSERT INTO tasks (task_id, batch_id, user_id, queue_status, status, stage, title, details, metadata, updated_at)
             VALUES ($1, $2, $3,
                CASE
                    WHEN $4 = 'completed' THEN 'completed'
                    WHEN $4 = 'failed' THEN 'failed'
                    WHEN $4 = 'processing' THEN 'processing'
                    ELSE 'queued'
                END,
                $4, $5, $6, $7::jsonb, $8::jsonb, NOW())
             ON CONFLICT (task_id) DO UPDATE SET
                batch_id = COALESCE(EXCLUDED.batch_id, tasks.batch_id),
                user_id = COALESCE(EXCLUDED.user_id, tasks.user_id),
                queue_status = CASE
                    WHEN EXCLUDED.status = 'completed' THEN 'completed'
                    WHEN EXCLUDED.status = 'failed' THEN 'failed'
                    WHEN EXCLUDED.status = 'processing' THEN 'processing'
                    ELSE 'queued'
                END,
                status = EXCLUDED.status,
                stage = EXCLUDED.stage,
                title = COALESCE(EXCLUDED.title, tasks.title),
                details = COALESCE(EXCLUDED.details, tasks.details),
                metadata = COALESCE(tasks.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
                updated_at = NOW()`,
            [
                taskId,
                batchId,
                metadata?.user_id ? Number(metadata.user_id) : null,
                data.status || null,
                data.stage || null,
                title,
                details ? JSON.stringify(details) : null,
                (metadata || metrics)
                    ? JSON.stringify({
                        ...(metadata || {}),
                        ...(metrics ? { metrics } : {}),
                    })
                    : null,
            ]
        );
    }

    async insertSystemLog(entry: {
        level: string;
        message: string;
        context?: string;
        taskId?: string;
        batchId?: string;
        timestamp?: string;
        eventId?: string;
        source?: { role?: string; pid?: number; workerId?: string };
        metadata?: any;
    }): Promise<void> {
        if (!this.pool) return;
        await this.query(
            `INSERT INTO system_logs (
                created_at, level, message, context, task_id, batch_id, event_id, source_role, source_pid, source_worker_id, metadata
            ) VALUES ($1::timestamptz, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
            [
                entry.timestamp || new Date().toISOString(),
                entry.level || 'info',
                entry.message || '',
                entry.context || null,
                entry.taskId || null,
                entry.batchId || null,
                entry.eventId || null,
                entry.source?.role || null,
                Number.isFinite(Number(entry.source?.pid)) ? Number(entry.source?.pid) : null,
                entry.source?.workerId || null,
                entry.metadata ? JSON.stringify(entry.metadata) : null,
            ]
        );
    }

    async upsertBatchFinalized(data: {
        batchId: string;
        total: number;
        completed: number;
        failed: number;
        durationSeconds: number;
        startedAt: string;
        endedAt: string;
        courseTitle?: string;
    }): Promise<void> {
        if (!this.pool) return;
        await this.query(
            `INSERT INTO batch_runs (
                batch_id, total, completed, failed, duration_seconds, status, started_at, ended_at, course_title
            ) VALUES ($1, $2, $3, $4, $5, 'completed', $6::timestamptz, $7::timestamptz, $8)
            ON CONFLICT (batch_id) DO UPDATE SET
                total = EXCLUDED.total,
                completed = EXCLUDED.completed,
                failed = EXCLUDED.failed,
                duration_seconds = EXCLUDED.duration_seconds,
                status = 'completed',
                started_at = EXCLUDED.started_at,
                ended_at = EXCLUDED.ended_at,
                course_title = COALESCE(EXCLUDED.course_title, batch_runs.course_title),
                updated_at = NOW()`,
            [
                data.batchId,
                data.total || 0,
                data.completed || 0,
                data.failed || 0,
                data.durationSeconds || 0,
                data.startedAt,
                data.endedAt,
                data.courseTitle || null,
            ]
        );
    }

    private async ensureSchema(): Promise<void> {
        await this.query(`
            CREATE TABLE IF NOT EXISTS users (
                id BIGSERIAL PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'viewer',
                daily_quota NUMERIC(12,6) DEFAULT 25,
                api_key_hash TEXT UNIQUE NOT NULL,
                active BOOLEAN NOT NULL DEFAULT true,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS batch_runs (
                batch_id TEXT PRIMARY KEY,
                course_title TEXT,
                total INTEGER DEFAULT 0,
                completed INTEGER DEFAULT 0,
                failed INTEGER DEFAULT 0,
                duration_seconds DOUBLE PRECISION DEFAULT 0,
                status TEXT DEFAULT 'running',
                started_at TIMESTAMPTZ,
                ended_at TIMESTAMPTZ,
                metadata JSONB,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS task_runs (
                task_id TEXT PRIMARY KEY,
                batch_id TEXT,
                status TEXT,
                stage TEXT,
                title TEXT,
                lesson_id TEXT,
                lesson_title TEXT,
                course_id TEXT,
                queued_at TIMESTAMPTZ,
                started_at TIMESTAMPTZ,
                ended_at TIMESTAMPTZ,
                url TEXT,
                details JSONB,
                metadata JSONB,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS tasks (
                task_id TEXT PRIMARY KEY,
                batch_id TEXT,
                user_id BIGINT,
                queue_status TEXT DEFAULT 'queued',
                status TEXT,
                stage TEXT,
                title TEXT,
                payload JSONB,
                result_url TEXT,
                error_log TEXT,
                attempts INTEGER DEFAULT 0,
                max_attempts INTEGER DEFAULT 3,
                lease_owner TEXT,
                lease_expires_at TIMESTAMPTZ,
                last_heartbeat_at TIMESTAMPTZ,
                available_at TIMESTAMPTZ DEFAULT NOW(),
                details JSONB,
                metadata JSONB,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS worker_heartbeats (
                worker_id TEXT PRIMARY KEY,
                pid INTEGER,
                host TEXT,
                started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                signature TEXT,
                capabilities JSONB,
                current_task_id TEXT,
                metadata JSONB,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS system_logs (
                id BIGSERIAL PRIMARY KEY,
                created_at TIMESTAMPTZ NOT NULL,
                level TEXT,
                message TEXT,
                context TEXT,
                task_id TEXT,
                batch_id TEXT,
                event_id TEXT,
                source_role TEXT,
                source_pid INTEGER,
                source_worker_id TEXT,
                metadata JSONB
            );
            CREATE TABLE IF NOT EXISTS daily_usage (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                asset_type TEXT NOT NULL,
                usage_date DATE NOT NULL,
                current_count INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT chk_daily_usage_asset_type
                    CHECK (asset_type IN ('SOURCED_IMAGE', 'GENERATED_IMAGE', 'CHART', 'INFOGRAPHIC')),
                CONSTRAINT uq_daily_usage_user_asset_date
                    UNIQUE (user_id, asset_type, usage_date)
            );
            CREATE TABLE IF NOT EXISTS document_jobs (
                job_id TEXT PRIMARY KEY,
                user_id BIGINT NOT NULL,
                request_hash TEXT,
                queue_status TEXT NOT NULL DEFAULT 'queued',
                state TEXT NOT NULL DEFAULT 'queued',
                source_object_key TEXT NOT NULL,
                doc_version_hash TEXT NOT NULL,
                manifest_version INTEGER NOT NULL DEFAULT 1,
                attempts INTEGER NOT NULL DEFAULT 0,
                max_attempts INTEGER NOT NULL DEFAULT 3,
                lease_owner TEXT,
                lease_expires_at TIMESTAMPTZ,
                last_heartbeat_at TIMESTAMPTZ,
                available_at TIMESTAMPTZ DEFAULT NOW(),
                error_log TEXT,
                metadata JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS document_assets (
                asset_task_id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                user_id BIGINT NOT NULL,
                anchor_id TEXT,
                prompt TEXT,
                status TEXT NOT NULL DEFAULT 'queued',
                object_key TEXT,
                error_log TEXT,
                attempts INTEGER NOT NULL DEFAULT 0,
                max_attempts INTEGER NOT NULL DEFAULT 3,
                metadata JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT fk_document_assets_job FOREIGN KEY (job_id) REFERENCES document_jobs(job_id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS document_artifacts (
                id BIGSERIAL PRIMARY KEY,
                job_id TEXT NOT NULL,
                user_id BIGINT NOT NULL,
                artifact_type TEXT NOT NULL,
                object_key TEXT NOT NULL,
                byte_size BIGINT,
                checksum_sha256 TEXT,
                metadata JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT fk_document_artifacts_job FOREIGN KEY (job_id) REFERENCES document_jobs(job_id) ON DELETE CASCADE,
                CONSTRAINT uq_document_artifacts_key UNIQUE (job_id, artifact_type, object_key)
            );
            CREATE INDEX IF NOT EXISTS idx_task_runs_batch_id ON task_runs(batch_id);
            CREATE INDEX IF NOT EXISTS idx_tasks_batch_id ON tasks(batch_id);
            CREATE INDEX IF NOT EXISTS idx_tasks_queue_pull ON tasks(queue_status, available_at, updated_at);
            CREATE INDEX IF NOT EXISTS idx_tasks_lease ON tasks(queue_status, lease_expires_at);
            CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_status_seen ON worker_heartbeats(status, last_seen_at);
            CREATE UNIQUE INDEX IF NOT EXISTS ux_worker_heartbeats_current_task_id
                ON worker_heartbeats(current_task_id) WHERE current_task_id IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_system_logs_batch_task ON system_logs(batch_id, task_id);
            CREATE INDEX IF NOT EXISTS idx_daily_usage_user_date ON daily_usage(user_id, usage_date);
            CREATE UNIQUE INDEX IF NOT EXISTS ux_document_jobs_user_request_hash
                ON document_jobs(user_id, request_hash) WHERE request_hash IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_document_jobs_queue_pull ON document_jobs(queue_status, available_at, updated_at);
            CREATE INDEX IF NOT EXISTS idx_document_jobs_user_created ON document_jobs(user_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_document_assets_job_status ON document_assets(job_id, status, updated_at);
            CREATE INDEX IF NOT EXISTS idx_document_artifacts_job_created ON document_artifacts(job_id, created_at DESC);
        `);
        await this.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_quota NUMERIC(12,6) DEFAULT 25;
            ALTER TABLE tasks ADD COLUMN IF NOT EXISTS user_id BIGINT;
            ALTER TABLE tasks ADD COLUMN IF NOT EXISTS queue_status TEXT DEFAULT 'queued';
            ALTER TABLE tasks ADD COLUMN IF NOT EXISTS payload JSONB;
            ALTER TABLE tasks ADD COLUMN IF NOT EXISTS result_url TEXT;
            ALTER TABLE tasks ADD COLUMN IF NOT EXISTS error_log TEXT;
            ALTER TABLE tasks ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0;
            ALTER TABLE tasks ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 3;
            ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lease_owner TEXT;
            ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
            ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;
            ALTER TABLE tasks ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ DEFAULT NOW();
            ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
            ALTER TABLE worker_heartbeats ADD COLUMN IF NOT EXISTS signature TEXT;
            ALTER TABLE worker_heartbeats ADD COLUMN IF NOT EXISTS metadata JSONB;
            ALTER TABLE system_logs ADD COLUMN IF NOT EXISTS event_id TEXT;
            ALTER TABLE system_logs ADD COLUMN IF NOT EXISTS source_role TEXT;
            ALTER TABLE system_logs ADD COLUMN IF NOT EXISTS source_pid INTEGER;
            ALTER TABLE system_logs ADD COLUMN IF NOT EXISTS source_worker_id TEXT;
            ALTER TABLE system_logs ADD COLUMN IF NOT EXISTS metadata JSONB;
            ALTER TABLE document_jobs ADD COLUMN IF NOT EXISTS request_hash TEXT;
            ALTER TABLE document_jobs ADD COLUMN IF NOT EXISTS queue_status TEXT DEFAULT 'queued';
            ALTER TABLE document_jobs ADD COLUMN IF NOT EXISTS state TEXT DEFAULT 'queued';
            ALTER TABLE document_jobs ADD COLUMN IF NOT EXISTS source_object_key TEXT;
            ALTER TABLE document_jobs ADD COLUMN IF NOT EXISTS doc_version_hash TEXT;
            ALTER TABLE document_jobs ADD COLUMN IF NOT EXISTS manifest_version INTEGER DEFAULT 1;
            ALTER TABLE document_jobs ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0;
            ALTER TABLE document_jobs ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 3;
            ALTER TABLE document_jobs ADD COLUMN IF NOT EXISTS lease_owner TEXT;
            ALTER TABLE document_jobs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
            ALTER TABLE document_jobs ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;
            ALTER TABLE document_jobs ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ DEFAULT NOW();
            ALTER TABLE document_jobs ADD COLUMN IF NOT EXISTS error_log TEXT;
            ALTER TABLE document_jobs ADD COLUMN IF NOT EXISTS metadata JSONB;
            ALTER TABLE document_assets ADD COLUMN IF NOT EXISTS metadata JSONB;
            ALTER TABLE document_artifacts ADD COLUMN IF NOT EXISTS metadata JSONB;
        `);
        await this.query(`CREATE INDEX IF NOT EXISTS idx_system_logs_event_id ON system_logs(event_id);`);
        await this.query(`CREATE INDEX IF NOT EXISTS idx_system_logs_metadata_user_id ON system_logs ((metadata->>'user_id'));`);
    }

    private toUsd(value: any): number {
        const amount = Number(value);
        return Number.isFinite(amount) && amount > 0 ? amount : 0;
    }

    private async query(sql: string, params: any[] = []): Promise<void> {
        if (!this.pool) return;
        try {
            await this.pool.query(sql, params);
        } catch (error: any) {
            this.logger.warn(`Postgres write failed: ${error?.message || error}`);
        }
    }

    private async queryRows<T>(sql: string, params: any[] = []): Promise<T[]> {
        if (!this.pool) return [];
        try {
            const result = await this.pool.query(sql, params);
            return (result?.rows || []) as T[];
        } catch (error: any) {
            this.logger.warn(`Postgres read failed: ${error?.message || error}`);
            return [];
        }
    }

    private hashKey(apiKey: string): string {
        const key = String(apiKey || '').trim();
        if (!key) return '';
        return createHash('sha256').update(key).digest('hex');
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    async validateApiKey(apiKey: string): Promise<AuthUser | null> {
        if (!this.pool) return null;
        const hash = this.hashKey(apiKey);
        if (!hash) return null;
        const rows = await this.queryRows<AuthUser>(
            `SELECT id, email, name, role, daily_quota
             FROM users
             WHERE api_key_hash = $1 AND active = true
             LIMIT 1`,
            [hash]
        );
        return rows[0] || null;
    }

    private async ensureInitialAdmin(): Promise<void> {
        if (!this.pool) return;
        const initialAdminKey = String(this.configService.get<string>('INITIAL_ADMIN_KEY') || '').trim();
        if (!initialAdminKey) {
            this.logger.warn('INITIAL_ADMIN_KEY is not set; API key auth seed was skipped.');
            return;
        }

        const email = String(this.configService.get<string>('INITIAL_ADMIN_EMAIL') || 'admin@local').trim().toLowerCase();
        const name = String(this.configService.get<string>('INITIAL_ADMIN_NAME') || 'Initial Admin').trim();
        const keyHash = this.hashKey(initialAdminKey);
        await this.query(
            `INSERT INTO users (email, name, role, api_key_hash, active, updated_at)
             VALUES ($1, $2, 'admin', $3, true, NOW())
             ON CONFLICT (email) DO UPDATE
             SET name = EXCLUDED.name,
                 role = 'admin',
                 api_key_hash = EXCLUDED.api_key_hash,
                 active = true,
                 updated_at = NOW()`,
            [email, name, keyHash]
        );
        this.logger.log(`Initial admin ensured for ${email}`);
    }
}
