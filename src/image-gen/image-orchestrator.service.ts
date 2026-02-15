import { Injectable, Logger } from '@nestjs/common';
import { ImageRouterService } from './image-router.service';
import { ImageStrategyFactory } from './image-strategy.factory';
import * as pLimit from 'p-limit';
import { performance } from 'perf_hooks';
import { ObservabilityGateway } from '../observability/observability.gateway';

@Injectable()
export class ImageOrchestratorService {
    private readonly logger = new Logger(ImageOrchestratorService.name);

    constructor(
        private readonly imageRouter: ImageRouterService,
        private readonly strategyFactory: ImageStrategyFactory,
        private readonly observability: ObservabilityGateway,
    ) { }

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
        const start = performance.now();
        const courseTitle = manifest.course?.title || 'Untitled Course';
        this.logger.log(`Starting Batch Generation from Hierarchical Manifest: ${courseTitle}`);
        this.observability.emitLog('info', `Starting Batch Generation: ${courseTitle}`, 'Orchestrator');
        this.observability.emitBatchProgress({ total: 0, completed: 0, current: 'Initializing...' });

        const globalStyle = manifest.course?.globalStyleGuide || {};
        const designPhilosophy = manifest.course?.designPhilosophy || 'Professional';

        // 1. Parse Manifest into Tasks
        const tasks: any[] = [];
        const courseSlug = courseTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

        // Support both root-level lessons and course.lessons, just in case
        const lessons = manifest.lessons || manifest.course?.lessons || [];

        lessons.forEach((lesson: any, lessonIdx: number) => {
            const visualItems = lesson.visualizations || lesson.items || [];
            visualItems.forEach((viz: any) => {
                // Clean up visualization ID/content for prompt
                const { visualizationId, ...vizContent } = viz;

                const refinedPrompt = `Create a ${viz.type} for the lesson "${lesson.title}": ${viz.description}. Context: ${viz.context || ''}`;

                tasks.push({
                    id: `viz-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    type: 'infographic',
                    refined_prompt: refinedPrompt.trim(),
                    payload: {},
                    metadata: {
                        course_id: courseSlug,
                        lesson_id: lesson.lessonId,
                        lesson_title: lesson.title,
                        lesson_index: lessonIdx + 1, // 1-based index
                        dimensions: viz.dimensions,
                        target_audience: manifest.course?.targetAudience,
                        custom_theme: {
                            id: 'manifest_theme',
                            name: 'Manifest Theme',
                            primary_accent: globalStyle.colorPalette?.mutedTeal || '#5B9A8B',
                            secondary_accent: globalStyle.colorPalette?.softCoral || '#E8A598',
                            background_main: globalStyle.colorPalette?.creamWhite || '#FAF9F6',
                            text_main: globalStyle.colorPalette?.deepNavy || '#1A365D',
                            font_family: globalStyle.typography?.fontFamily?.[0] || 'Inter',
                            image_style_suffix: `${designPhilosophy}, flat vector style`
                        }
                    }
                });
            });
        });

        this.logger.log(`Parsed ${tasks.length} tasks from manifest.`);
        this.observability.emitLog('info', `Parsed ${tasks.length} tasks from manifest`, 'Orchestrator');

        // Return immediately to the controller
        const responseMetadata = {
            message: 'Batch started',
            taskCount: tasks.length,
            course: courseTitle
        };

        // Emit Initial Batch State
        const initialTasksMap = {};
        tasks.forEach(t => {
            initialTasksMap[t.id] = {
                taskId: t.id,
                status: 'pending',
                stage: 'Intake',
                details: {
                    title: t.metadata.title || t.metadata.lesson_title,
                    refined_prompt: t.refined_prompt
                },
                metadata: t.metadata
            };
        });
        this.observability.emitBatchInitialized(initialTasksMap);


        // 2. Async Execution (Fire and Forget)
        (async () => {
            // Emit INTAKE status
            tasks.forEach(task => {
                this.observability.emitProgress({
                    taskId: task.id,
                    status: 'pending',
                    stage: 'Intake',
                    details: {
                        title: task.metadata.title || task.metadata.lesson_title,
                        refined_prompt: task.refined_prompt // Add prompt here
                    },
                    metadata: {
                        course_id: task.metadata.course_id,
                        lesson_id: task.metadata.lesson_id,
                        lesson_title: task.metadata.lesson_title,
                        lesson_index: task.metadata.lesson_index
                    }
                });
            });

            // Execution Loop
            const limit = pLimit(3);
            let completedCount = 0;

            const promises = tasks.map((task: any, index: number) => {
                return limit(async () => {
                    try {
                        // Triage Phase
                        this.observability.emitProgress({ taskId: task.id, status: 'pending', stage: 'Triage' });
                        await new Promise(r => setTimeout(r, 500));

                        // Processing Phase
                        this.observability.emitProgress({ taskId: task.id, status: 'processing', stage: 'Starting Generation...' });

                        const strategy = this.strategyFactory.getStrategy(task);
                        // Cast to any because the interface might not have performGeneration typed yet (it's specific to template strategy)
                        const result = await (strategy as any).performGeneration(task, index + 1);

                        completedCount++;
                        this.observability.emitBatchProgress({ total: tasks.length, completed: completedCount, current: task.id });

                        this.observability.emitProgress({
                            taskId: task.id,
                            status: 'completed',
                            url: result.url,
                            metrics: result.payload.metrics,
                            details: {
                                output_dir: result.payload.output_dir,
                                image_prompts: result.payload.image_prompts, // Pass through image prompts
                                bluebrint_prompt: result.payload.blueprint_prompt // Pass through blueprint prompt if available
                            }
                        });

                    } catch (error) {
                        this.logger.error(`Manifest Task ${task.id} failed: ${error.message}`);
                        this.observability.emitProgress({ taskId: task.id, status: 'failed', details: { error: error.message } });
                    }
                });
            });

            await Promise.all(promises);
            const end = performance.now();
            const duration = ((end - start) / 1000).toFixed(2);
            this.logger.log(`Batch Complete. Total Duration: ${duration}s`);
            this.observability.emitLog('success', `Batch Complete in ${duration}s`, 'Orchestrator');

        })().catch(err => {
            this.logger.error(`Critical Batch Error: ${err.message}`);
        });

        return responseMetadata;
    }
}
