import { Injectable } from '@nestjs/common';
import { BaseImageStrategy } from '../base-image.strategy';
import { ImageTask } from '../image-task.schema';

@Injectable()
export class BeautifySlideStrategy extends BaseImageStrategy {
    protected async performGeneration(task: ImageTask): Promise<string> {
        this.logger.log(`Beautifying slide for prompt: ${task.refined_prompt}`);
        return `https://placehold.co/1024x1024?text=MOCK_BEAUTIFY_SLIDE_IMAGE`;
    }
}
