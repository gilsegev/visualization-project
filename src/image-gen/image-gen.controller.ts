import { Body, Controller, Post } from '@nestjs/common';
import { ImageRouterService } from './image-router.service';
import { ImageStrategyFactory } from './image-strategy.factory';

@Controller('generate')
export class ImageGenController {
    constructor(
        private readonly imageRouter: ImageRouterService,
        private readonly strategyFactory: ImageStrategyFactory,
    ) { }

    @Post()
    async generate(@Body('content') content: string) {
        if (!content) {
            return { error: 'Content is required in body' };
        }

        const tasks = await this.imageRouter.classify(content);
        const results = [];

        for (const task of tasks) {
            const strategy = this.strategyFactory.getStrategy(task.type);
            const url = await strategy.generate(task);
            results.push({
                taskId: task.id,
                type: task.type,
                url: url,
            });
        }

        return results;
    }
}
