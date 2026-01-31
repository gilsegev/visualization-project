import { Logger } from '@nestjs/common';
import { ImageGeneratorStrategy } from './image-generator.strategy';
import { ImageTask } from './image-task.schema';

export abstract class BaseImageStrategy implements ImageGeneratorStrategy {
    protected readonly logger = new Logger(this.constructor.name);

    async generate(task: ImageTask): Promise<string> {
        this.logger.log(`Starting generation for task ${task.id} (${task.type})`);
        const startTime = Date.now();

        try {
            const result = await this.performGeneration(task);
            const duration = Date.now() - startTime;
            this.logger.log(`Completed generation for task ${task.id} in ${duration}ms`);
            return result;
        } catch (error) {
            this.logger.error(`Failed generation for task ${task.id}`, error);
            throw error;
        }
    }

    // Abstract method for subclasses to implement the actual logic
    protected abstract performGeneration(task: ImageTask): Promise<string>;
}
