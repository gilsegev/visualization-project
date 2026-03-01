import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { createHash } from 'crypto';

export type AuthUser = {
    id: number;
    email: string;
    name: string;
    role: string;
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
            [taskId, resultUrl || null, details ? JSON.stringify(details) : null, metrics ? JSON.stringify(metrics) : null]
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
        await this.query(
            `UPDATE tasks
             SET queue_status = ${shouldRetry ? `'queued'` : `'failed'`},
                 status = ${shouldRetry ? `'pending'` : `'failed'`},
                 stage = ${shouldRetry ? `'Queued for Retry'` : `'Failed'`},
                 error_log = LEFT(COALESCE(error_log, '') || E'\n[' || NOW() || '] ' || $2, 20000),
                 available_at = ${shouldRetry ? `NOW() + (($3::text || ' seconds')::interval)` : `NULL`},
                 lease_owner = NULL,
                 lease_expires_at = NULL,
                 last_heartbeat_at = NULL,
                 updated_at = NOW()
             WHERE task_id = $1`,
            [taskId, String(errorMessage || 'Unknown error').slice(0, 2000), Math.max(5, retryDelaySeconds || 30)]
        );
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

    async upsertTaskProgress(data: {
        taskId: string;
        status: string;
        stage?: string;
        batchId?: string;
        url?: string;
        details?: any;
        metadata?: any;
    }): Promise<void> {
        if (!this.pool) return;
        const taskId = String(data.taskId || '').trim();
        if (!taskId) return;
        const batchId = String(data.batchId || data?.metadata?.batch_id || '').trim() || null;
        const now = new Date().toISOString();
        const details = data.details ?? null;
        const metadata = data.metadata ?? null;
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
                metadata = COALESCE(EXCLUDED.metadata, task_runs.metadata),
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
                metadata ? JSON.stringify(metadata) : null,
            ]
        );
        await this.query(
            `INSERT INTO tasks (task_id, batch_id, status, stage, title, details, metadata, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, NOW())
             ON CONFLICT (task_id) DO UPDATE SET
                batch_id = COALESCE(EXCLUDED.batch_id, tasks.batch_id),
                status = EXCLUDED.status,
                stage = EXCLUDED.stage,
                title = COALESCE(EXCLUDED.title, tasks.title),
                details = COALESCE(EXCLUDED.details, tasks.details),
                metadata = COALESCE(EXCLUDED.metadata, tasks.metadata),
                updated_at = NOW()`,
            [
                taskId,
                batchId,
                data.status || null,
                data.stage || null,
                title,
                details ? JSON.stringify(details) : null,
                metadata ? JSON.stringify(metadata) : null,
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
    }): Promise<void> {
        if (!this.pool) return;
        await this.query(
            `INSERT INTO system_logs (created_at, level, message, context, task_id, batch_id)
             VALUES ($1::timestamptz, $2, $3, $4, $5, $6)`,
            [
                entry.timestamp || new Date().toISOString(),
                entry.level || 'info',
                entry.message || '',
                entry.context || null,
                entry.taskId || null,
                entry.batchId || null,
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
            CREATE TABLE IF NOT EXISTS system_logs (
                id BIGSERIAL PRIMARY KEY,
                created_at TIMESTAMPTZ NOT NULL,
                level TEXT,
                message TEXT,
                context TEXT,
                task_id TEXT,
                batch_id TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_task_runs_batch_id ON task_runs(batch_id);
            CREATE INDEX IF NOT EXISTS idx_tasks_batch_id ON tasks(batch_id);
            CREATE INDEX IF NOT EXISTS idx_tasks_queue_pull ON tasks(queue_status, available_at, updated_at);
            CREATE INDEX IF NOT EXISTS idx_tasks_lease ON tasks(queue_status, lease_expires_at);
            CREATE INDEX IF NOT EXISTS idx_system_logs_batch_task ON system_logs(batch_id, task_id);
        `);
        await this.query(`
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
        `);
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
            `SELECT id, email, name, role
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
