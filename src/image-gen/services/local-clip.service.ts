import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ObservabilityGateway } from '../../observability/observability.gateway';

@Injectable()
export class LocalClipService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(LocalClipService.name);
    private classifierPromise: Promise<any> | null = null;
    private readonly scorerUrl: string;
    private readonly useLocalFallback: boolean;
    private readonly timeoutMs: number;
    private readonly heartbeatMs: number;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private heartbeatPrevHealthy: boolean | null = null;

    constructor(
        private readonly configService: ConfigService,
        private readonly observability: ObservabilityGateway,
    ) {
        this.scorerUrl = String(
            this.configService.get<string>('IQC_URL')
            || this.configService.get<string>('CLIP_SCORER_URL')
            || 'http://127.0.0.1:4310'
        ).replace(/\/+$/, '');
        this.useLocalFallback = String(this.configService.get<string>('CLIP_SCORER_USE_LOCAL_FALLBACK') || 'false').toLowerCase() === 'true';
        const configuredTimeout = Number(this.configService.get<string>('QUALITY_CONTROL_TIMEOUT_MS') || 12000);
        this.timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 12000;
        const configuredHeartbeat = Number(this.configService.get<string>('IQC_HEARTBEAT_MS') || 10000);
        this.heartbeatMs = Number.isFinite(configuredHeartbeat) && configuredHeartbeat > 0 ? Math.max(2000, configuredHeartbeat) : 10000;
    }

    async onModuleInit(): Promise<void> {
        const enabled = String(this.configService.get<string>('IQC_HEARTBEAT_ENABLED') || 'true').toLowerCase() === 'true';
        if (!enabled) return;
        this.heartbeatTimer = setInterval(() => {
            void this.checkIqcHealth();
        }, this.heartbeatMs);
        await this.checkIqcHealth();
    }

    onModuleDestroy(): void {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
    }

    private async getClassifier(): Promise<any> {
        if (!this.classifierPromise) {
            this.classifierPromise = (async () => {
                const transformers = await import('@xenova/transformers');
                return transformers.pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32');
            })();
        }
        return this.classifierPromise;
    }

    async scoreImageAgainstBrief(imageUrl: string, brief: string): Promise<number> {
        try {
            const res = await this.postWithRetry(
                `${this.scorerUrl}/score/clip`,
                { imageUrl, brief },
                { timeout: this.timeoutMs, headers: { 'Content-Type': 'application/json' } },
            );
            const score = Number(res?.data?.score || 0);
            if (!Number.isFinite(score)) throw new Error('image-quality-control returned non-numeric clip score');
            this.logger.log(`CLIP score=${score.toFixed(4)} via IQC service`);
            return Math.max(0, Math.min(1, score));
        } catch (error: any) {
            if (!this.useLocalFallback) {
                throw new Error(`IQC clip scoring unavailable: ${error?.message || error}`);
            }
            this.logger.warn(`IQC unavailable; using local CLIP fallback (${error?.message || error})`);
            const classifier = await this.getClassifier();
            const labels = [brief, 'irrelevant image'];
            const output = await classifier(imageUrl, labels);
            const items = Array.isArray(output) ? output : [];
            const match = items.find((item: any) => item?.label === brief) || items[0];
            const score = Number(match?.score || 0);
            if (!Number.isFinite(score)) return 0;
            this.logger.log(`CLIP score=${score.toFixed(4)} via local fallback`);
            return Math.max(0, Math.min(1, score));
        }
    }

    async visionScoreImage(
        imageUrl: string,
        brief: string,
        domain = '',
        style = '',
        fallback: { score: number; reason: string } = { score: 75, reason: 'Vision gate unavailable; accepted with neutral score.' },
    ): Promise<{ score: number; reason: string }> {
        try {
            const res = await this.postWithRetry(
                `${this.scorerUrl}/score/vision`,
                { imageUrl, brief, domain, style },
                { timeout: Math.max(this.timeoutMs, 30000), headers: { 'Content-Type': 'application/json' } },
            );
            const score = Number(res?.data?.score || 0);
            const reason = String(res?.data?.reason || 'No reason provided').slice(0, 280);
            if (!Number.isFinite(score)) throw new Error('image-quality-control returned non-numeric vision score');
            return { score: Math.max(0, Math.min(100, score)), reason };
        } catch (error: any) {
            this.logger.warn(`IQC vision scoring unavailable; using fallback (${error?.message || error})`);
            return fallback;
        }
    }

    async scoreComposite(
        imageUrl: string,
        brief: string,
        options?: {
            domain?: string;
            style?: string;
            clipWeight?: number;
            clipThreshold?: number;
            disableClip?: boolean;
            disableVision?: boolean;
        },
    ): Promise<{
        clip_score: number;
        vision_score: number;
        vision_reason: string;
        weighted_score: number;
        clip_pass: boolean;
        vision_pass: boolean;
        vision_threshold: number;
        accepted: boolean;
    }> {
        const payload = { imageUrl, brief, ...(options || {}) };
        const res = await this.postWithRetry(
            `${this.scorerUrl}/score/composite`,
            payload,
            { timeout: Math.max(this.timeoutMs, 30000), headers: { 'Content-Type': 'application/json' } },
        );
        return {
            clip_score: Number(res?.data?.clip_score || 0),
            vision_score: Number(res?.data?.vision_score || 0),
            vision_reason: String(res?.data?.vision_reason || ''),
            weighted_score: Number(res?.data?.weighted_score || 0),
            clip_pass: Boolean(res?.data?.clip_pass),
            vision_pass: Boolean(res?.data?.vision_pass),
            vision_threshold: Number(res?.data?.vision_threshold || 0),
            accepted: Boolean(res?.data?.accepted),
        };
    }

    private async postWithRetry(url: string, payload: any, config: any): Promise<any> {
        const attempts = Math.max(1, Number(this.configService.get<string>('IQC_REQUEST_ATTEMPTS') || 2));
        let lastError: any = null;
        for (let i = 0; i < attempts; i++) {
            try {
                return await axios.post(url, payload, config);
            } catch (error: any) {
                lastError = error;
                const msg = String(error?.message || '').toLowerCase();
                const retryable = msg.includes('econnrefused') || msg.includes('etimedout') || msg.includes('socket hang up');
                if (!retryable || i >= attempts - 1) break;
                await new Promise((resolve) => setTimeout(resolve, 250));
            }
        }
        throw lastError;
    }

    private async checkIqcHealth(): Promise<void> {
        const started = Date.now();
        try {
            const res = await axios.get(`${this.scorerUrl}/health`, { timeout: Math.min(this.timeoutMs, 5000) });
            const ok = Number(res?.status || 0) >= 200 && Number(res?.status || 0) < 300;
            if (this.heartbeatPrevHealthy !== true && ok) {
                this.observability.emitLog('success', `IQC heartbeat healthy (${Date.now() - started}ms)`, 'IQCHeartbeat', undefined, undefined, {
                    metadata: { provider_status: 'up', event_kind: 'iqc_heartbeat', latency_ms: Date.now() - started, iqc_url: this.scorerUrl },
                });
            }
            this.heartbeatPrevHealthy = ok;
        } catch (error: any) {
            if (this.heartbeatPrevHealthy !== false) {
                this.observability.emitLog('warn', `IQC heartbeat failed: ${String(error?.message || error)}`, 'IQCHeartbeat', undefined, undefined, {
                    metadata: { provider_status: 'down', event_kind: 'iqc_heartbeat', iqc_url: this.scorerUrl },
                });
            }
            this.heartbeatPrevHealthy = false;
        }
    }
}
