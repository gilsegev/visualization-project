import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
    cors: {
        origin: '*', // Allow all origins for simplicity in this local tool
    },
})
export class ObservabilityGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(ObservabilityGateway.name);

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
        };
    }) {
        this.server.emit('task_progress', data);

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
    emitLog(level: 'info' | 'warn' | 'error' | 'success', message: string, context?: string, taskId?: string) {
        this.server.emit('system_log', {
            level,
            message,
            context,
            taskId,
            timestamp: new Date().toISOString()
        });

        if (level === 'error') {
            const fs = require('fs');
            const path = require('path');
            const logFile = path.join(process.cwd(), 'debug_errors.log');
            const entry = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${context || 'SYSTEM'}] ${taskId ? `[${taskId}] ` : ''}${message}\n`;
            fs.appendFile(logFile, entry, (err) => {
                if (err) console.error('Failed to write to debug log:', err);
            });
        }
    }

    /**
     * Emit a batch summary update
     */
    emitBatchProgress(data: { total: number; completed: number; current: string }) {
        this.server.emit('batch_progress', data);
    }

    /**
     * Emit the initial list of tasks when a batch starts
     * This allows the frontend to populate the UI immediately
     */
    emitBatchInitialized(tasks: Record<string, any>) {
        this.logger.log(`Emitting batch_initialized with ${Object.keys(tasks).length} tasks`);
        this.server.emit('batch_initialized', tasks);
    }

    @SubscribeMessage('open_folder')
    handleOpenFolder(client: Socket, relativePath: string) {
        if (!relativePath) return;
        const fs = require('fs');
        const path = require('path');
        const cp = require('child_process');

        // Construct absolute path (assuming relative to public/generated-images)
        const fullPath = path.join(process.cwd(), 'public', 'generated-images', relativePath);

        this.logger.log(`Request to open folder: ${fullPath}`);

        // Windows-specific open command
        cp.exec(`start "" "${fullPath}"`, (err) => {
            if (err) this.logger.error(`Failed to open folder: ${err.message}`);
        });
    }
}
