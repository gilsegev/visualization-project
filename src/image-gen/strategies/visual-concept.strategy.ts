import { Injectable } from '@nestjs/common';
import { BaseImageStrategy } from '../base-image.strategy';
import { ImageTask } from '../image-task.schema';

@Injectable()
export class VisualConceptStrategy extends BaseImageStrategy {
    protected async performGeneration(task: ImageTask, index?: number): Promise<string> {
        this.logger.log(`Generating visual concept for prompt: ${task.refined_prompt}`);
        return `https://placehold.co/1024x1024?text=MOCK_VISUAL_CONCEPT_IMAGE_${index}`;
    }
}
