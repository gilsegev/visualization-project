import { Controller, Post, Body, Logger } from '@nestjs/common';
import { CourseOrchestratorService } from './course-orchestrator.service';
import { CourseJob } from './course.dto';

@Controller('courses')
export class CourseController {
    private readonly logger = new Logger(CourseController.name);

    constructor(private readonly orchestrator: CourseOrchestratorService) { }

    @Post('generate')
    async generateCourse(@Body() courseJob: CourseJob) {
        this.logger.log(`Received course generation request: ${courseJob.metadata.title}`);
        const result = await this.orchestrator.processCourse(courseJob);
        return {
            success: true,
            courseId: result.courseId,
            images: result.images,
            count: result.images.length
        };
    }
}
