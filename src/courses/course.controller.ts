import { Controller, Post, Body, Logger, UseGuards } from '@nestjs/common';
import { CourseOrchestratorService } from './course-orchestrator.service';
import { CourseJobDto } from './course.dto';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { enforceCourseLimits } from '../common/validation/payload-limits';

@Controller('courses')
@UseGuards(ApiKeyGuard)
export class CourseController {
    private readonly logger = new Logger(CourseController.name);

    constructor(private readonly orchestrator: CourseOrchestratorService) { }

    @Post('generate')
    async generateCourse(@Body() courseJob: CourseJobDto) {
        enforceCourseLimits(courseJob);
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
