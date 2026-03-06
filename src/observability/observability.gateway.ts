import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    SubscribeMessage
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { PostgresStorageService } from '../storage/postgres-storage.service';
import { isAllowedOrigin, parseAllowedOrigins } from '../security/origin-allowlist';
import { buildDocumentEvent } from '../documents/observability/document-event.schema';

type ObservabilitySource = {
    role: 'app' | 'worker' | 'unknown';
    pid: number;
    workerId?: string;
};

@WebSocketGateway({
    transports: ['websocket'],
})
export class ObservabilityGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(ObservabilityGateway.name);
    private readonly allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
    private readonly liveStatsMinIntervalMs = Math.max(500, Number(process.env.OBS_LIVE_STATS_MIN_EMIT_MS || 1000));
    private readonly liveStatsPollMs = Math.max(500, Number(process.env.OBS_LIVE_STATS_POLL_MS || 1500));
    private readonly workerTimeoutMs = Math.max(
        60000,
        Number(process.env.WORKER_TIMEOUT_MS || process.env.MANIFEST_TASK_TIMEOUT_MS || 120000),
    );
    private lastLiveStatsAt = 0;
    private liveStatsTimer: NodeJS.Timeout | null = null;
    private lastTaskDeltaAt: string | null = null;
    private lastSystemLogId: number | null = null;
    private eventCounter = 0;
    private readonly source: ObservabilitySource = this.resolveSource();

    constructor(private readonly storage: PostgresStorageService) { }

    afterInit() {
        if (this.liveStatsTimer) return;
        this.liveStatsTimer = setInterval(() => {
            // Periodic snapshot enables cross-process observability:
            // workers persist to Postgres; app process fan-outs to connected sockets.
            void this.emitLiveStatsSnapshot();
        }, this.liveStatsPollMs);
    }

    onModuleDestroy() {
        if (this.liveStatsTimer) clearInterval(this.liveStatsTimer);
        this.liveStatsTimer = null;
    }

    async handleConnection(client: Socket) {
        const origin = String(client.handshake?.headers?.origin || '').trim() || undefined;
        if (!isAllowedOrigin(origin, this.allowedOrigins)) {
            this.logger.warn(`Rejected socket from disallowed origin: ${origin}`);
            client.emit('auth_error', { message: 'Origin not allowed' });
            client.disconnect(true);
            return;
        }
        if (this.storage.isEnabled()) {
            const authKey = client.handshake?.auth?.apiKey;
            const headerKey = client.handshake?.headers?.['x-api-key'];
            const queryKey = client.handshake?.query?.apiKey;
            const apiKey = String(authKey || headerKey || queryKey || '').trim();
            if (!apiKey) {
                client.emit('auth_error', { message: 'Missing API key' });
                client.disconnect(true);
                return;
            }
            const user = await this.storage.validateApiKey(apiKey);
            if (!user) {
                client.emit('auth_error', { message: 'Invalid API key' });
                client.disconnect(true);
                return;
            }
            (client.data as any).authUser = user;
        }
        this.logger.log(`Client connected: ${client.id}`);
        client.emit('connection_ack', { message: 'Connected to Visualization Observability' });
        void this.emitLiveStatsSnapshot(client, true);
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`Client disconnected: ${client.id}`);
    }

    @SubscribeMessage('ping')
    handlePing(client: Socket, payload: any): string {
        return 'pong';
    }

    /**
     * Emit a progress update for a specific task
     */
    emitProgress(data: {
        taskId: string;
        status: 'pending' | 'processing' | 'completed' | 'failed';
        batchId?: string;
        stage?: string;
        progress?: number;
        details?: any;
        url?: string;
        metrics?: any;
        metadata?: {
            course_id?: string;
            lesson_id?: string;
            lesson_title?: string;
            lesson_index?: number;
            batch_id?: string;
            queued_at?: string;
        };
        eventId?: string;
        source?: ObservabilitySource;
    }) {
        const eventId = String(data.eventId || this.nextEventId()).trim();
        const source = data.source || this.source;
        const payload = {
            ...data,
            eventId,
            source,
            metadata: {
                ...(data.metadata || {}),
                event_id: eventId,
                source,
            },
            details: {
                ...(data.details || {}),
                event_id: eventId,
                source,
            },
        };
        if (this.server) this.server.emit('task_progress', payload);
        void this.storage.upsertTaskProgress(payload);
        void this.emitLiveStatsSnapshot();

        if (payload.status === 'failed') {
            const fs = require('fs');
            const path = require('path');
            const logFile = path.join(process.cwd(), 'debug_errors.log');
            const entry = `[${new Date().toISOString()}] [FAILED] [${source.role}#${source.pid}] [event=${eventId}] [Task: ${payload.taskId}] ${JSON.stringify(payload.details || {})}\n`;
            fs.appendFile(logFile, entry, (err) => {
                if (err) console.error('Failed to write to debug log:', err);
            });
        }
    }

    /**
     * Emit a generic log message to the dashboard
     */
    emitLog(
        level: 'info' | 'warn' | 'error' | 'success',
        message: string,
        context?: string,
        taskId?: string,
        batchId?: string,
        options?: { eventId?: string; source?: ObservabilitySource; metadata?: Record<string, any> },
    ) {
        const timestamp = new Date().toISOString();
        const eventId = String(options?.eventId || this.nextEventId()).trim();
        const source = options?.source || this.source;
        const metadata = this.normalizeLogMetadata(options?.metadata);
        const structured = {
            timestamp,
            level,
            context: context || null,
            message: message || '',
            event_id: eventId,
            task_id: taskId || null,
            batch_id: batchId || null,
            doc_job_id: this.toStringOrNull(metadata?.doc_job_id),
            asset_task_id: this.toStringOrNull(metadata?.asset_task_id),
            stage: this.toStringOrNull(metadata?.stage),
            event_type: this.toStringOrNull(metadata?.event_type),
            severity: this.toStringOrNull(metadata?.severity),
            duration_ms: this.toNumberOrNull(metadata?.duration_ms),
            error_code: this.toStringOrNull(metadata?.error_code),
            error_message: this.toStringOrNull(metadata?.error_message),
            deployment_id: this.toStringOrNull(metadata?.deployment_id),
            service_role: this.toStringOrNull(metadata?.service_role),
            worker_id: this.toStringOrNull(metadata?.worker_id),
            timestamp_iso: this.toStringOrNull(metadata?.timestamp_iso),
            user_id: metadata?.user_id ?? null,
            latency_ms: metadata?.latency_ms ?? null,
            provider_status: metadata?.provider_status ?? null,
            source_role: source?.role || null,
            source_pid: source?.pid ?? null,
            source_worker_id: source?.workerId || null,
            metadata,
        };
        this.emitStructuredConsoleLog(structured);
        if (this.server) {
            this.server.emit('system_log', {
                level,
                message,
                context,
                taskId,
                batchId,
                timestamp,
                eventId,
                source,
                metadata: structured.metadata,
            });
        }
        void this.storage.insertSystemLog({
            level,
            message,
            context,
            taskId,
            batchId,
            timestamp,
            eventId,
            source,
            metadata: structured.metadata
        });

        if (level === 'error' || level === 'warn') {
            const fs = require('fs');
            const path = require('path');
            const logFile = path.join(process.cwd(), 'debug_errors.log');
            const entry = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${context || 'SYSTEM'}] [${source.role}#${source.pid}] [event=${eventId}] ${batchId ? `[${batchId}] ` : ''}${taskId ? `[${taskId}] ` : ''}${message}\n`;
            fs.appendFile(logFile, entry, (err) => {
                if (err) console.error('Failed to write to debug log:', err);
            });
        }
    }

    private normalizeLogMetadata(metadata?: Record<string, any> | null): Record<string, any> {
        const base = metadata && typeof metadata === 'object' ? { ...metadata } : {};
        return {
            ...base,
            doc_job_id: this.toStringOrNull(base.doc_job_id),
            asset_task_id: this.toStringOrNull(base.asset_task_id),
            stage: this.toStringOrNull(base.stage),
            event_type: this.toStringOrNull(base.event_type),
            severity: this.toStringOrNull(base.severity),
            duration_ms: this.toNumberOrNull(base.duration_ms),
            error_code: this.toStringOrNull(base.error_code),
            error_message: this.toStringOrNull(base.error_message),
            deployment_id: this.toStringOrNull(base.deployment_id),
            service_role: this.toStringOrNull(base.service_role),
            worker_id: this.toStringOrNull(base.worker_id),
            timestamp_iso: this.toStringOrNull(base.timestamp_iso),
            user_id: this.toNumberOrNull(base.user_id),
            latency_ms: this.toNumberOrNull(base.latency_ms),
            provider_status: this.toStringOrNull(base.provider_status),
        };
    }

    private emitStructuredConsoleLog(payload: Record<string, any>) {
        try {
            process.stdout.write(`${JSON.stringify(payload)}\n`);
        } catch {
            // no-op
        }
    }

    private toNumberOrNull(value: any): number | null {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    private toStringOrNull(value: any): string | null {
        const text = String(value ?? '').trim();
        return text ? text : null;
    }

    /**
     * Emit a batch summary update
     */
    emitBatchProgress(data: { total: number; completed: number; current: string; batchId?: string }) {
        if (this.server) this.server.emit('batch_progress', data);
        void this.emitLiveStatsSnapshot();
    }

    /**
     * Emit the initial list of tasks when a batch starts
     * This allows the frontend to populate the UI immediately
     */
    emitBatchInitialized(tasks: Record<string, any>) {
        this.logger.log(`Emitting batch_initialized with ${Object.keys(tasks).length} tasks`);
        if (this.server) this.server.emit('batch_initialized', tasks);
        void this.storage.upsertBatchInitialized(tasks);
        void this.emitLiveStatsSnapshot(undefined, true);
    }

    emitBatchFinalized(data: {
        batchId: string;
        total: number;
        completed: number;
        failed: number;
        durationSeconds: number;
        startedAt: string;
        endedAt: string;
        courseTitle?: string;
    }) {
        if (this.server) this.server.emit('batch_finalized', data);
        void this.storage.upsertBatchFinalized(data);
        void this.emitLiveStatsSnapshot(undefined, true);
    }

    emitDocumentEvent(data: {
        level: 'debug' | 'info' | 'warn' | 'error' | 'success';
        message: string;
        context?: string;
        jobId: string;
        assetTaskId?: string | null;
        stage: 'queued' | 'analyzing' | 'planning' | 'generating_assets' | 'inserting' | 'packaging' | 'completed' | 'failed';
        eventType:
            | 'stage_started'
            | 'stage_completed'
            | 'stage_failed'
            | 'retry_scheduled'
            | 'artifact_written'
            | 'quality_scored';
        durationMs?: number;
        errorCode?: string;
        errorMessage?: string;
        userId?: number | null;
        batchId?: string;
        eventId?: string;
    }) {
        const eventId = String(data.eventId || this.nextEventId()).trim();
        const severity =
            data.level === 'success'
                ? 'info'
                : data.level;
        const event = buildDocumentEvent({
            eventId,
            jobId: data.jobId,
            assetTaskId: data.assetTaskId || null,
            userId: Number.isFinite(Number(data.userId)) ? Number(data.userId) : null,
            stage: data.stage,
            eventType: data.eventType,
            severity,
            durationMs: data.durationMs,
            errorCode: data.errorCode || null,
            errorMessage: data.errorMessage || null,
            deploymentId: process.env.RAILWAY_DEPLOYMENT_ID || process.env.DEPLOYMENT_ID || null,
            serviceRole: this.source?.role || process.env.SERVICE_ROLE || null,
            workerId: this.source?.workerId || process.env.WORKER_ID || null,
            pid: this.source?.pid || process.pid,
            timestampIso: new Date().toISOString(),
        });
        this.emitLog(
            severity,
            data.message,
            data.context || 'DocumentPipeline',
            undefined,
            data.batchId,
            {
                eventId: event.event_id,
                metadata: {
                    doc_job_id: event.job_id,
                    asset_task_id: event.asset_task_id,
                    stage: event.stage,
                    event_type: event.event_type,
                    severity: event.severity,
                    duration_ms: event.duration_ms,
                    error_code: event.error_code,
                    error_message: event.error_message,
                    user_id: event.user_id,
                    deployment_id: event.deployment_id,
                    service_role: event.service_role,
                    worker_id: event.worker_id,
                    source_pid: event.pid,
                    timestamp_iso: event.timestamp_iso,
                },
            }
        );
    }

    emitLiveStats(data: {
        queue: { pending: number; completed: number; failed: number };
        workers: any[];
        database: any;
        documents?: {
            queue: { queued: number; processing: number; completed: number; failed: number };
            recent_jobs: any[];
            artifact_type_counts: Array<{ artifact_type: string; count: number }>;
            metrics: {
                completed_total: number;
                failed_total: number;
                retries_total: number;
                avg_duration_ms: number;
                p95_duration_ms: number;
                flowchart_fallback_total: number;
            };
        };
        recent?: { task_deltas?: any[]; logs?: any[] };
        timestamp: string;
    }) {
        if (this.server) this.server.emit('live_stats', data);
    }

    private async emitLiveStatsSnapshot(target?: Socket, force = false): Promise<void> {
        if (!this.storage.isEnabled()) return;
        if (!target && !this.hasConnectedClients()) return;
        const now = Date.now();
        if (!force && now - this.lastLiveStatsAt < this.liveStatsMinIntervalMs) return;
        this.lastLiveStatsAt = now;

        const [queue, workers, database, taskDeltas, logDeltas, docQueue, docJobs, docArtifacts, docMetrics] = await Promise.all([
            this.storage.getQueueHealthStats(),
            this.storage.getWorkerHealthStats(this.workerTimeoutMs),
            this.storage.getDatabaseHealthStats(),
            target
                ? this.storage.getRecentTaskDeltas(null, 200)
                : this.storage.getRecentTaskDeltas(this.lastTaskDeltaAt, 200),
            target
                ? this.storage.getRecentSystemLogs(null, 300)
                : this.storage.getRecentSystemLogs(this.lastSystemLogId, 300),
            this.storage.getDocumentQueueHealthStats(),
            this.storage.getRecentDocumentJobs(50),
            this.storage.getDocumentArtifactTypeCounts(20),
            this.storage.getDocumentObservabilityMetrics(),
        ]);

        const orderedTaskDeltas = target ? [...taskDeltas].reverse() : taskDeltas;
        const orderedLogDeltas = target ? [...logDeltas].reverse() : logDeltas;
        this.advanceDeltaCursors(orderedTaskDeltas, orderedLogDeltas);

        const payload = {
            queue,
            workers,
            database,
            documents: {
                queue: docQueue,
                recent_jobs: docJobs,
                artifact_type_counts: docArtifacts,
                metrics: docMetrics,
            },
            recent: { task_deltas: orderedTaskDeltas, logs: orderedLogDeltas },
            timestamp: new Date().toISOString()
        };
        if (target) target.emit('live_stats', payload);
        else this.emitLiveStats(payload);
    }

    private hasConnectedClients(): boolean {
        try {
            return !!this.server?.engine && this.server.engine.clientsCount > 0;
        } catch {
            return false;
        }
    }

    private advanceDeltaCursors(taskDeltas: Array<{ updated_at?: string }>, logDeltas: Array<{ id?: number }>) {
        for (const row of taskDeltas || []) {
            const ts = String(row?.updated_at || '').trim();
            if (!ts) continue;
            if (!this.lastTaskDeltaAt || ts > this.lastTaskDeltaAt) this.lastTaskDeltaAt = ts;
        }
        for (const row of logDeltas || []) {
            const id = Number(row?.id || 0);
            if (!Number.isFinite(id) || id <= 0) continue;
            if (!this.lastSystemLogId || id > this.lastSystemLogId) this.lastSystemLogId = id;
        }
    }

    private nextEventId(): string {
        this.eventCounter = (this.eventCounter + 1) % 1000000;
        return `evt-${Date.now().toString(36)}-${process.pid}-${this.eventCounter.toString(36)}`;
    }

    private resolveSource(): ObservabilitySource {
        const roleRaw = String(process.env.PROCESS_ROLE || '').trim().toLowerCase();
        const role: ObservabilitySource['role'] =
            roleRaw === 'app' || roleRaw === 'worker'
                ? roleRaw
                : (process.env.WORKER_ID ? 'worker' : 'app');
        const workerId = String(process.env.WORKER_ID || '').trim() || undefined;
        return { role, pid: process.pid, workerId };
    }

    @SubscribeMessage('open_folder')
    handleOpenFolder(client: Socket, relativePath: string) {
        if (!relativePath || typeof relativePath !== 'string') return;
        const fs = require('fs');
        const path = require('path');
        const cp = require('child_process');

        const baseDir = path.resolve(process.cwd(), 'public', 'generated-images');
        const normalizedInput = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
        const fullPath = path.resolve(baseDir, normalizedInput);

        // Prevent malformed/escaped paths from shelling outside generated-images.
        if (!fullPath.startsWith(baseDir)) {
            this.logger.warn(`Rejected open_folder path outside base dir: ${relativePath}`);
            client.emit('open_folder_result', {
                ok: false,
                openedLocally: false,
                path: relativePath,
                message: 'Path outside generated-images is not allowed.',
            });
            return;
        }

        if (!fs.existsSync(fullPath)) {
            this.logger.warn(`Rejected open_folder missing path: ${fullPath}`);
            client.emit('open_folder_result', {
                ok: false,
                openedLocally: false,
                path: relativePath,
                message: 'Requested output path does not exist.',
            });
            return;
        }

        const stat = fs.statSync(fullPath);
        const folderPath = stat.isDirectory() ? fullPath : path.dirname(fullPath);
        const safeRelative = path.relative(baseDir, folderPath).replace(/\\/g, '/').replace(/^\/+/, '');
        const browseUrl = `/generated-images/${safeRelative}/index.html`;
        this.logger.log(`Request to open folder: ${folderPath}`);

        // Local Windows: open in Explorer. Cloud/Linux: provide URL fallback for browser access.
        if (process.platform === 'win32') {
            // Use explorer with argv instead of cmd shell parsing to avoid quote/escape issues.
            cp.execFile('explorer.exe', [folderPath], (err: any) => {
                if (err) {
                    this.logger.error(`Failed to open folder: ${err.message}`);
                    client.emit('open_folder_result', {
                        ok: false,
                        openedLocally: false,
                        path: safeRelative,
                        url: browseUrl,
                        message: 'Could not open local folder. Opened browser fallback URL.',
                    });
                    return;
                }
                client.emit('open_folder_result', {
                    ok: true,
                    openedLocally: true,
                    path: safeRelative,
                    url: browseUrl,
                    message: 'Opened local folder in Explorer.',
                });
            });
            return;
        }

        client.emit('open_folder_result', {
            ok: true,
            openedLocally: false,
            path: safeRelative,
            url: browseUrl,
            message: 'Local folder open is unavailable in this environment. Use browser output URL.',
        });
    }
}
