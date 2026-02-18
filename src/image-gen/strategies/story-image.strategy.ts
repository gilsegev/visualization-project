import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import * as path from 'path';
import * as pLimit from 'p-limit';
import { BaseImageStrategy, ImageGenerationResult } from '../base-image.strategy';
import { ImageTask } from '../image-task.schema';
import { LocalStorageService } from '../local-storage.service';
import { ObservabilityGateway } from '../../observability/observability.gateway';
import { TemplateStampingService } from '../services/template-stamping.service';
import { BrowserService } from '../browser.service';

@Injectable()
export class StoryImageStrategy extends BaseImageStrategy {
    private readonly queue = pLimit(2); // High-fidelity queue cap

    constructor(
        private readonly configService: ConfigService,
        private readonly localStorage: LocalStorageService,
        private readonly observability: ObservabilityGateway,
        private readonly stampingService: TemplateStampingService,
        private readonly browserService: BrowserService,
    ) {
        super();
    }

    protected async performGeneration(task: ImageTask): Promise<ImageGenerationResult> {
        return this.queue(async () => {
            const payload = (task as any).payload || {};
            const imageSpecs = payload.imageSpecs;
            const brief = String(imageSpecs?.brief || '').trim();
            if (!imageSpecs || !brief) {
                const refusalError: any = new Error('Missing mandatory imageSpecs for narrative type.');
                refusalError.correction_log = ['Missing mandatory imageSpecs for narrative type.'];
                refusalError.refusal = true;
                throw refusalError;
            }

            const siliconFlowKey = this.configService.get<string>('SILICONFLOW_API_KEY');
            if (!siliconFlowKey) {
                throw new Error('SILICONFLOW_API_KEY is not defined in environment variables.');
            }

            const imageSpecsSafe = imageSpecs || {};
            const generation = imageSpecsSafe?.rendering?.generation || {};
            const promptParts = generation?.promptParts || {};
            const constraints = imageSpecsSafe?.constraints || {};
            const dims = this.resolveDimensions(task);
            const width = dims.width;
            const height = dims.height;
            const imageSize = `${width}x${height}`;
            const exportScale = this.resolveExportScale(imageSpecsSafe);

            const positiveParts = this.asStringList(promptParts.positive);
            const negativeParts = this.asStringList(promptParts.negative);
            const paletteLocked = Boolean(constraints.paletteLockToCourseStyleGuide);
            const noBakedInText = Boolean(constraints.noBakedInText);
            const customTheme = (task as any)?.metadata?.custom_theme;
            const styleGuide = String(customTheme?.image_style_suffix || 'Wellness illustration, simplified faceless silhouettes').trim();

            const paletteHexes = this.asStringList((task as any)?.metadata?.course_palette_hexes)
                .filter(v => /^#[0-9a-f]{3,8}$/i.test(v));

            const subjectPrompt = positiveParts.length
                ? positiveParts.join(', ')
                : (brief || task.refined_prompt || 'minimal wellness illustration');

            const effectiveNegative = [...negativeParts];
            if (noBakedInText) {
                effectiveNegative.push('text', 'typography', 'letters', 'words', 'watermark', 'logo');
            }
            effectiveNegative.push('photorealistic', 'cinematic', '3d render', 'realistic photo');

            const palettePrefix = paletteLocked && paletteHexes.length
                ? `Use only this locked course palette: ${paletteHexes.join(', ')}. `
                : '';

            const finalPrompt = `Style: ${styleGuide}. Subject: ${palettePrefix}${subjectPrompt}${effectiveNegative.length ? ` --no ${effectiveNegative.join(', ')}` : ''}`;
            this.observability.emitLog(
                'info',
                `Story Image Prompt (size=${imageSize}): ${finalPrompt}`,
                'StoryImage',
                task.id
            );

            const model = this.configService.get<string>('SILICONFLOW_STORY_MODEL') || 'black-forest-labs/FLUX.1-schnell';
            const started = Date.now();
            this.observability.emitLog('info', `Story image request queued model=${model} size=${imageSize}`, 'StoryImage', task.id);
            let backoffEvents = 0;
            const generationResponse = await this.generateWithBackoff({
                apiKey: siliconFlowKey,
                model,
                prompt: finalPrompt,
                imageSize,
                onBackoff: () => { backoffEvents += 1; }
            });
            const imageUrl = generationResponse?.data?.data?.[0]?.url;
            if (!imageUrl) {
                throw new Error('No image URL returned from SiliconFlow for story image.');
            }

            const imageBinary = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
            const relativeOutputDir = this.getRelativeOutputDir(task);
            const assetUrl = await this.localStorage.save(
                path.join(relativeOutputDir, 'assets', 'story_image.png'),
                Buffer.from(imageBinary.data)
            );
            const framePayload = {
                image_url: './assets/story_image.png',
            };
            const frameHtml = this.stampingService.stamp('story_frame', framePayload, customTheme);

            const dimsForCapture = this.resolveDimensions(task);
            const taskBaseUrl = path.join(process.cwd(), 'public', 'generated-images', relativeOutputDir);
            const posterBuffer = await this.browserService.screenshotHtml(frameHtml, taskBaseUrl, {
                ...dimsForCapture,
                resizeMode: 'fill',
                scale: exportScale,
            });
            const publicUrl = await this.localStorage.save(path.join(relativeOutputDir, 'poster.png'), posterBuffer);
            await this.localStorage.save(path.join(relativeOutputDir, 'index.html'), Buffer.from(frameHtml));
            await this.localStorage.save(path.join(relativeOutputDir, 'blueprint.json'), Buffer.from(JSON.stringify({
                template_id: 'story_frame',
                image_url: assetUrl,
                image_size: imageSize,
                export_scale: exportScale,
            }, null, 2)));

            const elapsedMs = Date.now() - started;
            const attempts = Number(generationResponse?.meta?.attempts || 1);
            const estimatedCostUsd = this.estimateCostUsd(width, height, attempts);
            this.observability.emitLog(
                'info',
                `NarrativeHero metrics | gen_ms=${elapsedMs} attempts=${attempts} backoff_events=${backoffEvents} est_cost_usd=${estimatedCostUsd.toFixed(4)}`,
                'StoryImage',
                task.id
            );
            this.observability.emitLog('success', `Story image generated in ${elapsedMs}ms`, 'StoryImage', task.id);

            return {
                url: publicUrl,
                posterUrl: publicUrl,
                payload: {
                    output_dir: relativeOutputDir,
                    metrics: {
                        generation_ms: elapsedMs.toFixed(2),
                        narrative_hero_gen_ms: elapsedMs.toFixed(2),
                        siliconflow_backoff_events: backoffEvents,
                        siliconflow_attempts: attempts,
                        estimated_cost_usd: estimatedCostUsd.toFixed(4),
                        total_ms: elapsedMs.toFixed(2),
                    },
                    prompt: {
                        positive: positiveParts,
                        negative: effectiveNegative,
                        final: finalPrompt,
                        palette_locked: paletteLocked,
                    },
                    image_prompts: [finalPrompt],
                    blueprint_prompt: task.refined_prompt,
                    image_size: imageSize,
                    stamped_template: 'story_frame',
                    quality_score: 90,
                    model,
                    export_scale: exportScale,
                }
            };
        });
    }

    private async generateWithBackoff(params: {
        apiKey: string;
        model: string;
        prompt: string;
        imageSize: string;
        onBackoff?: () => void;
    }): Promise<any> {
        const maxAttempts = 4;
        let attempt = 0;
        let lastError: any;

        while (attempt < maxAttempts) {
            attempt += 1;
            try {
                const response = await axios.post(
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
                (response as any).meta = { attempts: attempt };
                return response;
            } catch (error) {
                lastError = error;
                const status = (error as AxiosError)?.response?.status;
                const retryable = status === 429 || status === 503;
                if (!retryable || attempt >= maxAttempts) break;
                params.onBackoff?.();
                const delayMs = 1000 * Math.pow(2, attempt - 1); // 1s -> 2s -> 4s
                this.observability.emitLog(
                    'warn',
                    `Story image retry scheduled (attempt=${attempt + 1}/${maxAttempts}) status=${status} backoff=${delayMs}ms`,
                    'StoryImage'
                );
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
        return path.join(dateStr, courseId, lessonId, 'hero', task.id);
    }

    private asStringList(input: any): string[] {
        if (!Array.isArray(input)) return [];
        return input.map(v => String(v).trim()).filter(Boolean);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private resolveDimensions(task: ImageTask): { width: number; height: number } {
        const payload = (task as any)?.payload || {};
        const metadataDims = (task as any)?.metadata?.dimensions || {};
        const payloadDims = payload?.dimensions || {};
        const source = { ...payloadDims, ...metadataDims };

        const directWidth = this.parseDimension(source?.width);
        const directHeight = this.parseDimension(source?.height);
        if (directWidth && directHeight) {
            return { width: directWidth, height: directHeight };
        }

        const pair = String(source?.size || source?.resolution || '').trim();
        const match = pair.match(/(\d{2,5})\s*[xX×]\s*(\d{2,5})/);
        if (match) {
            const width = this.parseDimension(match[1]);
            const height = this.parseDimension(match[2]);
            if (width && height) return { width, height };
        }

        return { width: 1400, height: 900 };
    }

    private parseDimension(value: any): number | null {
        if (value === null || value === undefined) return null;
        const parsed = Number(String(value).replace(/[^\d.]/g, ''));
        if (!Number.isFinite(parsed) || parsed <= 0) return null;
        return Math.max(256, Math.round(parsed));
    }

    private estimateCostUsd(width: number, height: number, attempts: number): number {
        const baseCost = Number(this.configService.get<string>('SILICONFLOW_STORY_BASE_COST_USD') || 0.02);
        const areaFactor = (width * height) / (1024 * 1024);
        const retryFactor = Math.max(1, attempts);
        return baseCost * areaFactor * retryFactor;
    }

    private resolveExportScale(imageSpecs: any): number {
        const rawScale = Number(imageSpecs?.rendering?.export?.scale || 1);
        if (!Number.isFinite(rawScale) || rawScale <= 0) return 1;
        return Math.max(1, Math.round(rawScale));
    }
}
