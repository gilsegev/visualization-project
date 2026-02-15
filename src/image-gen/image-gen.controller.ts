import { Body, Controller, Post } from '@nestjs/common';
import { ImageOrchestratorService } from './image-orchestrator.service';

@Controller('generate')
export class ImageGenController {
    constructor(
        private readonly orchestrator: ImageOrchestratorService,
    ) { }

    @Post()
    async generate(@Body('content') content: string) {
        if (!content) {
            return { error: 'Content is required in body' };
        }

        return this.orchestrator.generateCourse(content);
    }

    @Post('manifest')
    async generateFromManifest(@Body() manifest: any) {
        if (!manifest || (!manifest.visualizations && !manifest.lessons)) {
            return { error: 'Valid manifest with visualizations or lessons is required' };
        }
        return this.orchestrator.generateFromManifest(manifest);
    }
}
