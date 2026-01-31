import { ImageTask } from './image-task.schema';

export interface ImageGeneratorStrategy {
    generate(task: ImageTask): Promise<string>;
}
