import { Logger } from '@nestjs/common';
import { ImageGeneratorStrategy } from './image-generator.strategy';
import { ImageTask } from './image-task.schema';

export interface ImageGenerationResult {
    url: string;
    posterUrl?: string;
}

export abstract class BaseImageStrategy implements ImageGeneratorStrategy {
    protected readonly logger = new Logger(this.constructor.name);

    async generate(task: ImageTask, index?: number): Promise<ImageGenerationResult> {
        try {
            this.logger.log(`Starting generation for task ${task.id} (${task.type})`);
            return await this.performGeneration(task, index);
        } catch (error) {
            this.logger.error(`Failed to generate image for task ${task.id}: ${error.message}`);
            throw error;
        }
    }

    // Abstract method for subclasses to implement the actual logic
    protected abstract performGeneration(task: ImageTask, index?: number): Promise<ImageGenerationResult>;
}
