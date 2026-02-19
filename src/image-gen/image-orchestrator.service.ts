import { Injectable, Logger } from '@nestjs/common';
import { ImageRouterService } from './image-router.service';
import { ImageStrategyFactory } from './image-strategy.factory';
import * as pLimit from 'p-limit';
import { performance } from 'perf_hooks';
import { ObservabilityGateway } from '../observability/observability.gateway';

@Injectable()
export class ImageOrchestratorService {
    private readonly logger = new Logger(ImageOrchestratorService.name);
    private readonly manifestTaskConcurrency: number;
    private readonly manifestTaskTimeoutMs: number;

    constructor(
        private readonly imageRouter: ImageRouterService,
        private readonly strategyFactory: ImageStrategyFactory,
        private readonly observability: ObservabilityGateway,
    ) {
        const configuredConcurrency = Number(process.env.MANIFEST_TASK_CONCURRENCY || 8);
        this.manifestTaskConcurrency = Number.isFinite(configuredConcurrency) && configuredConcurrency > 0
            ? configuredConcurrency
            : 8;
        const configuredTimeout = Number(process.env.MANIFEST_TASK_TIMEOUT_MS || 120000);
        this.manifestTaskTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
            ? configuredTimeout
            : 120000;
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

    async generateFromManifest(manifest: any) {
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
        const coursePaletteHexes = Object.values(globalStyle.colorPalette || {})
            .map(v => String(v).trim())
            .filter(v => /^#[0-9a-f]{3,8}$/i.test(v));

        // 1. Parse Manifest into Tasks
        const tasks: any[] = [];
        const courseSlug = courseTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

        // Support both root-level lessons and course.lessons, just in case
        const lessons = manifest.lessons || manifest.course?.lessons || [];

        lessons.forEach((lesson: any, lessonIdx: number) => {
            const visualItems = lesson.visualizations || lesson.items || [];
            visualItems.forEach((viz: any) => {
                const vizDescription = viz.description || viz.title || 'a visual representation';
                const vizContext = viz.context || '';
                const refinedPrompt = `Create a ${viz.type} for the lesson "${lesson.title}": ${vizDescription}. Context: ${vizContext}`;

                // Support for specific theme overrides
                const themeId = viz.metadata?.theme_id || viz.theme_id;

                const primaryFont = globalStyle.typography?.fontFamily?.[0] || 'Inter';
                const headingSize = this.parsePtRangeToCss(globalStyle.typography?.heading, '1.8rem');
                const bodySize = this.parsePtRangeToCss(globalStyle.typography?.body, '1rem');
                const fontImport = /^https?:\/\//i.test(primaryFont)
                    ? primaryFont
                    : this.toGoogleFontUrl(primaryFont);

                const taskType = this.resolveManifestTaskType(viz);
                const taskPayload = this.buildManifestPayloadForTask(viz, taskType);
                tasks.push({
                    id: `viz-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    type: taskType,
                    refined_prompt: refinedPrompt.trim(),
                    payload: taskPayload,
                    metadata: {
                        course_id: courseSlug,
                        lesson_id: lesson.lessonId,
                        lesson_title: lesson.title,
                        lesson_index: lessonIdx + 1, // 1-based index
                        batch_id: batchId,
                        queued_at: new Date().toISOString(),
                        dimensions: viz.dimensions,
                        theme_id: themeId, // Pass through for strategy
                        task_type: taskType,
                        original_instruction: `Description: ${vizDescription}${vizContext ? ` | Context: ${vizContext}` : ''}`,
                        target_audience: manifest.course?.targetAudience,
                        course_palette_hexes: coursePaletteHexes,
                        // Only inject custom_theme if a global guide is provided AND no specific themeId is set
                        custom_theme: (manifest.course?.globalStyleGuide && !themeId) ? {
                            id: 'manifest_theme',
                            name: 'Manifest Theme',
                            primary_accent: globalStyle.colorPalette?.mutedTeal || '#5B9A8B',
                            secondary_accent: globalStyle.colorPalette?.softCoral || globalStyle.colorPalette?.deepNavy || '#E8A598',
                            background_main: globalStyle.colorPalette?.creamWhite || globalStyle.colorPalette?.warmSand || '#FAF9F6',
                            text_main: globalStyle.colorPalette?.slateGrey || '#1A365D',
                            text_secondary: globalStyle.colorPalette?.slateGrey || '#4A5568',
                            font_family: fontImport,
                            font_name: primaryFont,
                            font_size_heading: headingSize,
                            font_size_body: bodySize,
                            glass_color: 'rgba(255, 255, 255, 0.72)',
                            image_style_suffix: `${designPhilosophy}, flat vector style, geometric organic shapes, simplified silhouettes`
                        } : undefined
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
                    original_instruction: t.metadata.original_instruction
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
                    original_instruction: task.metadata.original_instruction
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
                            blueprint_prompt: result?.payload?.blueprint_prompt
                        }
                    };

                    this.observability.emitProgress(finalResult as any);
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
            endedAt: new Date().toISOString()
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
