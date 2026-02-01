import { Injectable } from '@nestjs/common';
import { BaseImageStrategy } from '../base-image.strategy';
import { ImageTask } from '../image-task.schema';

@Injectable()
export class DataVizStrategy extends BaseImageStrategy {
    protected async performGeneration(task: ImageTask): Promise<string> {
        const payload = task.payload as any; // Type assertion since discrim union might be tricky here, or we can check task.type
        this.logger.log(`Generating data viz (${payload.chartType}) for prompt: ${task.refined_prompt}`);
        return `https://placehold.co/1024x1024?text=MOCK_DATA_VIZ_IMAGE`;
    }
}
