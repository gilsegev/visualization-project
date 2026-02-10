import { Controller, Post, Body, Logger } from '@nestjs/common';
import { CourseOrchestratorService } from './course-orchestrator.service';
import { CourseJob, BatchResult } from './course.dto';

@Controller('v1/course-visualizations')
export class CourseController {
    private readonly logger = new Logger(CourseController.name);

    constructor(private readonly courseService: CourseOrchestratorService) { }

    @Post()
    async createCourseVisualizations(@Body() job: CourseJob): Promise<BatchResult> {
        this.logger.log(`Received request for course: ${job.course_id}`);
        return await this.courseService.runCourseJob(job);
    }
}
