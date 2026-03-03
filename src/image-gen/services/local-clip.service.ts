import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class LocalClipService {
    private readonly logger = new Logger(LocalClipService.name);
    private classifierPromise: Promise<any> | null = null;
    private readonly scorerUrl: string;
    private readonly useLocalFallback: boolean;
    private readonly timeoutMs: number;

    constructor(private readonly configService: ConfigService) {
        this.scorerUrl = String(
            this.configService.get<string>('IQC_URL')
            || this.configService.get<string>('CLIP_SCORER_URL')
            || 'http://127.0.0.1:4310'
        ).replace(/\/+$/, '');
        this.useLocalFallback = String(this.configService.get<string>('CLIP_SCORER_USE_LOCAL_FALLBACK') || 'false').toLowerCase() === 'true';
        const configuredTimeout = Number(this.configService.get<string>('QUALITY_CONTROL_TIMEOUT_MS') || 12000);
        this.timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 12000;
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
            const res = await axios.post(
                `${this.scorerUrl}/score/clip`,
                { imageUrl, brief },
                { timeout: this.timeoutMs, headers: { 'Content-Type': 'application/json' } }
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
            const res = await axios.post(
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
        const res = await axios.post(
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
}
