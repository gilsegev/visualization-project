import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';
import OpenAI from 'openai';
import * as pLimit from 'p-limit';
import { BaseImageStrategy, ImageGenerationResult } from '../base-image.strategy';
import { ImageTask } from '../image-task.schema';
import { LocalStorageService } from '../local-storage.service';
import { ObservabilityGateway } from '../../observability/observability.gateway';
import { TemplateStampingService } from '../services/template-stamping.service';
import { BrowserService } from '../browser.service';
import { LocalClipService } from '../services/local-clip.service';
import { StoryImageStrategy } from './story-image.strategy';
import { QueryOptimizer } from '../services/query-optimizer';
import { resolveWithinGeneratedImages, sanitizeRelativePath } from '../../common/path-safety.util';

@Injectable()
export class SourcedImageStrategy extends BaseImageStrategy {
    private readonly openai: OpenAI | null;
    private readonly queue = pLimit(1); // Keep CLIP/vision calls serialized to avoid provider/runtime instability.
    private readonly taskTimeoutMs: number;
    private readonly disableClip: boolean;
    private readonly disableVision: boolean;
    private readonly degradedVisionThreshold: number;
    private readonly queryOptimizer: QueryOptimizer;

    constructor(
        private readonly configService: ConfigService,
        private readonly localStorage: LocalStorageService,
        private readonly observability: ObservabilityGateway,
        private readonly stampingService: TemplateStampingService,
        private readonly browserService: BrowserService,
        private readonly clipService: LocalClipService,
        private readonly storyImageStrategy: StoryImageStrategy,
    ) {
        super();
        const apiKey = this.configService.get<string>('OPENROUTER_API_KEY');
        const configuredTimeoutMs = Number(this.configService.get<string>('SOURCED_IMAGE_TIMEOUT_MS') || 90000);
        this.taskTimeoutMs = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
            ? configuredTimeoutMs
            : 90000;
        this.disableClip = String(this.configService.get<string>('SOURCED_IMAGE_DISABLE_CLIP') || 'true').toLowerCase() === 'true';
        this.disableVision = String(this.configService.get<string>('SOURCED_IMAGE_DISABLE_VISION') || 'true').toLowerCase() === 'true';
        const degradedThreshold = Number(this.configService.get<string>('SOURCED_IMAGE_DEGRADED_VISION_THRESHOLD') || 35);
        this.degradedVisionThreshold = Number.isFinite(degradedThreshold)
            ? Math.max(0, Math.min(100, degradedThreshold))
            : 35;
        this.openai = apiKey ? new OpenAI({
            apiKey,
            baseURL: 'https://openrouter.ai/api/v1',
            defaultHeaders: {
                'HTTP-Referer': 'https://visualization-project.local',
                'X-Title': 'Visualization Project Sourced Image'
            }
        }) : null;
        this.queryOptimizer = new QueryOptimizer(this.openai);
    }

    protected async performGeneration(task: ImageTask): Promise<ImageGenerationResult> {
        const enqueuedAt = Date.now();
        return this.queue(async () => {
            const queueWaitMs = Date.now() - enqueuedAt;
            if (queueWaitMs > 1000) {
                this.observability.emitLog('warn', `Queue wait before sourced generation: ${queueWaitMs}ms`, 'SourcedImage', task.id);
            }
            return this.withTimeout((async () => {
            const phaseStart = Date.now();
            const phaseMs: Record<string, number> = {
                query_expansion_ms: 0,
                retrieval_ms: 0,
                clip_scoring_ms: 0,
                vision_gate_ms: 0,
                stamping_ms: 0,
            };
            const payload = (task as any)?.payload || {};
            const imageSpecs = payload?.imageSpecs || {};
            const brief = String(imageSpecs?.brief || '').trim();
            if (!brief) {
                const err: any = new Error('Missing mandatory imageSpecs for narrative type.');
                err.correction_log = ['Missing mandatory imageSpecs for narrative type.'];
                throw err;
            }

            const dims = this.resolveDimensions(task);
            const exportScale = this.resolveExportScale(imageSpecs);
            const sourceUrl = String(imageSpecs?.source?.assetUrl || '').trim();
            const orientation = 'landscape';
            const normalizedBrief = this.normalizeQuery(brief, 12);
            const sourceProviders = this.resolveSourceProviders();
            const sourceProviderLabel = sourceProviders.join('+');
            if (!sourceProviders.length) {
                this.observability.emitLog('warn', 'No sourced-image providers configured (set PIXABAY_API_KEY and/or UNSPLASH_ACCESS_KEY). Falling back to story generator.', 'SourcedImage', task.id);
                return this.fallbackToStory(task, { sourced_fallback_reason: 'missing_source_keys' }, {
                    brief,
                    queries: [],
                    candidates: [],
                    queryConfig: { providers: [] },
                });
            }
            const signalTokens = normalizedBrief.split(' ').filter(Boolean);
            const querySignals = {
                normalized_brief: normalizedBrief,
                domain_terms: this.pickDomainTerms(signalTokens),
                scene_terms: this.pickSceneTerms(signalTokens),
            };
            let queryConfig: Record<string, any> = {
                providers: sourceProviders,
                orientation,
                per_page: 10,
                content_filter: 'high',
                order_by: 'mixed',
                max_queries: 5,
                candidate_cap: 10,
            };

            this.observability.emitLog('info', 'Phase 1/6: CLIP scorer enabled for semantic scoring', 'SourcedImage', task.id);

            // Fast path: when manifest already provides an explicit source asset, do direct stamping.
            // This keeps sourced mode reliable and avoids unnecessary CLIP/LLM gating for trusted inputs.
            if (sourceUrl) {
                return await this.renderDirectSource(task, sourceUrl, dims.width, dims.height, exportScale, phaseStart);
            }

            const queryStart = Date.now();
            const expanded = sourceUrl
                ? { queries: ['provided-source'], mode: 'heuristic' as const }
                : await this.queryOptimizer.expandQuery(
                    brief,
                    1900,
                    () => this.expandQueriesHeuristic(brief),
                    { withQuality: false, lessonTitle: String((task as any)?.metadata?.lesson_title || '') }
                );
            const unsplashQueries = this.uniqueQueries(expanded.queries).slice(0, 5);
            const pixabayQueries = this.optimizePixabayQueries(expanded.queries, brief);
            let queries = this.uniqueQueries([...pixabayQueries, ...unsplashQueries]).slice(0, 5);
            const primaryDomain = this.resolvePrimaryDomain(task, brief);
            const evaluationBrief = this.buildEvaluationBrief(brief, (expanded as any)?.plan, queries);
            const clipTarget = this.normalizeClipText(evaluationBrief);
            phaseMs.query_expansion_ms = Date.now() - queryStart;
            this.observability.emitLog('info', `Phase 2/6: Query expansion complete (${queries.length} queries, mode=${expanded.mode})`, 'SourcedImage', task.id);
            if ((expanded as any)?.plan) {
                const plan = (expanded as any).plan;
                this.observability.emitLog(
                    'info',
                    `LLM query plan: subject="${plan.subject || ''}" state="${plan.state || ''}" setting="${plan.setting || ''}" required=[${(plan.required_terms || []).join(', ')}]`,
                    'SourcedImage',
                    task.id
                );
            }
            this.observability.emitLog('info', `Expanded queries (unsplash): ${unsplashQueries.join(' | ')}`, 'SourcedImage', task.id);
            this.observability.emitLog('info', `Expanded queries (pixabay): ${pixabayQueries.join(' | ')}`, 'SourcedImage', task.id);
            this.observability.emitLog('info', `Validation brief: ${evaluationBrief}`, 'SourcedImage', task.id);
            this.observability.emitLog('info', `Domain hardening: domain="${primaryDomain}" providers=${sourceProviderLabel}`, 'SourcedImage', task.id);
            this.observability.emitLog('info', `Query signals: normalized="${querySignals.normalized_brief}" domain="${querySignals.domain_terms}" scene="${querySignals.scene_terms}"`, 'SourcedImage', task.id);
            this.observability.emitLog('info', `sourced query config: providers=${sourceProviderLabel} orientation=${queryConfig.orientation} per_page=${queryConfig.per_page} max_queries=${queryConfig.max_queries} candidate_cap=${queryConfig.candidate_cap}`, 'SourcedImage', task.id);

            const retrievalStart = Date.now();
            let candidates = await this.fetchCombinedCandidates(unsplashQueries, pixabayQueries, dims.width, dims.height, task.id);
            phaseMs.retrieval_ms = Date.now() - retrievalStart;
            const sourcedCandidates = candidates.map((c) => ({ provider: c.provider, query: c.query, image_url: c.imageUrl }));
            if (sourcedCandidates.length) {
                const queryCounts = sourcedCandidates.reduce((acc: Record<string, number>, c: any) => {
                    const key = `${c.provider}:${c.query}`;
                    acc[key] = (acc[key] || 0) + 1;
                    return acc;
                }, {});
                const compact = Object.entries(queryCounts).map(([q, count]) => `"${q}"=${count}`).join(' ; ');
                this.observability.emitLog('info', `Sourced candidates summary (${sourcedCandidates.length}): ${compact}`, 'SourcedImage', task.id);
            }

            if (!candidates.length) {
                this.observability.emitLog('warn', 'No sourced candidates found; falling back to story generator', 'SourcedImage', task.id);
                return this.fallbackToStory(task, { validation_brief: evaluationBrief }, {
                    brief,
                    queries,
                    candidates: sourcedCandidates,
                    queryConfig,
                });
            }

            const configuredClipThreshold = Number(this.configService.get<string>('SOURCED_IMAGE_CLIP_THRESHOLD') || '');
            const clipThreshold = Number.isFinite(configuredClipThreshold)
                ? Math.max(0, Math.min(1, configuredClipThreshold))
                : 0.65;
            const configuredClipWeight = Number(this.configService.get<string>('SOURCED_IMAGE_COMPOSITE_CLIP_WEIGHT') || 0.7);
            const clipWeight = Number.isFinite(configuredClipWeight) ? Math.max(0.1, Math.min(0.9, configuredClipWeight)) : 0.7;
            const visionWeight = 1 - clipWeight;

            const clipStart = Date.now();
            const visionStart = Date.now();
            const scoringLimit = pLimit(3);
            const scoreTargets = candidates.slice(0, 10);
            this.observability.emitLog('info', `Phase 3/6: CLIP+Vision scoring ${scoreTargets.length} candidates across ${sourceProviderLabel}`, 'SourcedImage', task.id);
            const scoredCandidates = await Promise.all(
                scoreTargets.map((c, idx) => scoringLimit(async () => {
                    let clipScore = this.disableClip ? 0.5 : 0;
                    let clipQ = clipScore;
                    let clipB = clipScore;
                    if (!this.disableClip) {
                        try {
                            const clip = await this.withTimeout(this.scoreClipCandidate(c.imageUrl, c.query, clipTarget), 12000, 'CLIP scoring timeout');
                            clipScore = clip.final;
                            clipQ = clip.query;
                            clipB = clip.brief;
                        } catch (error) {
                            this.observability.emitLog('warn', `CLIP scoring failed for candidate ${idx + 1}: ${error?.message || error}`, 'SourcedImage', task.id);
                            clipScore = 0;
                            clipQ = 0;
                            clipB = 0;
                        }
                    }
                    const visionBrief = this.buildVisionBrief(evaluationBrief, c.query);
                    const vision = this.disableVision
                        ? { score: 75, reason: 'Vision gate disabled by config.' }
                        : await this.visionGradeCandidate(c.imageUrl, visionBrief, task, primaryDomain);
                    const visionThreshold = this.disableVision ? 0 : this.resolveVisionThreshold(clipScore);
                    const clipPass = this.disableClip || clipScore >= clipThreshold;
                    const visionPass = this.disableVision || vision.score >= visionThreshold;
                    const weightedScore = ((clipScore * clipWeight) + ((vision.score / 100) * visionWeight));
                    const isMatch = clipPass && visionPass;
                    this.observability.emitLog(
                        'info',
                        `Candidate ${idx + 1}/${scoreTargets.length} | provider=${c.provider} query="${c.query}" clip=${clipScore.toFixed(3)} q_clip=${clipQ.toFixed(3)} b_clip=${clipB.toFixed(3)} vision=${vision.score} weighted=${weightedScore.toFixed(3)} match=${isMatch ? 'yes' : 'no'} url=${c.imageUrl}`,
                        'SourcedImage',
                        task.id,
                        undefined,
                        {
                            metadata: {
                                event_kind: 'iqc_candidate_scored',
                                task_id: task.id,
                                batch_id: (task as any)?.metadata?.batch_id || null,
                                candidate_index: idx + 1,
                                candidate_total: scoreTargets.length,
                                provider: c.provider,
                                query: c.query,
                                clip_score: Number(clipScore.toFixed(4)),
                                vision_score: Number(vision.score),
                                weighted_score: Number(weightedScore.toFixed(4)),
                                accepted: isMatch,
                                source: 'image-quality-control',
                            },
                        },
                    );
                    return {
                        ...c,
                        clipScore,
                        visionScore: vision.score,
                        visionReason: vision.reason,
                        weightedScore,
                        isMatch,
                    };
                }))
            );
            phaseMs.clip_scoring_ms = Date.now() - clipStart;
            phaseMs.vision_gate_ms = Date.now() - visionStart;

            const matched = scoredCandidates.filter((x) => x.isMatch);
            if (!matched.length) {
                const topWeighted = scoredCandidates.sort((a, b) => b.weightedScore - a.weightedScore)[0];
                this.observability.emitLog(
                    'warn',
                    `No sourced candidates passed combined thresholds (clip>=${clipThreshold.toFixed(2)}); top weighted=${topWeighted?.weightedScore?.toFixed(3) || 'n/a'}. Falling back to story generator`,
                    'SourcedImage',
                    task.id,
                    undefined,
                    {
                        metadata: {
                            event_kind: 'iqc_no_match_fallback',
                            task_id: task.id,
                            batch_id: (task as any)?.metadata?.batch_id || null,
                            clip_threshold: clipThreshold,
                            top_weighted_score: Number((topWeighted?.weightedScore || 0).toFixed(4)),
                            source: 'image-quality-control',
                        },
                    },
                );
                return this.fallbackToStory(task, {
                    clip_score: Number((topWeighted?.clipScore || 0).toFixed(4)),
                    vision_score: Number(topWeighted?.visionScore || 0),
                    weighted_score: Number((topWeighted?.weightedScore || 0).toFixed(4)),
                    clip_threshold: clipThreshold,
                    sourced_fallback_reason: 'no_combined_match',
                    validation_brief: evaluationBrief,
                }, {
                    brief,
                    queries: this.uniqueQueries([...pixabayQueries, ...unsplashQueries]).slice(0, 10),
                    candidates: sourcedCandidates,
                    queryConfig,
                });
            }

            const selected = matched.sort((a, b) => b.weightedScore - a.weightedScore)[0];
            if (matched.length > 1) {
                this.observability.emitLog(
                    'info',
                    `Multiple matched candidates (${matched.length}); selecting highest weighted score=${selected.weightedScore.toFixed(3)}`,
                    'SourcedImage',
                    task.id
                );
            }
            const best = { provider: selected.provider, imageUrl: selected.imageUrl, query: selected.query, clipScore: selected.clipScore };
            const visionGate = { score: selected.visionScore, reason: selected.visionReason };

            const started = Date.now();
            const imageBinary = await axios.get(best.imageUrl, { responseType: 'arraybuffer', timeout: 20000 });
            const relativeOutputDir = this.getRelativeOutputDir(task);
            await this.persistSourcedArtifacts(relativeOutputDir, {
                brief,
                queries,
                candidates: sourcedCandidates,
                queryConfig,
            }, task.id);
            const assetUrl = await this.localStorage.save(
                path.join(relativeOutputDir, 'assets', 'sourced_image.png'),
                Buffer.from(imageBinary.data)
            );

            const stampStart = Date.now();
            const frameHtml = this.stampingService.stamp('story_frame', { image_url: './assets/sourced_image.png' }, (task as any)?.metadata?.custom_theme);
            const taskBaseUrl = path.join(process.cwd(), 'public', 'generated-images', relativeOutputDir);
            const posterBuffer = await this.browserService.screenshotHtml(frameHtml, taskBaseUrl, {
                width: dims.width,
                height: dims.height,
                resizeMode: 'fill',
                scale: exportScale,
            });
            phaseMs.stamping_ms = Date.now() - stampStart;
            const publicUrl = await this.localStorage.save(path.join(relativeOutputDir, 'poster.png'), posterBuffer);
            await this.localStorage.save(path.join(relativeOutputDir, 'index.html'), Buffer.from(frameHtml));
            await this.localStorage.save(path.join(relativeOutputDir, 'blueprint.json'), Buffer.from(JSON.stringify({
                template_id: 'story_frame',
                source_type: 'sourced_image',
                image_url: assetUrl,
                image_size: `${dims.width}x${dims.height}`,
                export_scale: exportScale,
                clip_score: Number(best.clipScore.toFixed(4)),
                vision_score: visionGate.score,
                vision_reason: visionGate.reason,
                provider: best.provider,
                query: best.query,
                validation_brief: evaluationBrief,
                sourced_queries: queries,
                sourced_candidates: sourcedCandidates,
                sourced_query_signals: querySignals,
                sourced_query_config: queryConfig,
            }, null, 2)));

            const elapsedMs = Date.now() - started;
            this.observability.emitLog('success', `Phase 5/6 complete: sourced image selected (clip=${best.clipScore.toFixed(3)} vision=${visionGate.score})`, 'SourcedImage', task.id);
            this.observability.emitLog('info', `Phase 6/6 complete: persisted+stamped in ${elapsedMs}ms`, 'SourcedImage', task.id);

            return {
                url: publicUrl,
                posterUrl: publicUrl,
                payload: {
                    output_dir: relativeOutputDir,
                    metrics: {
                        total_ms: elapsedMs.toFixed(2),
                        clip_score: Number(best.clipScore.toFixed(4)),
                        clip_degraded_mode: false,
                        vision_score: visionGate.score,
                        weighted_score: Number(selected.weightedScore.toFixed(4)),
                        query_expansion_ms: phaseMs.query_expansion_ms.toFixed(2),
                        retrieval_ms: phaseMs.retrieval_ms.toFixed(2),
                        clip_scoring_ms: phaseMs.clip_scoring_ms.toFixed(2),
                        vision_gate_ms: phaseMs.vision_gate_ms.toFixed(2),
                        stamping_ms: phaseMs.stamping_ms.toFixed(2),
                        end_to_end_ms: (Date.now() - phaseStart).toFixed(2),
                    },
                    image_prompts: [brief],
                    blueprint_prompt: task.refined_prompt,
                    image_size: `${dims.width}x${dims.height}`,
                    export_scale: exportScale,
                    source_provider: best.provider,
                    source_query: best.query,
                    validation_brief: evaluationBrief,
                    sourced_queries: queries,
                    sourced_candidates: sourcedCandidates,
                    sourced_query_signals: querySignals,
                    sourced_query_config: queryConfig,
                    source_type: 'sourced_image',
                    quality_score: visionGate.score,
                },
            };
            })(), this.taskTimeoutMs, `Sourced image timeout after ${this.taskTimeoutMs}ms`);
        });
    }

    private async fetchCombinedCandidates(
        unsplashQueries: string[],
        pixabayQueries: string[],
        width: number,
        height: number,
        taskId?: string,
    ): Promise<Array<{ provider: string; imageUrl: string; query: string }>> {
        const providers = this.resolveSourceProviders();
        const unsplashPromise = providers.includes('unsplash')
            ? this.fetchUnsplashCandidates(unsplashQueries, taskId).catch((error) => {
                this.observability.emitLog('warn', `Unsplash fetch failed: ${error?.message || error}`, 'SourcedImage', taskId);
                return [];
            })
            : Promise.resolve([]);
        const pixabayPromise = providers.includes('pixabay')
            ? this.fetchPixabayCandidates(pixabayQueries, width, height, taskId).catch((error) => {
                this.observability.emitLog('warn', `Pixabay fetch failed: ${error?.message || error}`, 'SourcedImage', taskId);
                return [];
            })
            : Promise.resolve([]);
        const [u, p] = await Promise.all([unsplashPromise, pixabayPromise]);
        const unsplashTop = u.filter((x) => x.provider === 'unsplash').slice(0, 5);
        const pixabayTop = p.filter((x) => x.provider === 'pixabay').slice(0, 5);
        const combined = [...unsplashTop, ...pixabayTop].slice(0, 10);
        this.observability.emitLog(
            'info',
            `Parallel source fetch: unsplash=${unsplashTop.length} pixabay=${pixabayTop.length} total=${combined.length}`,
            'SourcedImage',
            taskId
        );
        return combined;
    }

    private async fetchUnsplashCandidates(
        queries: string[],
        taskId?: string,
    ): Promise<Array<{ provider: string; imageUrl: string; query: string }>> {
        const key = this.getUnsplashAccessKey();
        if (!key) {
            throw new Error('UNSPLASH_ACCESS_KEY is missing. Set it in .env to enable sourced_image retrieval.');
        }

        const orientation = 'landscape';
        const out: Array<{ provider: string; imageUrl: string; query: string }> = [];
        const seen = new Set<string>();
        const limitedQueries = queries.slice(0, 5);
        this.observability.emitLog('info', `Unsplash queries: ${limitedQueries.join(' | ')}`, 'SourcedImage', taskId);
        const searches = limitedQueries.map(async (q) => {
            try {
                const res = await this.withTimeout(
                    axios.get('https://api.unsplash.com/search/photos', {
                        timeout: 8000,
                        params: { query: q, orientation, per_page: 10, content_filter: 'high', order_by: 'relevant' },
                        headers: { Authorization: `Client-ID ${key}` },
                    }),
                    10000,
                    `Unsplash query timeout: ${q}`,
                );
                this.observability.emitLog('info', `Unsplash results (${q}): ${res?.data?.results?.length || 0}`, 'SourcedImage', taskId);
                return { q, results: res?.data?.results || [] };
            } catch (error) {
                this.observability.emitLog('warn', `Unsplash query failed (${q}): ${error?.message || error}`, 'SourcedImage', taskId);
                return { q, results: [] };
            }
        });

        const settled = await this.withTimeout(
            Promise.all(searches),
            15000,
            'Unsplash retrieval timeout',
        );

        for (const chunk of settled) {
            for (const item of chunk.results) {
                const url = item?.urls?.regular || item?.urls?.full;
                if (!url || seen.has(url)) continue;
                seen.add(url);
                out.push({ provider: 'unsplash', imageUrl: url, query: chunk.q });
            }
        }
        if (out.length > 0) return out.slice(0, 10);

        const broadQueries = this.buildBroadQueries(limitedQueries);
        if (!broadQueries.length) return [];
        this.observability.emitLog('warn', `No hits from primary queries. Retrying broad queries: ${broadQueries.join(' | ')}`, 'SourcedImage', taskId);

        const broadSearches = broadQueries.map(async (q) => {
            try {
                const res = await this.withTimeout(
                    axios.get('https://api.unsplash.com/search/photos', {
                        timeout: 8000,
                        params: { query: q, orientation: 'landscape', per_page: 10, content_filter: 'high', order_by: 'relevant' },
                        headers: { Authorization: `Client-ID ${key}` },
                    }),
                    10000,
                    `Unsplash broad query timeout: ${q}`,
                );
                this.observability.emitLog('info', `Unsplash broad results (${q}): ${res?.data?.results?.length || 0}`, 'SourcedImage', taskId);
                return { q, results: res?.data?.results || [] };
            } catch (error) {
                this.observability.emitLog('warn', `Unsplash broad query failed (${q}): ${error?.message || error}`, 'SourcedImage', taskId);
                return { q, results: [] };
            }
        });
        const broadSettled = await this.withTimeout(Promise.all(broadSearches), 15000, 'Unsplash broad retrieval timeout');
        for (const chunk of broadSettled) {
            for (const item of chunk.results) {
                const url = item?.urls?.regular || item?.urls?.full;
                if (!url || seen.has(url)) continue;
                seen.add(url);
                out.push({ provider: 'unsplash', imageUrl: url, query: chunk.q });
            }
        }
        return out.slice(0, 10);
    }

    private async fetchPixabayCandidates(
        queries: string[],
        width: number,
        height: number,
        taskId?: string,
    ): Promise<Array<{ provider: string; imageUrl: string; query: string }>> {
        const key = this.getPixabayAccessKey();
        if (!key) {
            throw new Error('PIXABAY_API_KEY is missing. Set it in .env to enable sourced_image retrieval via pixabay.');
        }

        const orientation = width >= height ? 'horizontal' : 'vertical';
        const category = this.inferPixabayCategory(queries.join(' '));
        const minDims = this.resolvePixabayMinDimensions(width, height);
        const out: Array<{ provider: string; imageUrl: string; query: string }> = [];
        const seen = new Set<string>();
        const limitedQueries = this.uniqueQueries(
            queries.map((q) => this.toPixabayQuery(q)).filter(Boolean),
        ).slice(0, 5);
        this.observability.emitLog(
            'info',
            `pixabay params: orientation=${orientation} per_page=10 order=popular lang=en image_type=photo safesearch=true category=${category || 'any'} min_width=${minDims.min_width} min_height=${minDims.min_height}`,
            'SourcedImage',
            taskId
        );
        this.observability.emitLog('info', `Pixabay queries: ${limitedQueries.join(' | ')}`, 'SourcedImage', taskId);
        const searches = limitedQueries.map(async (q) => {
            try {
                const res = await this.withTimeout(
                    axios.get('https://pixabay.com/api/', {
                        timeout: 8000,
                        params: {
                            key,
                            q,
                            image_type: 'photo',
                            orientation,
                            per_page: 10,
                            safesearch: 'true',
                            order: 'popular',
                            lang: 'en',
                            category: category || undefined,
                            min_width: minDims.min_width,
                            min_height: minDims.min_height,
                        },
                    }),
                    10000,
                    `Pixabay query timeout: ${q}`,
                );
                this.observability.emitLog('info', `Pixabay results (${q}): ${res?.data?.hits?.length || 0}`, 'SourcedImage', taskId);
                return { q, results: res?.data?.hits || [] };
            } catch (error) {
                this.observability.emitLog('warn', `Pixabay query failed (${q}): ${this.formatAxiosError(error)}`, 'SourcedImage', taskId);
                return { q, results: [] };
            }
        });

        const settled = await this.withTimeout(Promise.all(searches), 15000, 'Pixabay retrieval timeout');
        const perQuery = settled.map((chunk) => ({
            q: chunk.q,
            urls: (chunk.results || []).map((item: any) => item?.largeImageURL || item?.webformatURL).filter(Boolean),
        }));
        const maxCandidates = 10;
        for (let round = 0; out.length < maxCandidates; round++) {
            let addedThisRound = 0;
            for (const pq of perQuery) {
                const url = pq.urls[round];
                if (!url || seen.has(url)) continue;
                seen.add(url);
                out.push({ provider: 'pixabay', imageUrl: url, query: pq.q });
                addedThisRound++;
                if (out.length >= maxCandidates) break;
            }
            if (addedThisRound === 0) break;
        }
        if (out.length > 0) return out.slice(0, 10);

        const broadQueries = this.buildBroadQueries(limitedQueries);
        if (!broadQueries.length) return [];
        this.observability.emitLog('warn', `No hits from primary queries. Retrying broad queries: ${broadQueries.join(' | ')}`, 'SourcedImage', taskId);
        const broadSearches = broadQueries.map(async (q) => {
            try {
                const res = await this.withTimeout(
                    axios.get('https://pixabay.com/api/', {
                        timeout: 8000,
                        params: {
                            key,
                            q,
                            image_type: 'photo',
                            orientation,
                            per_page: 10,
                            safesearch: 'true',
                            order: 'popular',
                            lang: 'en',
                            category: category || undefined,
                            min_width: minDims.min_width,
                            min_height: minDims.min_height,
                        },
                    }),
                    10000,
                    `Pixabay broad query timeout: ${q}`,
                );
                this.observability.emitLog('info', `Pixabay broad results (${q}): ${res?.data?.hits?.length || 0}`, 'SourcedImage', taskId);
                return { q, results: res?.data?.hits || [] };
            } catch (error) {
                this.observability.emitLog('warn', `Pixabay broad query failed (${q}): ${this.formatAxiosError(error)}`, 'SourcedImage', taskId);
                return { q, results: [] };
            }
        });
        const broadSettled = await this.withTimeout(Promise.all(broadSearches), 15000, 'Pixabay broad retrieval timeout');
        const broadPerQuery = broadSettled.map((chunk) => ({
            q: chunk.q,
            urls: (chunk.results || []).map((item: any) => item?.largeImageURL || item?.webformatURL).filter(Boolean),
        }));
        for (let round = 0; out.length < maxCandidates; round++) {
            let addedThisRound = 0;
            for (const pq of broadPerQuery) {
                const url = pq.urls[round];
                if (!url || seen.has(url)) continue;
                seen.add(url);
                out.push({ provider: 'pixabay', imageUrl: url, query: pq.q });
                addedThisRound++;
                if (out.length >= maxCandidates) break;
            }
            if (addedThisRound === 0) break;
        }
        return out.slice(0, 10);
    }

    private resolveSourceProviders(): Array<'unsplash' | 'pixabay'> {
        const providers: Array<'unsplash' | 'pixabay'> = [];
        const unsplashKey = this.getUnsplashAccessKey();
        const pixabayKey = this.getPixabayAccessKey();
        if (unsplashKey) providers.push('unsplash');
        if (pixabayKey) providers.push('pixabay');
        return providers;
    }

    private resolvePrimaryDomain(task: ImageTask, brief: string): string {
        const haystack = this.normalizeQuery([
            String((task as any)?.metadata?.course_title || ''),
            String((task as any)?.metadata?.lesson_title || ''),
            brief,
        ].join(' '), 30);
        const map: Array<{ domain: string; terms: string[] }> = [
            { domain: 'fishing', terms: ['fishing', 'angler', 'bait', 'lure', 'tackle', 'lake', 'catch'] },
            { domain: 'computing', terms: ['computer', 'pc', 'motherboard', 'ram', 'cpu', 'rtl', 'verilog', 'chip'] },
            { domain: 'wellness', terms: ['stress', 'breathing', 'coping', 'resilience', 'mental', 'cbt', 'anxiety'] },
            { domain: 'business', terms: ['market', 'sales', 'revenue', 'customer', 'business', 'finance'] },
        ];
        for (const group of map) {
            if (group.terms.some((t) => haystack.includes(t))) return group.domain;
        }
        return this.pickDomainTerms(haystack.split(' ').filter(Boolean)).split(' ')[0] || 'general';
    }

    private buildTieredPixabayQueries(primaryDomain: string, plan: any, brief: string, baseQueries: string[]): string[][] {
        const collision = new Set(['tackle', 'cell', 'strike', 'lead']);
        const subjectSeed = this.toPixabayQuery(plan?.core_noun || plan?.subject || this.extractCoreNoun(plan, brief) || baseQueries[0] || brief);
        const subjectWords = subjectSeed.split(' ').filter(Boolean);
        const needsDomainPrefix = subjectWords.some((w) => collision.has(w));
        const subject = this.toPixabayQuery(`${needsDomainPrefix ? `${primaryDomain} ` : ''}${subjectSeed}`) || this.toPixabayQuery(`${primaryDomain} ${brief}`);
        const setting = this.toPixabayQuery(`${plan?.setting || ''} ${plan?.state || ''} ${this.pickSceneTerms(this.normalizeQuery(brief, 12).split(' '))}`);
        const literal = this.toPixabayQuery(`${(plan?.required_terms || []).slice(0, 3).join(' ')} ${this.normalizeQuery(brief, 3)}`);

        const tier1 = this.uniqueQueries([
            this.toPixabayQuery(`${primaryDomain} ${subject} ${setting}`),
            ...baseQueries.map((q) => this.toPixabayQuery(`${needsDomainPrefix ? `${primaryDomain} ` : ''}${q}`)),
        ]);
        const tier2 = this.uniqueQueries([
            this.toPixabayQuery(`${primaryDomain} ${subject}`),
            this.toPixabayQuery(`${primaryDomain} ${subjectWords.slice(0, 2).join(' ')}`),
        ]);
        const tier3 = this.uniqueQueries([
            this.toPixabayQuery(`${primaryDomain} ${subjectWords.slice(0, 2).join(' ')} ${literal}`),
            this.toPixabayQuery(`${primaryDomain} ${subject}`),
        ]);
        return [tier1, tier2, tier3].filter((tier) => tier.length > 0);
    }

    private async retryPixabayTiers(
        task: ImageTask,
        validationBrief: string,
        dims: { width: number; height: number },
        tiers: string[][],
        primaryDomain: string,
        queryConfig: Record<string, any>,
        clipThreshold: number,
    ): Promise<{
        best: { provider: string; imageUrl: string; query: string; clipScore: number };
        clipTopScore: number;
        queries: string[];
        candidates: Array<{ provider: string; imageUrl: string; query: string }>;
        tierLabel: string;
    } | null> {
        const clipTarget = this.normalizeClipText(validationBrief);
        for (let i = 0; i < tiers.length; i++) {
            const tierIndex = i + 2;
            const tierLabel = `tier-${tierIndex}`;
            const tierQueries = this.uniqueQueries(tiers[i]).slice(0, Number(queryConfig?.max_queries || 5));
            if (!tierQueries.length) continue;
            this.observability.emitLog('info', `Tier fallback ${tierLabel}: ${tierQueries.join(' | ')}`, 'SourcedImage', task.id);
            const tierCandidates = await this.fetchPixabayCandidates(tierQueries, dims.width, dims.height, task.id);
            if (!tierCandidates.length) continue;

            const scored: Array<{ provider: string; imageUrl: string; query: string; clipScore: number }> = [];
            const clipSampleCount = Math.min(tierCandidates.length, 5);
            for (let idx = 0; idx < clipSampleCount; idx++) {
                const c = tierCandidates[idx];
                try {
                    const clip = await this.withTimeout(this.scoreClipCandidate(c.imageUrl, c.query, clipTarget), 12000, 'CLIP scoring timeout');
                    const clipScore = clip.final;
                    scored.push({ ...c, clipScore });
                    this.observability.emitLog('info', `Tier ${tierLabel} CLIP ${idx + 1}/${tierCandidates.length} clip=${clipScore.toFixed(3)} q_clip=${clip.query.toFixed(3)} b_clip=${clip.brief.toFixed(3)} query="${c.query}"`, 'SourcedImage', task.id);
                } catch (error) {
                    this.observability.emitLog('warn', `Tier ${tierLabel} CLIP failed: ${error?.message || error}`, 'SourcedImage', task.id);
                }
            }
            if (!scored.length) continue;
            scored.sort((a, b) => b.clipScore - a.clipScore);
            const best = scored[0];
            if (best.clipScore < clipThreshold) {
                this.observability.emitLog('warn', `Tier ${tierLabel} rejected by CLIP (top=${best.clipScore.toFixed(3)} < ${clipThreshold.toFixed(3)})`, 'SourcedImage', task.id);
                continue;
            }
            const visionThreshold = this.resolveVisionThreshold(best.clipScore);
            const vision = await this.visionGradeCandidate(best.imageUrl, this.buildVisionBrief(validationBrief, best.query), task, primaryDomain);
            this.observability.emitLog('info', `Tier ${tierLabel} vision=${vision.score} threshold=${visionThreshold} clip=${best.clipScore.toFixed(3)}`, 'SourcedImage', task.id);
            if (!this.disableVision && vision.score < visionThreshold) continue;

            return {
                best,
                clipTopScore: best.clipScore,
                queries: tierQueries,
                candidates: tierCandidates,
                tierLabel,
            };
        }
        return null;
    }

    private normalizeClipText(input: string): string {
        const expanded = this.expandClipAliases(String(input || ''));
        return expanded
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private buildEvaluationBrief(brief: string, plan: any, queries: string[]): string {
        const core = this.normalizeQuery(String(this.extractCoreNoun(plan, brief) || plan?.subject || ''), 3);
        const required = Array.isArray(plan?.required_terms)
            ? this.normalizeQuery((plan.required_terms || []).slice(0, 3).join(' '), 6)
            : '';
        const setting = this.normalizeQuery(`${plan?.state || ''} ${plan?.setting || ''}`, 4);
        const compactQuery = this.normalizeQuery((queries || []).slice(0, 3).join(' '), 10);
        const dense = this.normalizeQuery(brief, 12);
        const domain = this.pickDomainTerms(this.normalizeQuery(brief, 10).split(' ').filter(Boolean));
        const scene = this.pickSceneTerms(this.normalizeQuery(brief, 10).split(' ').filter(Boolean));
        const rawCandidates = this.uniqueQueries([
            `${core} ${required} ${setting}`.trim(),
            `${core} ${compactQuery}`.trim(),
            `${core} ${required} ${scene}`.trim(),
            compactQuery,
            `${domain} ${scene}`.trim(),
            dense,
        ]);
        const candidates = rawCandidates.filter((c) => this.wordCount(c) >= 3);
        if (!candidates.length) {
            const fallback = rawCandidates[0] || dense || this.normalizeClipText(brief);
            return this.ensureEvaluationDensity(this.expandClipAliases(fallback), `${domain} ${scene}`);
        }
        const scored = candidates.map((c) => {
            const w = this.wordCount(c);
            let score = 0;
            if (w >= 4 && w <= 10) score += 3;
            if (core && c.includes(core)) score += 2;
            if (/(checking|holding|reading|install|release|setup|preparing|build)/.test(c)) score += 2;
            if (/(dock|shore|water|lake|sign|app|license|rules)/.test(c)) score += 1;
            return { c, score };
        }).sort((a, b) => b.score - a.score);
        return this.ensureEvaluationDensity(this.expandClipAliases(scored[0].c || dense || this.normalizeClipText(brief)), `${domain} ${scene}`);
    }

    private wordCount(text: string): number {
        return String(text || '').split(' ').filter(Boolean).length;
    }

    private expandClipAliases(text: string): string {
        let out = String(text || '').toLowerCase();
        const aliases: Array<[RegExp, string]> = [
            [/\bangler\b/g, 'fisherman'],
            [/\bregulations?\b/g, 'rules'],
            [/\blicense\b/g, 'permit license'],
            [/\bsmartphone\b/g, 'phone'],
        ];
        for (const [pattern, replacement] of aliases) {
            out = out.replace(pattern, replacement);
        }
        const words = out.replace(/[^a-z0-9\s]/g, ' ').split(' ').filter(Boolean);
        const dedup: string[] = [];
        for (const w of words) {
            if (!dedup.includes(w)) dedup.push(w);
        }
        return dedup.join(' ').trim();
    }

    private resolveVisionThreshold(clipScore: number): number {
        if (!Number.isFinite(clipScore)) return 75;
        if (clipScore > 0.9) return 40;
        if (clipScore < 0.7) return 75;
        return 60;
    }

    private extractCoreNoun(plan: any, brief: string): string {
        const fromPlan = String(plan?.core_noun || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        const genericRole = new Set(['angler', 'fisherman', 'person', 'man', 'woman', 'people']);
        if (fromPlan && !genericRole.has(fromPlan.split(' ')[0])) return fromPlan.split(' ').slice(0, 2).join(' ');
        if (fromPlan && genericRole.has(fromPlan.split(' ')[0])) {
            const concrete = this.normalizeQuery(brief, 8).split(' ').find((w) =>
                ['fish', 'tackle', 'lure', 'bait', 'dock', 'shore', 'rules', 'license', 'release', 'water'].includes(w)
            );
            if (concrete) return concrete;
        }
        const fallback = this.normalizeQuery(brief, 2);
        return fallback || '';
    }

    private getUnsplashAccessKey(): string {
        const candidates = [
            this.configService.get<string>('UNSPLASH_ACCESS_KEY'),
            this.configService.get<string>('UNSPLASH_KEY'),
            this.configService.get<string>('UPLASH_ACCESS_KEY'),
            this.configService.get<string>('UPLASH_KEY'),
        ];
        const key = candidates.map(v => String(v || '').trim()).find(Boolean);
        return key || '';
    }

    private getPixabayAccessKey(): string {
        const candidates = [
            this.configService.get<string>('PIXABAY_API_KEY'),
            this.configService.get<string>('PIXABAY_KEY'),
        ];
        const key = candidates.map(v => String(v || '').trim()).find(Boolean);
        return key || '';
    }

    private expandQueriesHeuristic(brief: string): string[] {
        const seed = this.normalizeQuery(brief, 9);
        const baseWords = seed.split(' ').filter(Boolean);
        const domain = this.pickDomainTerms(baseWords);
        const scene = this.pickSceneTerms(baseWords);
        const queries = [
            seed,
            `${domain} ${scene}`.trim(),
            `${domain} outdoor morning`,
            `${domain} preparation`,
            `${domain} lake shore`,
        ];
        return this.uniqueQueries(queries);
    }

    private normalizeQuery(input: string, maxWords = 10): string {
        const stop = new Set([
            'realistic', 'photo', 'style', 'cinematic', 'natural', 'colors', 'shallow', 'depth',
            'field', 'logos', 'logo', 'text', 'overlay', 'watermark', 'branding', 'brand',
            'no', 'with', 'and', 'the', 'for', 'from', 'that', 'this', 'into', 'near',
            'optional', 'beside', 'small', 'one', 'scene', 'high', 'quality', 'curated',
            'minimalist', 'non', 'corporate', 'professional', 'photography', 'soft', 'shadows'
        ]);
        const words = String(input || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ')
            .filter((w) => w.length > 2 && !stop.has(w));
        const dedup: string[] = [];
        for (const w of words) {
            if (!dedup.includes(w)) dedup.push(w);
            if (dedup.length >= maxWords) break;
        }
        return dedup.join(' ').trim();
    }

    private optimizePixabayQueries(baseQueries: string[], brief: string): string[] {
        const compactFromExpanded = baseQueries
            .map((q) => this.toPixabayQuery(q))
            .filter(Boolean);
        const seed = this.normalizeQuery(brief, 6);
        const seedTokens = seed.split(' ').filter(Boolean);
        const anchor = this.pickConcreteAnchor(seedTokens, compactFromExpanded.join(' '));
        const noun = anchor || this.pickDomainTerms(seedTokens).split(' ').slice(0, 2).join(' ').trim();
        const anchoredExpanded = compactFromExpanded.map((q) => this.ensureDomainAnchor(q, anchor || noun || seedTokens[0] || ''));
        const tag = this.pickSceneTerms(seedTokens).split(' ').slice(0, 1).join(' ').trim();
        const variants = [
            `${anchor || noun} ${tag}`.trim(),
            `${anchor || noun}`.trim(),
            seed.split(' ').slice(0, 3).join(' ').trim(),
            `${anchor || ''} ${seed.split(' ').slice(0, 2).join(' ')}`.trim(),
        ].map((q) => this.toPixabayQuery(q));
        return this.uniqueQueries([...anchoredExpanded, ...variants]).slice(0, 5);
    }

    private pickConcreteAnchor(seedTokens: string[], existing = ''): string {
        const priority = [
            'tackle', 'box', 'lure', 'lures', 'bait', 'fish', 'release', 'rules', 'regulations',
            'sign', 'license', 'permit', 'tournament', 'weigh', 'stage', 'dock', 'shore', 'rod', 'reel'
        ];
        const hay = new Set([...seedTokens, ...this.normalizeQuery(existing, 12).split(' ')].filter(Boolean));
        for (const token of priority) {
            if (hay.has(token)) {
                if (token === 'box' && hay.has('tackle')) return 'tackle box';
                if (token === 'sign' && (hay.has('rules') || hay.has('regulations'))) return 'rules sign';
                if (token === 'fish' && hay.has('release')) return 'fish release';
                return token;
            }
        }
        return '';
    }

    private ensureDomainAnchor(query: string, anchor: string): string {
        const q = this.toPixabayQuery(query);
        const a = this.toPixabayQuery(anchor);
        if (!q || !a) return q;
        const parts = q.split(' ').filter(Boolean);
        if (parts.includes(a)) return q;
        return this.toPixabayQuery(`${a} ${q}`);
    }

    private toPixabayQuery(input: string): string {
        const noise = new Set([
            'high', 'quality', 'curated', 'minimalist', 'non', 'corporate', 'professional', 'photography',
            'editorial', 'premium', 'soft', 'shadows', 'composition'
        ]);
        const trimmed = this.normalizeQuery(input, 10)
            .split(' ')
            .filter((w) => !noise.has(w))
            .slice(0, 7)
            .join(' ');
        const base = trimmed
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return base.length > 90 ? base.slice(0, 90).trim() : base;
    }

    private inferPixabayCategory(input: string): string | undefined {
        const t = this.normalizeQuery(input, 20).split(' ');
        if (t.some((w) => ['fishing', 'angler', 'tackle', 'bait', 'lure', 'boat'].includes(w))) return undefined;
        if (t.some((w) => ['forest', 'lake', 'river', 'mountain', 'outdoor', 'nature'].includes(w))) return 'nature';
        if (t.some((w) => ['person', 'people', 'man', 'woman', 'child', 'family'].includes(w))) return 'people';
        if (t.some((w) => ['computer', 'chip', 'hardware', 'electronics', 'memory', 'ddr'].includes(w))) return 'science';
        return undefined;
    }

    private ensureEvaluationDensity(text: string, hint = ''): string {
        const base = this.normalizeClipText(text);
        const hintWords = this.normalizeClipText(hint).split(' ').filter(Boolean);
        const words = base.split(' ').filter(Boolean);
        for (const w of hintWords) {
            if (!words.includes(w)) words.push(w);
            if (words.length >= 9) break;
        }
        if (words.length < 4) {
            for (const w of ['fishing', 'photo', 'outdoors']) {
                if (!words.includes(w)) words.push(w);
                if (words.length >= 4) break;
            }
        }
        return this.expandClipAliases(words.slice(0, 9).join(' '));
    }

    private buildVisionBrief(validationBrief: string, selectedQuery: string): string {
        const merged = this.normalizeClipText(`${selectedQuery || ''} ${validationBrief || ''}`);
        return this.ensureEvaluationDensity(merged, selectedQuery || '');
    }

    private async scoreClipCandidate(imageUrl: string, selectedQuery: string, clipTarget: string): Promise<{ final: number; query: number; brief: number }> {
        const queryTarget = this.normalizeClipText(selectedQuery || clipTarget);
        const [queryScore, briefScore] = await Promise.all([
            this.clipService.scoreImageAgainstBrief(imageUrl, queryTarget),
            this.clipService.scoreImageAgainstBrief(imageUrl, clipTarget),
        ]);
        const qWeightRaw = Number(this.configService.get<string>('SOURCED_IMAGE_CLIP_QUERY_WEIGHT') || '0.65');
        const qWeight = Number.isFinite(qWeightRaw) ? Math.max(0.2, Math.min(0.9, qWeightRaw)) : 0.65;
        const bWeight = 1 - qWeight;
        const final = (queryScore * qWeight) + (briefScore * bWeight);
        return { final, query: queryScore, brief: briefScore };
    }

    private resolvePixabayMinDimensions(width: number, height: number): { min_width: number; min_height: number } {
        const targetW = Math.max(640, Math.min(1600, Math.round(width * 0.65)));
        const targetH = Math.max(400, Math.min(1200, Math.round(height * 0.65)));
        return { min_width: targetW, min_height: targetH };
    }

    private formatAxiosError(error: any): string {
        const status = error?.response?.status;
        const data = error?.response?.data;
        const message = error?.message || String(error);
        if (!status) return message;
        const detail = typeof data === 'string' ? data : JSON.stringify(data || {});
        return `status=${status} message=${message} body=${detail.slice(0, 300)}`;
    }

    private uniqueQueries(queries: string[]): string[] {
        const out: string[] = [];
        for (const q of queries) {
            const normalized = String(q || '').replace(/\s+/g, ' ').trim();
            if (!normalized) continue;
            if (!out.includes(normalized)) out.push(normalized);
            if (out.length >= 5) break;
        }
        return out;
    }

    private pickDomainTerms(words: string[]): string {
        const preferred = ['fishing', 'angler', 'tackle', 'lure', 'bait', 'lake', 'shore'];
        const found = preferred.filter((k) => words.includes(k));
        if (found.length) return found.slice(0, 3).join(' ');
        return words.slice(0, 3).join(' ');
    }

    private pickSceneTerms(words: string[]): string {
        const preferred = ['dawn', 'morning', 'sunrise', 'preparing', 'setup', 'water', 'dock', 'river', 'outdoor'];
        const found = preferred.filter((k) => words.includes(k));
        if (found.length) return found.slice(0, 3).join(' ');
        return words.slice(3, 6).join(' ');
    }

    private buildBroadQueries(primaryQueries: string[]): string[] {
        const tokens = this.uniqueQueries(primaryQueries.map((q) => this.normalizeQuery(q, 8)))
            .join(' ')
            .split(' ')
            .filter(Boolean);
        const hasFishing = tokens.includes('fishing') || tokens.includes('angler');
        const broad = [
            hasFishing ? 'angler by lake' : '',
            hasFishing ? 'fishing tackle outdoors' : '',
            hasFishing ? 'fishing setup dawn' : '',
            tokens.slice(0, 2).join(' '),
        ];
        return this.uniqueQueries(broad);
    }

    private async visionGradeCandidate(imageUrl: string, brief: string, task: ImageTask, primaryDomain = ''): Promise<{ score: number; reason: string }> {
        const style = String(
            (task as any)?.metadata?.sourced_style_suffix
            || (task as any)?.metadata?.custom_theme?.image_style_suffix
            || ''
        ).trim();
        return this.clipService.visionScoreImage(
            imageUrl,
            brief,
            primaryDomain,
            style,
            { score: 75, reason: 'Vision gate unavailable; accepted by CLIP threshold only.' },
        );
    }

    private async fallbackToStory(
        task: ImageTask,
        sourcedDiagnostics?: Record<string, any>,
        sourcedArtifacts?: {
            brief: string;
            queries: string[];
            candidates: Array<{ provider?: string; query: string; image_url: string }>;
            queryConfig?: Record<string, any>;
        }
    ): Promise<ImageGenerationResult> {
        const fallbackTask: any = {
            ...task,
            type: 'story_image',
            metadata: {
                ...((task as any).metadata || {}),
                sourced_fallback: true,
            }
        };
        const storyResult = await this.storyImageStrategy.generate(fallbackTask);
        if (sourcedArtifacts && storyResult?.payload?.output_dir) {
            await this.persistSourcedArtifacts(String(storyResult.payload.output_dir), sourcedArtifacts, task.id);
        }
        const mergedMetrics = {
            ...(storyResult?.payload?.metrics || {}),
            ...(sourcedDiagnostics || {}),
            sourced_fallback: true,
        };
        return {
            ...storyResult,
            payload: {
                ...(storyResult?.payload || {}),
                source_type: 'sourced_image_fallback_story',
                metrics: mergedMetrics,
            },
        };
    }

    private async persistSourcedArtifacts(
        relativeOutputDir: string,
        data: {
            brief: string;
            queries: string[];
            candidates: Array<{ provider?: string; query: string; image_url: string }>;
            queryConfig?: Record<string, any>;
        },
        taskId?: string,
    ): Promise<void> {
        try {
            const safeRelativeOutputDir = sanitizeRelativePath(relativeOutputDir, 'output dir');
            const assetsDir = resolveWithinGeneratedImages(path.join(safeRelativeOutputDir, 'assets'));
            await fs.promises.mkdir(assetsDir, { recursive: true });

            const queryConfig = data.queryConfig || {};
            const lines = [
                `brief: ${data.brief}`,
                `queries (${data.queries.length}):`,
                ...data.queries.map((q, i) => `  ${i + 1}. ${q}`),
                `query_config: orientation=${queryConfig.orientation || 'n/a'} per_page=${queryConfig.per_page || 'n/a'} content_filter=${queryConfig.content_filter || 'n/a'} order_by=${queryConfig.order_by || 'n/a'}`,
                `candidates (${data.candidates.length}):`,
                ...data.candidates.map((c, i) => `  ${i + 1}. provider="${c.provider || 'unknown'}" query="${c.query}" url="${c.image_url}"`),
            ];
            const txt = lines.join('\n');
            await this.localStorage.save(path.join(safeRelativeOutputDir, 'assets', 'sourced-search-log.txt'), Buffer.from(txt, 'utf8'));
            await this.localStorage.save(path.join(safeRelativeOutputDir, 'assets', 'sourced-search-log.json'), Buffer.from(JSON.stringify(data, null, 2), 'utf8'));

            const top = data.candidates.slice(0, 10);
            await Promise.all(top.map(async (c, idx) => {
                try {
                    const res = await this.withTimeout(
                        axios.get(c.image_url, { responseType: 'arraybuffer', timeout: 10000 }),
                        12000,
                        `candidate download timeout ${idx + 1}`,
                    );
                    await this.localStorage.save(
                        path.join(safeRelativeOutputDir, 'assets', `sourced-candidate-${String(idx + 1).padStart(2, '0')}.jpg`),
                        Buffer.from(res.data),
                    );
                } catch (error) {
                    this.observability.emitLog('warn', `Failed saving sourced candidate ${idx + 1}: ${error?.message || error}`, 'SourcedImage', taskId);
                }
            }));
            this.observability.emitLog('info', `Saved sourced artifacts in ./assets (queries + ${top.length} candidate images)`, 'SourcedImage', taskId);
        } catch (error) {
            this.observability.emitLog('warn', `Failed persisting sourced artifacts: ${error?.message || error}`, 'SourcedImage', taskId);
        }
    }

    private resolveDimensions(task: ImageTask): { width: number; height: number } {
        const payload = (task as any)?.payload || {};
        const metadataDims = (task as any)?.metadata?.dimensions || {};
        const payloadDims = payload?.dimensions || {};
        const source = { ...payloadDims, ...metadataDims };
        const width = Number(source?.width) || 1400;
        const height = Number(source?.height) || 900;
        return { width: Math.max(256, Math.round(width)), height: Math.max(256, Math.round(height)) };
    }

    private resolveExportScale(imageSpecs: any): number {
        const rawScale = Number(imageSpecs?.rendering?.export?.scale || 1);
        if (!Number.isFinite(rawScale) || rawScale <= 0) return 1;
        return Math.max(1, Math.round(rawScale));
    }

    private getRelativeOutputDir(task: ImageTask): string {
        const dateStr = new Date().toISOString().split('T')[0];
        const meta = (task as any).metadata || {};
        const courseId = meta.course_id || 'uncategorized_course';
        const lessonId = meta.lesson_id || 'uncategorized_lesson';
        return path.join(dateStr, courseId, lessonId, 'sourced', task.id);
    }

    private async renderDirectSource(
        task: ImageTask,
        sourceUrl: string,
        width: number,
        height: number,
        exportScale: number,
        phaseStart: number,
    ): Promise<ImageGenerationResult> {
        this.observability.emitLog('info', 'Direct source mode: bypassing search and semantic gates', 'SourcedImage', task.id);
        try {
            const started = Date.now();
            const imageBinary = await this.downloadSourceImage(sourceUrl);
            const relativeOutputDir = this.getRelativeOutputDir(task);
            const assetUrl = await this.localStorage.save(
                path.join(relativeOutputDir, 'assets', 'sourced_image.png'),
                Buffer.from(imageBinary)
            );
            const frameHtml = this.stampingService.stamp('story_frame', { image_url: './assets/sourced_image.png' }, (task as any)?.metadata?.custom_theme);
            const taskBaseUrl = path.join(process.cwd(), 'public', 'generated-images', relativeOutputDir);
            const posterBuffer = await this.browserService.screenshotHtml(frameHtml, taskBaseUrl, {
                width,
                height,
                resizeMode: 'fill',
                scale: exportScale,
            });
            const publicUrl = await this.localStorage.save(path.join(relativeOutputDir, 'poster.png'), posterBuffer);
            await this.localStorage.save(path.join(relativeOutputDir, 'index.html'), Buffer.from(frameHtml));
            await this.localStorage.save(path.join(relativeOutputDir, 'blueprint.json'), Buffer.from(JSON.stringify({
                template_id: 'story_frame',
                source_type: 'sourced_image',
                mode: 'manifest_direct',
                image_url: assetUrl,
                image_size: `${width}x${height}`,
                export_scale: exportScale,
                provider: 'manifest',
                query: 'provided-source',
            }, null, 2)));

            const elapsedMs = Date.now() - started;
            this.observability.emitLog('success', `Direct sourced image rendered in ${elapsedMs}ms`, 'SourcedImage', task.id);
            return {
                url: publicUrl,
                posterUrl: publicUrl,
                payload: {
                    output_dir: relativeOutputDir,
                    metrics: {
                        total_ms: elapsedMs.toFixed(2),
                        end_to_end_ms: (Date.now() - phaseStart).toFixed(2),
                        mode: 'manifest_direct',
                    },
                    image_prompts: [String((task as any)?.payload?.imageSpecs?.brief || '').trim()],
                    blueprint_prompt: task.refined_prompt,
                    image_size: `${width}x${height}`,
                    export_scale: exportScale,
                    source_provider: 'manifest',
                    source_query: 'provided-source',
                    source_type: 'sourced_image',
                    quality_score: 90,
                },
            };
        } catch (error) {
            this.observability.emitLog('warn', `Direct source fetch failed (${error?.message || error}); falling back to story generation`, 'SourcedImage', task.id);
            return this.fallbackToStory(task);
        }
    }

    private async downloadSourceImage(sourceUrl: string): Promise<Buffer> {
        const headersBase = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        };
        try {
            const res = await axios.get(sourceUrl, {
                responseType: 'arraybuffer',
                timeout: 15000,
                headers: headersBase,
            });
            return Buffer.from(res.data);
        } catch (firstError: any) {
            const status = firstError?.response?.status;
            if (status !== 403) throw firstError;
            const res = await axios.get(sourceUrl, {
                responseType: 'arraybuffer',
                timeout: 15000,
                headers: {
                    ...headersBase,
                    'Referer': 'https://commons.wikimedia.org/',
                    'Origin': 'https://commons.wikimedia.org',
                },
            });
            return Buffer.from(res.data);
        }
    }

    private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
        let timer: NodeJS.Timeout | null = null;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(label)), ms);
        });
        try {
            return await Promise.race([promise, timeout]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }
}
