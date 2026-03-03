import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ImageOrchestratorService } from './image-orchestrator.service';
import { LocalClipService } from './services/local-clip.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { AdminGuard } from '../auth/admin.guard';
import { GenerateContentDto, GenerateManifestDto, SourceDebugDto } from './dto/image-gen-request.dto';
import { enforceManifestLimits } from '../common/validation/payload-limits';

@Controller('generate')
@UseGuards(ApiKeyGuard)
export class ImageGenController {
    constructor(
        private readonly orchestrator: ImageOrchestratorService,
        private readonly configService: ConfigService,
        private readonly clipService: LocalClipService,
    ) { }

    @Post()
    async generate(@Body() body: GenerateContentDto) {
        return this.orchestrator.generateCourse(body.content);
    }

    @Post('manifest')
    async generateFromManifest(@Body() manifest: any, @Req() req: any) {
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
        try {
            const result = await this.clipService.visionScoreImage(imageUrl, brief, '', '', {
                score: 75,
                reason: 'Vision gate unavailable; accepted with neutral score.',
            });
            return {
                score: Number.isFinite(result.score) ? Math.max(0, Math.min(100, result.score)) : null,
                reason: String(result.reason || '').slice(0, 300) || null,
            };
        } catch (e: any) {
            return { score: null, reason: `vision_error: ${String(e?.message || e)}` };
        }
    }
}
