import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

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
        const shouldSetStarted = data.status === 'processing';
        const shouldSetEnded = data.status === 'completed' || data.status === 'failed';
        await this.query(
            `INSERT INTO task_runs (
                task_id, batch_id, status, stage, title, lesson_id, lesson_title, course_id, queued_at, started_at, ended_at, url, details, metadata, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, ${shouldSetStarted ? '$10::timestamptz' : 'NULL'}, ${shouldSetEnded ? '$11::timestamptz' : 'NULL'}, $12, $13::jsonb, $14::jsonb, NOW()
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
                shouldSetStarted ? now : null,
                shouldSetEnded ? now : null,
                data.url || null,
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
            CREATE INDEX IF NOT EXISTS idx_system_logs_batch_task ON system_logs(batch_id, task_id);
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
}

