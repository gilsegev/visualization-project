import { Injectable, Logger } from '@nestjs/common';
import { ImageRouterService } from './image-router.service';
import { ImageStrategyFactory } from './image-strategy.factory';
import * as pLimit from 'p-limit';
import { performance } from 'perf_hooks';

@Injectable()
export class ImageOrchestratorService {
    private readonly logger = new Logger(ImageOrchestratorService.name);

    constructor(
        private readonly imageRouter: ImageRouterService,
        private readonly strategyFactory: ImageStrategyFactory,
    ) { }

    async generateCourse(content: string) {
        const start = performance.now();
        this.logger.log(`Starting course generation for content length: ${content.length}`);

        // 1. Classification
        const tasks = await this.imageRouter.classify(content);
        this.logger.log(`Classified ${tasks.length} tasks.`);

        // 2. Parallel Execution with Limit
        // Global limit of 15. VisualConceptStrategy has internal limit of 8.
        const limit = pLimit(15);

        const promises = tasks.map((task, index) => {
            return limit(async () => {
                try {
                    const strategy = this.strategyFactory.getStrategy(task.type);
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

        // 3. Resillience (Promise.allSettled logic is handled by wrapping catch above effectively,
        // but strict allSettled returns structure {status, value/reason}.
        // Since we want to process them, we can just await Promise.all of our wrapped promises since they never throw.
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
}
