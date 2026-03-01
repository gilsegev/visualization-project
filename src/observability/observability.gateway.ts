import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { PostgresStorageService } from '../storage/postgres-storage.service';

@WebSocketGateway({
    cors: {
        origin: '*', // Allow all origins for simplicity in this local tool
    },
})
export class ObservabilityGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(ObservabilityGateway.name);

    constructor(private readonly storage: PostgresStorageService) { }

    handleConnection(client: Socket) {
        this.logger.log(`Client connected: ${client.id}`);
        client.emit('connection_ack', { message: 'Connected to Visualization Observability' });
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
    }) {
        if (this.server) this.server.emit('task_progress', data);
        void this.storage.upsertTaskProgress(data);

        if (data.status === 'failed') {
            const fs = require('fs');
            const path = require('path');
            const logFile = path.join(process.cwd(), 'debug_errors.log');
            const entry = `[${new Date().toISOString()}] [FAILED] [Task: ${data.taskId}] ${JSON.stringify(data.details || {})}\n`;
            fs.appendFile(logFile, entry, (err) => {
                if (err) console.error('Failed to write to debug log:', err);
            });
        }
    }

    /**
     * Emit a generic log message to the dashboard
     */
    emitLog(level: 'info' | 'warn' | 'error' | 'success', message: string, context?: string, taskId?: string, batchId?: string) {
        const timestamp = new Date().toISOString();
        if (this.server) {
            this.server.emit('system_log', {
                level,
                message,
                context,
                taskId,
                batchId,
                timestamp
            });
        }
        void this.storage.insertSystemLog({ level, message, context, taskId, batchId, timestamp });

        if (level === 'error' || level === 'warn') {
            const fs = require('fs');
            const path = require('path');
            const logFile = path.join(process.cwd(), 'debug_errors.log');
            const entry = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${context || 'SYSTEM'}] ${batchId ? `[${batchId}] ` : ''}${taskId ? `[${taskId}] ` : ''}${message}\n`;
            fs.appendFile(logFile, entry, (err) => {
                if (err) console.error('Failed to write to debug log:', err);
            });
        }
    }

    /**
     * Emit a batch summary update
     */
    emitBatchProgress(data: { total: number; completed: number; current: string; batchId?: string }) {
        if (this.server) this.server.emit('batch_progress', data);
    }

    /**
     * Emit the initial list of tasks when a batch starts
     * This allows the frontend to populate the UI immediately
     */
    emitBatchInitialized(tasks: Record<string, any>) {
        this.logger.log(`Emitting batch_initialized with ${Object.keys(tasks).length} tasks`);
        if (this.server) this.server.emit('batch_initialized', tasks);
        void this.storage.upsertBatchInitialized(tasks);
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
    }

    @SubscribeMessage('open_folder')
    handleOpenFolder(client: Socket, relativePath: string) {
        if (!relativePath || typeof relativePath !== 'string') return;
        const fs = require('fs');
        const path = require('path');
        const cp = require('child_process');

        const baseDir = path.resolve(process.cwd(), 'public', 'generated-images');
        const fullPath = path.resolve(baseDir, relativePath);

        // Prevent malformed/escaped paths from shelling outside generated-images.
        if (!fullPath.startsWith(baseDir)) {
            this.logger.warn(`Rejected open_folder path outside base dir: ${relativePath}`);
            return;
        }

        if (!fs.existsSync(fullPath)) {
            this.logger.warn(`Rejected open_folder missing path: ${fullPath}`);
            return;
        }

        this.logger.log(`Request to open folder: ${fullPath}`);

        // Use explorer with argv instead of cmd shell parsing to avoid quote/escape issues.
        cp.execFile('explorer.exe', [fullPath], (err: any) => {
            if (err) this.logger.error(`Failed to open folder: ${err.message}`);
        });
    }
}
