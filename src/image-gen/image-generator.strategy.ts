import { ImageTask } from './image-task.schema';

export interface ImageGeneratorStrategy {
    generate(task: ImageTask, index?: number): Promise<string>;
}
