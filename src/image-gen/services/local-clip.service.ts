import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class LocalClipService {
    private readonly logger = new Logger(LocalClipService.name);
    private classifierPromise: Promise<any> | null = null;
    private readonly scorerUrl: string;
    private readonly useLocalFallback: boolean;

    constructor(private readonly configService: ConfigService) {
        this.scorerUrl = String(this.configService.get<string>('CLIP_SCORER_URL') || 'http://127.0.0.1:4310').replace(/\/+$/, '');
        this.useLocalFallback = String(this.configService.get<string>('CLIP_SCORER_USE_LOCAL_FALLBACK') || 'false').toLowerCase() === 'true';
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
                `${this.scorerUrl}/score`,
                { imageUrl, brief },
                { timeout: 12000, headers: { 'Content-Type': 'application/json' } }
            );
            const score = Number(res?.data?.score || 0);
            if (!Number.isFinite(score)) throw new Error('clip-scorer returned non-numeric score');
            this.logger.log(`CLIP score=${score.toFixed(4)} via external scorer`);
            return Math.max(0, Math.min(1, score));
        } catch (error: any) {
            if (!this.useLocalFallback) {
                throw new Error(`External CLIP scorer unavailable: ${error?.message || error}`);
            }
            this.logger.warn(`External scorer unavailable; using local fallback (${error?.message || error})`);
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
}
