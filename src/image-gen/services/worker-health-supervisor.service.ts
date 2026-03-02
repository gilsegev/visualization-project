import { execFile } from 'child_process';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { hostname } from 'os';
import { promisify } from 'util';
import { ObservabilityGateway } from '../../observability/observability.gateway';
import { PostgresStorageService } from '../../storage/postgres-storage.service';
const treeKill = require('tree-kill');
const execFileAsync = promisify(execFile);

@Injectable()
export class WorkerHealthSupervisorService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(WorkerHealthSupervisorService.name);
    private readonly enabled =
        String(process.env.DURABLE_QUEUE_ENABLED || 'true').toLowerCase() === 'true'
        && String(process.env.WORKER_SUPERVISOR_ENABLED || 'true').toLowerCase() === 'true';
    private readonly gcEnabled = String(process.env.WORKER_GC_ENABLED || 'true').toLowerCase() === 'true';
    private readonly workerTimeoutMs = Math.max(5000, Number(process.env.WORKER_TIMEOUT_MS || 30000));
    private readonly pollMs = Math.max(2000, Number(process.env.WORKER_SUPERVISOR_POLL_MS || process.env.WORKER_HEARTBEAT_MS || 10000));
    private readonly gcIntervalMs = Math.max(5000, Number(process.env.WORKER_GC_INTERVAL_MS || 30000));
    private readonly expectedSignature = String(process.env.WORKER_SIGNATURE || 'viz-worker').trim();
    private readonly host = hostname();
    private timer: NodeJS.Timeout | null = null;
    private gcTimer: NodeJS.Timeout | null = null;

    constructor(
        private readonly storage: PostgresStorageService,
        private readonly observability: ObservabilityGateway,
    ) {}

    onModuleInit(): void {
        if (!this.enabled || !this.storage.isEnabled()) return;
        this.timer = setInterval(() => void this.tick(), this.pollMs);
        if (this.gcEnabled) {
            this.gcTimer = setInterval(() => void this.gcSweep('periodic'), this.gcIntervalMs);
            void this.gcSweep('startup');
        }
        this.logger.log(`Worker supervisor enabled (poll=${this.pollMs}ms timeout=${this.workerTimeoutMs}ms)`);
    }

    onModuleDestroy(): void {
        if (this.timer) clearInterval(this.timer);
        if (this.gcTimer) clearInterval(this.gcTimer);
    }

    private async tick(): Promise<void> {
        const recovered = await this.storage.recoverTimedOutWorkers(this.workerTimeoutMs);
        if (!recovered.workers.length) return;
        const msg = `Supervisor recovered workers=${recovered.workers.length} tasks=${recovered.tasks.length}`;
        this.logger.warn(msg);
        this.observability.emitLog('warn', msg, 'Supervisor');
    }

    private async gcSweep(mode: 'startup' | 'periodic'): Promise<void> {
        const workers = await this.storage.listActiveWorkerHeartbeats(this.host);
        let cleaned = 0;
        for (const worker of workers) {
            const pid = Number(worker?.pid || 0);
            if (!Number.isFinite(pid) || pid <= 0) {
                await this.cleanupWorker(worker.worker_id, null, `${mode}:missing_pid`);
                cleaned++;
                continue;
            }
            if (!this.isPidAlive(pid)) {
                await this.cleanupWorker(worker.worker_id, null, `${mode}:pid_not_found`);
                cleaned++;
                continue;
            }
            const heartbeatSigOk = String(worker.signature || '') === this.expectedSignature;
            const pidSigOk = await this.pidLooksLikeWorker(pid);
            if (!heartbeatSigOk || !pidSigOk) {
                await this.cleanupWorker(worker.worker_id, pid, `${mode}:signature_mismatch`);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            const msg = `Worker GC ${mode}: cleaned=${cleaned}`;
            this.logger.warn(msg);
            this.observability.emitLog('warn', msg, 'Supervisor');
        }
    }

    private isPidAlive(pid: number): boolean {
        try {
            process.kill(pid, 0);
            return true;
        } catch {
            return false;
        }
    }

    private async pidLooksLikeWorker(pid: number): Promise<boolean> {
        try {
            if (process.platform === 'win32') {
                const cmd = `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`;
                const out = await execFileAsync('powershell', ['-NoProfile', '-Command', cmd], { timeout: 2500 });
                return String(out?.stdout || '').toLowerCase().includes('dist/src/worker/main');
            }
            const out = await execFileAsync('ps', ['-p', String(pid), '-o', 'command='], { timeout: 2500 });
            return String(out?.stdout || '').toLowerCase().includes('dist/src/worker/main');
        } catch {
            return false;
        }
    }

    private async cleanupWorker(workerId: string, pid: number | null, reason: string): Promise<void> {
        if (pid && this.isPidAlive(pid)) {
            await new Promise<void>((resolve) => treeKill(pid, 'SIGKILL', () => resolve()));
        }
        const taskId = await this.storage.terminateWorkerAndRecoverTask(workerId, reason);
        this.observability.emitLog(
            'warn',
            `Worker GC terminated worker=${workerId}${pid ? ` pid=${pid}` : ''} task=${taskId || 'n/a'} reason=${reason}`,
            'Supervisor',
        );
    }
}

