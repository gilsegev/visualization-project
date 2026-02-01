import { ImageTask } from './image-task.schema';
import { ImageGenerationResult } from './base-image.strategy';

export interface ImageGeneratorStrategy {
    generate(task: ImageTask, index?: number): Promise<ImageGenerationResult>;
}
