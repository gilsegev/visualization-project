import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class LocalClipService {
    private readonly logger = new Logger(LocalClipService.name);
    private classifierPromise: Promise<any> | null = null;

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
        const classifier = await this.getClassifier();
        const labels = [brief, 'irrelevant image'];
        const output = await classifier(imageUrl, labels);
        const items = Array.isArray(output) ? output : [];
        const match = items.find((item: any) => item?.label === brief) || items[0];
        const score = Number(match?.score || 0);
        if (!Number.isFinite(score)) return 0;
        this.logger.log(`CLIP score=${score.toFixed(4)} for url=${imageUrl.slice(0, 80)}`);
        return Math.max(0, Math.min(1, score));
    }
}
