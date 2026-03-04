import { Injectable, Logger } from '@nestjs/common';
import { ImageRouterService } from './image-router.service';
import { ImageStrategyFactory } from './image-strategy.factory';
import * as pLimit from 'p-limit';
import { performance } from 'perf_hooks';
import { ObservabilityGateway } from '../observability/observability.gateway';
import { buildCustomThemeForPayload, resolveStyleSelection } from './style-registry.config';
import { PostgresStorageService } from '../storage/postgres-storage.service';

@Injectable()
export class ImageOrchestratorService {
    private readonly logger = new Logger(ImageOrchestratorService.name);
    private readonly manifestTaskConcurrency: number;
    private readonly manifestTaskTimeoutMs: number;
    private readonly durableQueueEnabled: boolean;

    constructor(
        private readonly imageRouter: ImageRouterService,
        private readonly strategyFactory: ImageStrategyFactory,
        private readonly observability: ObservabilityGateway,
        private readonly storage: PostgresStorageService,
    ) {
        const configuredConcurrency = Number(process.env.MANIFEST_TASK_CONCURRENCY || 8);
        this.manifestTaskConcurrency = Number.isFinite(configuredConcurrency) && configuredConcurrency > 0
            ? configuredConcurrency
            : 8;
        const configuredTimeout = Number(process.env.MANIFEST_TASK_TIMEOUT_MS || 120000);
        this.manifestTaskTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
            ? configuredTimeout
            : 120000;
        this.durableQueueEnabled = String(process.env.DURABLE_QUEUE_ENABLED || 'true').toLowerCase() === 'true';
    }

    private stopSignal = false;

    stopBatch() {
        this.stopSignal = true;
        this.logger.log('Stop signal received. Halting new task execution.');
        this.observability.emitLog('warn', 'Batch Stop Requested. Halting new tasks...', 'Orchestrator');
    }

    private toGoogleFontUrl(fontName: string): string {
        const clean = String(fontName || '').trim();
        if (!clean) return 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap';
        const family = clean.replace(/\s+/g, '+');
        return `https://fonts.googleapis.com/css2?family=${family}:wght@400;700;800;900&display=swap`;
    }

    private parsePtRangeToCss(value: string | undefined, fallback: string): string {
        const raw = String(value || '').toLowerCase();
        const nums = raw.match(/(\d+(\.\d+)?)/g)?.map(Number).filter(n => Number.isFinite(n)) || [];
        if (!nums.length) return fallback;
        const avgPt = nums.reduce((a, b) => a + b, 0) / nums.length;
        const px = avgPt * (96 / 72); // 1pt = 1.333px
        return `${Math.round(px)}px`;
    }

    private resolveManifestTaskType(viz: any): 'story_image' | 'sourced_image' | 'data_viz' | 'infographic' {
        const rawType = String(viz?.type || '').toLowerCase();
        if (rawType === 'sourced_image' || String(viz?.imageSpecs?.rendering?.generation?.source || '').toLowerCase() === 'sourced') {
            return 'sourced_image';
        }
        if (rawType === 'story_image' || !!viz?.imageSpecs) {
            return 'story_image';
        }

        const explicitDataVizTypes = new Set([
            'data_viz',
            'chart',
            'bar',
            'line',
            'pie',
            'funnel',
            'bar_chart',
            'line_chart',
            'pie_chart',
            'funnel_chart',
        ]);
        if (explicitDataVizTypes.has(rawType)) {
            return 'data_viz';
        }

        const hasExplicitChartPayload = typeof viz?.chartType === 'string' && !!viz?.data;
        const hasLabelValueData = Array.isArray(viz?.data?.labels) && Array.isArray(viz?.data?.values);
        if (hasExplicitChartPayload || hasLabelValueData) {
            return 'data_viz';
        }

        return 'infographic';
    }

    private normalizeChartType(viz: any): 'bar' | 'line' | 'pie' | 'funnel' {
        const raw = String(viz?.chartType || viz?.type || '').toLowerCase();
        if (raw.includes('line')) return 'line';
        if (raw.includes('pie') || raw.includes('donut')) return 'pie';
        if (raw.includes('funnel')) return 'funnel';
        return 'bar';
    }

    private buildManifestPayloadForTask(viz: any, taskType: 'story_image' | 'sourced_image' | 'data_viz' | 'infographic'): any {
        const { visualizationId, ...vizContent } = viz;

        if (taskType !== 'data_viz') {
            return vizContent;
        }

        const chartType = this.normalizeChartType(viz);
        const format = String(viz?.format || viz?.exportType || 'static').toLowerCase() === 'animated'
            ? 'animated'
            : 'static';

        const rawData = viz?.data;
        const data = rawData && typeof rawData === 'object'
            ? rawData
            : {
                labels: Array.isArray(viz?.labels) ? viz.labels : [],
                values: Array.isArray(viz?.values) ? viz.values : []
            };

        return {
            chartType,
            data,
            format,
            title: viz?.title,
        };
    }

    private buildVisualizationContext(viz: any): string {
        const parts: string[] = [];
        const context = String(viz?.context || '').trim();
        const purpose = String(viz?.purpose || '').trim();
        const description = String(viz?.content_description || '').trim();
        const reasoning = String(viz?.reasoning || '').trim();
        const sectionTitle = String(viz?.section_title || '').trim();
        const concepts = Array.isArray(viz?.supports_concepts) ? viz.supports_concepts.filter(Boolean).map((c: any) => String(c).trim()) : [];

        if (context) parts.push(context);
        if (purpose) parts.push(`Purpose: ${purpose}`);
        if (description) parts.push(`Content: ${description}`);
        if (reasoning) parts.push(`Reasoning: ${reasoning}`);
        if (sectionTitle) parts.push(`Section: ${sectionTitle}`);
        if (concepts.length) parts.push(`Supports concepts: ${concepts.join(', ')}`);

        if (viz?.structure && typeof viz.structure === 'object') {
            try {
                const serialized = JSON.stringify(viz.structure);
                if (serialized.length) {
                    const clipped = serialized.length > 800 ? `${serialized.slice(0, 800)}...` : serialized;
                    parts.push(`Structure: ${clipped}`);
                }
            } catch {
                // ignore non-serializable structure
            }
        }

        return parts.join(' | ').trim();
    }

    private inferStepCount(viz: any): number {
        if (Array.isArray(viz?.items)) return viz.items.length;
        if (Array.isArray(viz?.steps)) return viz.steps.length;
        const structure = viz?.structure || {};
        const decisionNodes = Array.isArray(structure?.decisionNodes) ? structure.decisionNodes.length : 0;
        const outputs = structure?.outputs && typeof structure.outputs === 'object' ? Object.keys(structure.outputs).length : 0;
        const timeline = Array.isArray(structure?.timeline) ? structure.timeline.length : 0;
        const processSteps = Array.isArray(structure?.processSteps) ? structure.processSteps.length : 0;
        const branches = Array.isArray(structure?.branches) ? structure.branches.length : 0;
        const hasTopSection = structure?.topSection ? 1 : 0;
        const hasConvergence = structure?.convergenceNote ? 1 : 0;
        const hasFooter = structure?.footerNote ? 1 : 0;
        const branchFlowEstimate = hasTopSection + branches + hasConvergence + hasFooter;
        const decisionFlowEstimate = decisionNodes + outputs + (decisionNodes > 0 ? 1 : 0) + hasFooter;
        return Math.max(decisionFlowEstimate, timeline, processSteps, branchFlowEstimate);
    }

    private resolveTemplateTypeForRouting(viz: any): string {
        const rawType = String(viz?.type || '').toLowerCase().trim();
        // Hard rule: if the original payload explicitly calls this a flowchart, keep it a flowchart.
        if (rawType.includes('flowchart')) return 'flowchart';

        const pathLikeTypes = new Set([
            'process_flow',
            'timeline',
            'process_map',
            'step_journey',
            'step_list',
            'steps',
            'pathway',
            'path',
            'line_process',
            'process_line'
        ]);
        const structure = viz?.structure || {};
        const hasPathLikeStructure =
            Array.isArray(structure?.branches) && structure.branches.length > 0
            || Array.isArray(structure?.processSteps) && structure.processSteps.length > 0
            || Array.isArray(structure?.timeline) && structure.timeline.length > 0
            || Array.isArray(structure?.decisionNodes) && structure.decisionNodes.length > 0
            || (structure?.outputs && typeof structure.outputs === 'object' && Object.keys(structure.outputs).length > 0);

        if (!pathLikeTypes.has(rawType) && !hasPathLikeStructure) return rawType;

        const stepCount = this.inferStepCount(viz);
        if (stepCount > 5) return 'flowchart';
        if (stepCount >= 2) return 'steps';
        return rawType;
    }

    async generateCourse(content: string) {
        const start = performance.now();
        this.logger.log(`Starting course generation for content length: ${content.length}`);
        this.observability.emitLog('info', `Starting course generation`, 'Orchestrator');

        // 1. Classification
        const tasks = await this.imageRouter.classify(content);
        this.logger.log(`Classified ${tasks.length} tasks.`);

        // 2. Parallel Execution with Limit
        const limit = pLimit(15);

        const promises = tasks.map((task, index) => {
            return limit(async () => {
                try {
                    const strategy = this.strategyFactory.getStrategy(task);
                    const result = await strategy.generate(task, index + 1);
                    return {
                        status: 'fulfilled',
                        value: {
                            taskId: task.id,
                            type: task.type,
                            refined_prompt: task.refined_prompt,
                            url: result.url,
                            posterUrl: result.posterUrl,
                            payload: result.payload
                        }
                    };
                } catch (error) {
                    this.logger.error(`Task ${task.id} failed: ${error.message}`);
                    return { status: 'rejected', reason: error.message, taskId: task.id };
                }
            });
        });

        // 3. Resilience
        const results = await Promise.all(promises);

        const end = performance.now();
        const duration = ((end - start) / 1000).toFixed(2);
        const successCount = results.filter((r) => r.status === 'fulfilled').length;

        this.logger.log(`Generated ${successCount}/${tasks.length} images in ${duration} seconds.`);

        return {
            metadata: {
                total: tasks.length,
                success: successCount,
                durationSeconds: parseFloat(duration)
            },
            results: results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason, taskId: r.taskId })
        };
    }

    async generateFromManifest(manifest: any, authContext?: { userId?: number }) {
        this.stopSignal = false; // Reset signal
        const start = performance.now();
        const batchStartedAt = new Date();
        const batchId = `batch-${batchStartedAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
        const courseTitle = manifest.course?.title || 'Untitled Course';
        this.logger.log(`Starting Batch Generation from Hierarchical Manifest: ${courseTitle}`);
        this.observability.emitLog('info', `Starting Batch Generation: ${courseTitle}`, 'Orchestrator', undefined, batchId);
        this.observability.emitBatchProgress({ total: 0, completed: 0, current: 'Initializing...', batchId });

        const globalStyle = manifest.course?.globalStyleGuide || {};
        const designPhilosophy = manifest.course?.designPhilosophy || 'Professional';
        const defaultStyle = resolveStyleSelection(manifest, {});
        const coursePaletteHexes = Object.values(globalStyle.colorPalette || {})
            .map(v => String(v).trim())
            .filter(v => /^#[0-9a-f]{3,8}$/i.test(v));
        this.observability.emitLog(
            'info',
            `Style profile selected: ${defaultStyle.profile.id} (infographic=${defaultStyle.infographicThemeId}, chart=${defaultStyle.chartThemeId})`,
            'Orchestrator',
            undefined,
            batchId
        );

        // 1. Parse Manifest into Tasks
        const tasks: any[] = [];
        const courseSlug = courseTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

        // Support both root-level lessons and course.lessons, just in case
        const lessons = manifest.lessons || manifest.course?.lessons || [];

        lessons.forEach((lesson: any, lessonIdx: number) => {
            const visualItems = lesson.visualizations || lesson.items || [];
            visualItems.forEach((viz: any) => {
                const vizDescription = viz.description || viz.title || 'a visual representation';
                const vizContext = this.buildVisualizationContext(viz);
                const refinedPrompt = vizContext
                    ? `Create a ${viz.type} for the lesson "${lesson.title}": ${vizDescription}. Context: ${vizContext}`
                    : `Create a ${viz.type} for the lesson "${lesson.title}": ${vizDescription}.`;

                const styleSelection = resolveStyleSelection(manifest, viz);
                const styleProfile = styleSelection.profile;
                const themeId = styleSelection.infographicThemeId;
                const chartThemeId = styleSelection.chartThemeId;

                const primaryFont = globalStyle.typography?.fontFamily?.[0] || 'Inter';
                const headingSize = this.parsePtRangeToCss(globalStyle.typography?.heading, '1.8rem');
                const bodySize = this.parsePtRangeToCss(globalStyle.typography?.body, '1rem');
                const fontImport = /^https?:\/\//i.test(primaryFont)
                    ? primaryFont
                    : this.toGoogleFontUrl(primaryFont);

                const taskType = this.resolveManifestTaskType(viz);
                const taskPayload = this.buildManifestPayloadForTask(viz, taskType);
                const stylingGuidance = {
                    style_profile_id: styleProfile.id,
                    style_assets: styleProfile.assets,
                    theme_id: themeId || null,
                    chart_theme_id: chartThemeId || null,
                    course_styling: manifest.course?.styling || null,
                    viz_styling: viz.styling || null,
                    design_philosophy: designPhilosophy || null,
                    color_palette: globalStyle.colorPalette || null,
                    typography: globalStyle.typography || null,
                    media_style: globalStyle.mediaStyle || null,
                    viz_style: viz.style || viz.styleGuide || viz.visualStyle || null,
                    dimensions: viz.dimensions || null,
                };

                const resolvedCustomTheme = buildCustomThemeForPayload(
                    styleProfile,
                    globalStyle,
                    designPhilosophy,
                    themeId
                );

                tasks.push({
                    id: `viz-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    type: taskType,
                    refined_prompt: refinedPrompt.trim(),
                    payload: taskPayload,
                    metadata: {
                        user_id: Number.isFinite(Number(authContext?.userId)) ? Number(authContext?.userId) : undefined,
                        title: viz.title || vizDescription,
                        course_id: courseSlug,
                        lesson_id: lesson.lessonId,
                        lesson_title: lesson.title,
                        lesson_index: lessonIdx + 1, // 1-based index
                        batch_id: batchId,
                        queued_at: new Date().toISOString(),
                        dimensions: viz.dimensions,
                        template_type: this.resolveTemplateTypeForRouting(viz),
                        theme_id: themeId, // Pass through for strategy
                        chart_theme_id: chartThemeId,
                        style_profile_id: styleProfile.id,
                        story_style_suffix: styleSelection.generatedImageStyleSuffix,
                        sourced_style_suffix: styleSelection.sourcedImageStyleSuffix,
                        task_type: taskType,
                        styling_guidance: stylingGuidance,
                        original_instruction: `Description: ${vizDescription}${vizContext ? ` | Context: ${vizContext}` : ''}`,
                        target_audience: manifest.course?.targetAudience,
                        course_palette_hexes: coursePaletteHexes,
                        custom_theme: {
                            ...resolvedCustomTheme,
                            font_family: resolvedCustomTheme.font_family || fontImport,
                            font_name: resolvedCustomTheme.font_name || primaryFont,
                            font_size_heading: resolvedCustomTheme.font_size_heading || headingSize,
                            font_size_body: resolvedCustomTheme.font_size_body || bodySize,
                        }
                    }
                });
            });
        });

        this.logger.log(`Parsed ${tasks.length} tasks from manifest.`);
        this.observability.emitLog('info', `Parsed ${tasks.length} tasks from manifest`, 'Orchestrator', undefined, batchId);

        // Emit Initial Batch State
        const initialTasksMap = {};
        tasks.forEach(t => {
            initialTasksMap[t.id] = {
                taskId: t.id,
                batchId,
                status: 'pending',
                stage: 'Intake',
                details: {
                    title: t.metadata.title || t.metadata.lesson_title,
                    refined_prompt: t.refined_prompt,
                    original_instruction: t.metadata.original_instruction,
                    styling_guidance: t.metadata.styling_guidance
                },
                metadata: t.metadata
            };
        });
        this.observability.emitBatchInitialized(initialTasksMap);

        // Emit INTAKE status
        tasks.forEach(task => {
            this.observability.emitProgress({
                taskId: task.id,
                status: 'pending',
                stage: 'Intake',
                details: {
                    title: task.metadata.title || task.metadata.lesson_title,
                    refined_prompt: task.refined_prompt,
                    original_instruction: task.metadata.original_instruction,
                    styling_guidance: task.metadata.styling_guidance
                },
                metadata: {
                    course_id: task.metadata.course_id,
                    lesson_id: task.metadata.lesson_id,
                    lesson_title: task.metadata.lesson_title,
                    lesson_index: task.metadata.lesson_index,
                    batch_id: batchId,
                    queued_at: task.metadata.queued_at
                }
            });
            // Log for "By Asset" view
            this.observability.emitLog('info', `Task Intake: Queued. Original: "${task.metadata.original_instruction}"`, 'Orchestrator', task.id, batchId);
        });

        // Move tasks out of Intake immediately so observability reflects queued work.
        tasks.forEach(task => {
            this.observability.emitProgress({
                taskId: task.id,
                batchId,
                status: 'pending',
                stage: 'Queued for Generation'
            });
        });

        if (this.durableQueueEnabled && this.storage.isEnabled()) {
            await this.storage.enqueueDurableTasks(batchId, courseTitle, tasks);
            this.observability.emitLog('info', `Durable queue enqueued ${tasks.length} tasks (batch=${batchId})`, 'Orchestrator', undefined, batchId);
            return {
                message: 'Batch queued',
                mode: 'durable_queue',
                batchId,
                taskCount: tasks.length,
                course: courseTitle,
            };
        }

        // Execution Loop
        const limit = pLimit(this.manifestTaskConcurrency);
        let completedCount = 0;
        let failedCount = 0;

        const promises = tasks.map((task: any, index: number) => {
            return limit(async () => {
                const taskStartedAt = new Date();
                if (this.stopSignal) {
                    this.observability.emitLog('warn', 'Task cancelled due to batch stop', 'Orchestrator', task.id, batchId);
                    this.observability.emitProgress({ taskId: task.id, batchId, status: 'failed', stage: 'Cancelled' });
                    return { taskId: task.id, status: 'cancelled' };
                }

                try {
                    const taskStartPerf = performance.now();
                    const queuedAtRaw = task?.metadata?.queued_at;
                    const queuedAtMs = queuedAtRaw ? new Date(queuedAtRaw).getTime() : NaN;
                    const waitMs = Number.isFinite(queuedAtMs)
                        ? Math.max(0, taskStartedAt.getTime() - queuedAtMs)
                        : 0;
                    // Triage Phase
                    this.observability.emitProgress({ taskId: task.id, batchId, status: 'pending', stage: 'Triage' });
                    this.observability.emitLog('info', `Task Triage: Using refined prompt: "${task.refined_prompt}"`, 'Orchestrator', task.id, batchId);

                    // Processing Phase
                    this.observability.emitProgress({ taskId: task.id, batchId, status: 'processing', stage: 'Starting Generation...' });
                    this.observability.emitLog('info', 'Starting Generation Strategy', 'Orchestrator', task.id, batchId);

                    const strategy = this.strategyFactory.getStrategy(task);
                    const result: any = await this.withTimeout(
                        (strategy as any).performGeneration(task, index + 1),
                        this.manifestTaskTimeoutMs,
                        `Task timeout after ${this.manifestTaskTimeoutMs}ms`,
                    );
                    const taskEndedAt = new Date();
                    const taskDurationMs = performance.now() - taskStartPerf;

                    completedCount++;
                    this.observability.emitBatchProgress({ total: tasks.length, completed: completedCount, current: task.id, batchId });

                    const finalResult = {
                        taskId: task.id,
                        batchId,
                        status: 'completed',
                        url: result.url,
                        metrics: {
                            ...(result?.payload?.metrics || {}),
                            wait_ms: waitMs.toFixed(2),
                            generation_timeout_ms: this.manifestTaskTimeoutMs,
                            ...(task?.metadata?.task_type === 'story_image' ? { narrative_wait_ms: waitMs.toFixed(2) } : {})
                        },
                        details: {
                            started_at: taskStartedAt.toISOString(),
                            ended_at: taskEndedAt.toISOString(),
                            duration_ms: taskDurationMs.toFixed(2),
                            output_dir: result?.payload?.output_dir,
                            image_prompts: result?.payload?.image_prompts,
                            blueprint_prompt: result?.payload?.blueprint_prompt,
                            source_provider: result?.payload?.source_provider,
                            source_query: result?.payload?.source_query,
                            chart_type: result?.payload?.chart_type,
                            chart_data_points: result?.payload?.chart_data_points,
                            chart_labels_preview: result?.payload?.chart_labels_preview,
                            sourced_queries: result?.payload?.sourced_queries,
                            sourced_candidates: result?.payload?.sourced_candidates,
                            sourced_query_signals: result?.payload?.sourced_query_signals,
                            sourced_query_config: result?.payload?.sourced_query_config,
                            clip_score: result?.payload?.metrics?.clip_score,
                            vision_score: result?.payload?.metrics?.vision_score,
                            styling_guidance: task?.metadata?.styling_guidance
                        }
                    };

                    this.observability.emitProgress(finalResult as any);
                    if (result?.payload?.source_type === 'sourced_image' || result?.payload?.source_type === 'sourced_image_fallback_story') {
                        const provider = result?.payload?.source_provider || 'unknown';
                        const clip = result?.payload?.metrics?.clip_score;
                        const vision = result?.payload?.metrics?.vision_score;
                        const clipLabel = Number.isFinite(Number(clip)) ? Number(clip).toFixed(3) : 'n/a';
                        const visionLabel = Number.isFinite(Number(vision)) ? Number(vision).toString() : 'n/a';
                        this.observability.emitLog(
                            'info',
                            `Sourced scoring summary | provider=${provider} clip=${clipLabel} vision=${visionLabel}`,
                            'Orchestrator',
                            task.id,
                            batchId
                        );
                    }
                    return finalResult;

                } catch (error) {
                    const message = error?.message || 'Unknown task failure';
                    const stack = error?.stack ? String(error.stack).split('\n').slice(0, 4).join(' | ') : undefined;
                    const providerStatus = error?.status || error?.response?.status;
                    const providerCode = error?.code || error?.response?.data?.error?.code;
                    const correctionLog = Array.isArray(error?.correction_log) ? error.correction_log : undefined;

                    this.logger.error(`Manifest Task ${task.id} failed: ${message}`);
                    this.observability.emitLog(
                        'error',
                        `Task failed | stage=${task?.stage || 'generation'} status=${providerStatus ?? 'n/a'} code=${providerCode ?? 'n/a'} message=${message}${correctionLog?.length ? ` correction_log=${correctionLog.join('; ')}` : ''}${stack ? ` stack=${stack}` : ''}`,
                        'Orchestrator',
                        task.id,
                        batchId
                    );

                    failedCount++;
                    const errorResult = { taskId: task.id, status: 'failed', error: message, correction_log: correctionLog };
                    this.observability.emitProgress({
                        taskId: task.id,
                        batchId,
                        status: 'failed',
                        stage: 'Failed',
                        details: {
                            error: message,
                            correction_log: correctionLog,
                            status: providerStatus,
                            code: providerCode,
                            stack
                        }
                    });
                    return errorResult;
                }
            });
        });

        const results = await Promise.all(promises);
        const end = performance.now();
        const duration = ((end - start) / 1000).toFixed(2);
        this.logger.log(`Batch Complete. Total Duration: ${duration}s`);
        this.observability.emitLog('success', `Batch Complete in ${duration}s`, 'Orchestrator', undefined, batchId);
        this.observability.emitBatchFinalized({
            batchId,
            total: tasks.length,
            completed: completedCount,
            failed: failedCount,
            durationSeconds: parseFloat(duration),
            startedAt: batchStartedAt.toISOString(),
            endedAt: new Date().toISOString(),
            courseTitle
        });

        return {
            message: 'Batch completed',
            batchId,
            taskCount: tasks.length,
            course: courseTitle,
            durationSeconds: parseFloat(duration),
            results: results
        };
    }

    private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
        let timer: NodeJS.Timeout | null = null;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                const err: any = new Error(timeoutMessage);
                err.code = 'TASK_TIMEOUT';
                reject(err);
            }, timeoutMs);
        });
        try {
            return await Promise.race([promise, timeoutPromise]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }
}
