import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import OpenAI from 'openai';
import { ImageOrchestratorService } from './image-orchestrator.service';
import { LocalClipService } from './services/local-clip.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { AdminGuard } from '../auth/admin.guard';
import { GenerateContentDto, GenerateManifestDto, SourceDebugDto } from './dto/image-gen-request.dto';
import { enforceManifestLimits } from '../common/validation/payload-limits';

@Controller('generate')
@UseGuards(ApiKeyGuard)
export class ImageGenController {
    private readonly openai: OpenAI | null;

    constructor(
        private readonly orchestrator: ImageOrchestratorService,
        private readonly configService: ConfigService,
        private readonly clipService: LocalClipService,
    ) {
        const apiKey = this.configService.get<string>('OPENROUTER_API_KEY');
        this.openai = apiKey ? new OpenAI({
            apiKey,
            baseURL: 'https://openrouter.ai/api/v1',
            defaultHeaders: {
                'HTTP-Referer': 'https://visualization-project.local',
                'X-Title': 'Visualization Project Query Lab',
            }
        }) : null;
    }

    @Post()
    async generate(@Body() body: GenerateContentDto) {
        return this.orchestrator.generateCourse(body.content);
    }

    @Post('manifest')
    async generateFromManifest(@Body() manifest: GenerateManifestDto, @Req() req: any) {
        enforceManifestLimits(manifest);
        const userId = Number(req?.authUser?.id);
        const authContext = Number.isFinite(userId) ? { userId } : undefined;
        // Fire and forget for the API response, but the service now does the work
        this.orchestrator.generateFromManifest(manifest, authContext).catch(err => {
            console.error('Batch error:', err);
        });
        return { message: 'Batch started', taskCount: (manifest.lessons || manifest.course?.lessons || []).length };
    }

    @Post('stop')
    @UseGuards(AdminGuard)
    async stopBatch() {
        this.orchestrator.stopBatch();
        return { message: 'Batch stop signal sent' };
    }

    @Post('source-debug')
    async sourceDebug(@Body() body: SourceDebugDto) {
        const query = String(body?.query || '').trim();

        const provider = String(this.configService.get<string>('SOURCED_IMAGE_PROVIDER') || 'pixabay').toLowerCase();
        if (provider !== 'pixabay') {
            return { error: `source-debug currently supports pixabay only. Current provider=${provider}` };
        }

        const key = String(this.configService.get<string>('PIXABAY_API_KEY') || '').trim();
        if (!key) {
            return { error: 'PIXABAY_API_KEY is missing in .env' };
        }

        const perPage = Math.min(10, Math.max(5, Number(body?.per_page || 10)));
        const clipBrief = String(body?.clip_brief || query).trim();
        const orientation = String(body?.orientation || 'horizontal').toLowerCase() === 'vertical' ? 'vertical' : 'horizontal';

        const res = await axios.get('https://pixabay.com/api/', {
            timeout: 10000,
            params: {
                key,
                q: query,
                image_type: 'photo',
                orientation,
                per_page: perPage,
                safesearch: 'true',
                order: 'popular',
                lang: 'en',
            },
        });

        const hits = Array.isArray(res?.data?.hits) ? res.data.hits : [];
        const top = hits.slice(0, 5);
        const items: any[] = [];
        for (let i = 0; i < top.length; i++) {
            const h = top[i];
            const imageUrl = h?.largeImageURL || h?.webformatURL;
            if (!imageUrl) continue;
            let clip_score: number | null = null;
            let clip_error: string | null = null;
            let vision_score: number | null = null;
            let vision_reason: string | null = null;

            try {
                clip_score = await this.clipService.scoreImageAgainstBrief(imageUrl, clipBrief);
            } catch (e: any) {
                clip_error = String(e?.message || e);
            }

            const v = await this.visionScore(imageUrl, clipBrief);
            vision_score = v.score;
            vision_reason = v.reason;

            items.push({
                index: i + 1,
                query,
                clip_brief: clipBrief,
                image_url: imageUrl,
                page_url: h?.pageURL || null,
                tags: h?.tags || null,
                user: h?.user || null,
                clip_score,
                clip_error,
                vision_score,
                vision_reason,
            });
        }

        return {
            provider: 'pixabay',
            query,
            clip_brief: clipBrief,
            count: items.length,
            results: items,
        };
    }

    private async visionScore(imageUrl: string, brief: string): Promise<{ score: number | null; reason: string | null }> {
        if (!this.openai) {
            return { score: null, reason: 'OPENROUTER_API_KEY missing' };
        }
        try {
            const model = this.configService.get<string>('OPENROUTER_VISION_MODEL')
                || this.configService.get<string>('OPENROUTER_MODEL')
                || 'google/gemini-2.0-flash-001';
            const response = await this.openai.chat.completions.create({
                model,
                temperature: 0,
                max_tokens: 180,
                messages: [
                    {
                        role: 'system',
                        content: 'Score image-query alignment 0-100 and return JSON only: {"score": number, "reason":"short"}'
                    },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: `Query brief: ${brief}` },
                            { type: 'image_url', image_url: { url: imageUrl } }
                        ]
                    }
                ]
            });
            const raw = String(response.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();
            const parsed = JSON.parse(raw || '{}');
            const score = Number(parsed?.score);
            return {
                score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null,
                reason: String(parsed?.reason || '').slice(0, 300) || null,
            };
        } catch (e: any) {
            return { score: null, reason: `vision_error: ${String(e?.message || e)}` };
        }
    }
}
