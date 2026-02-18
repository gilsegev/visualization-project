import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import * as path from 'path';
import * as pLimit from 'p-limit';
import { BaseImageStrategy, ImageGenerationResult } from '../base-image.strategy';
import { ImageTask } from '../image-task.schema';
import { LocalStorageService } from '../local-storage.service';
import { ObservabilityGateway } from '../../observability/observability.gateway';

@Injectable()
export class StoryImageStrategy extends BaseImageStrategy {
    private readonly queue = pLimit(2); // High-fidelity queue cap

    constructor(
        private readonly configService: ConfigService,
        private readonly localStorage: LocalStorageService,
        private readonly observability: ObservabilityGateway,
    ) {
        super();
    }

    protected async performGeneration(task: ImageTask): Promise<ImageGenerationResult> {
        return this.queue(async () => {
            const siliconFlowKey = this.configService.get<string>('SILICONFLOW_API_KEY');
            if (!siliconFlowKey) {
                throw new Error('SILICONFLOW_API_KEY is not defined in environment variables.');
            }

            const payload = (task as any).payload || {};
            const imageSpecs = payload.imageSpecs || {};
            const generation = imageSpecs?.rendering?.generation || {};
            const promptParts = generation?.promptParts || {};
            const constraints = imageSpecs?.constraints || {};
            const dims = (task as any)?.metadata?.dimensions || {};
            const width = Math.max(256, Number(dims.width || 1400));
            const height = Math.max(256, Number(dims.height || 900));
            const imageSize = `${width}x${height}`;

            const positiveParts = this.asStringList(promptParts.positive);
            const negativeParts = this.asStringList(promptParts.negative);
            const paletteLocked = Boolean(constraints.paletteLockToCourseStyleGuide);
            const noBakedInText = Boolean(constraints.noBakedInText);

            const paletteHexes = this.asStringList((task as any)?.metadata?.course_palette_hexes)
                .filter(v => /^#[0-9a-f]{3,8}$/i.test(v));

            const positivePrompt = positiveParts.length
                ? positiveParts.join(', ')
                : (imageSpecs?.brief || task.refined_prompt || 'minimal wellness illustration');

            const effectiveNegative = [...negativeParts];
            if (noBakedInText) {
                effectiveNegative.push('text', 'typography', 'letters', 'words', 'watermark', 'logo');
            }

            const palettePrefix = paletteLocked && paletteHexes.length
                ? `Use only this locked course palette: ${paletteHexes.join(', ')}. `
                : '';

            const finalPrompt = `${palettePrefix}${positivePrompt}${effectiveNegative.length ? ` --no ${effectiveNegative.join(', ')}` : ''}`;
            this.observability.emitLog(
                'info',
                `Story Image Prompt (size=${imageSize}): ${finalPrompt}`,
                'StoryImage',
                task.id
            );

            const model = this.configService.get<string>('SILICONFLOW_STORY_MODEL') || 'black-forest-labs/FLUX.1-schnell';
            const started = Date.now();
            const generationResponse = await this.generateWithBackoff({
                apiKey: siliconFlowKey,
                model,
                prompt: finalPrompt,
                imageSize,
            });
            const imageUrl = generationResponse?.data?.[0]?.url;
            if (!imageUrl) {
                throw new Error('No image URL returned from SiliconFlow for story image.');
            }

            const imageBinary = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
            const relativeOutputDir = this.getRelativeOutputDir(task);
            const publicUrl = await this.localStorage.save(
                path.join(relativeOutputDir, 'poster.png'),
                Buffer.from(imageBinary.data)
            );

            const elapsedMs = Date.now() - started;
            this.observability.emitLog('success', `Story image generated in ${elapsedMs}ms`, 'StoryImage', task.id);

            return {
                url: publicUrl,
                posterUrl: publicUrl,
                payload: {
                    output_dir: relativeOutputDir,
                    metrics: { generation_ms: elapsedMs.toFixed(2) },
                    prompt: {
                        positive: positiveParts,
                        negative: effectiveNegative,
                        final: finalPrompt,
                        palette_locked: paletteLocked,
                    },
                    image_size: imageSize,
                    model,
                }
            };
        });
    }

    private async generateWithBackoff(params: {
        apiKey: string;
        model: string;
        prompt: string;
        imageSize: string;
    }): Promise<any> {
        const maxAttempts = 4;
        let attempt = 0;
        let lastError: any;

        while (attempt < maxAttempts) {
            attempt += 1;
            try {
                return await axios.post(
                    'https://api.siliconflow.com/v1/images/generations',
                    {
                        model: params.model,
                        prompt: params.prompt,
                        image_size: params.imageSize,
                        num_inference_steps: 4,
                        batch_size: 1
                    },
                    {
                        headers: {
                            Authorization: `Bearer ${params.apiKey}`,
                            'Content-Type': 'application/json',
                        },
                        timeout: 45000,
                    }
                );
            } catch (error) {
                lastError = error;
                const status = (error as AxiosError)?.response?.status;
                const retryable = status === 429 || status === 503;
                if (!retryable || attempt >= maxAttempts) break;
                const delayMs = 1000 * Math.pow(2, attempt - 1); // 1s -> 2s -> 4s
                await this.sleep(delayMs);
            }
        }

        throw lastError;
    }

    private getRelativeOutputDir(task: ImageTask): string {
        const dateStr = new Date().toISOString().split('T')[0];
        const meta = (task as any).metadata || {};
        const courseId = meta.course_id || 'uncategorized_course';
        const lessonId = meta.lesson_id || 'uncategorized_lesson';
        return path.join(dateStr, courseId, lessonId, task.id);
    }

    private asStringList(input: any): string[] {
        if (!Array.isArray(input)) return [];
        return input.map(v => String(v).trim()).filter(Boolean);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

