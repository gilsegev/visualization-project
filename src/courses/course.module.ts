import { Module } from '@nestjs/common';
import { CourseController } from './course.controller';
import { CourseOrchestratorService } from './course-orchestrator.service';
import { ImageGenModule } from '../image-gen/image-gen.module';
import { HtmlInfographicStrategy } from '../image-gen/strategies/html-infographic.strategy';

@Module({
    imports: [ImageGenModule],
    controllers: [CourseController],
    providers: [CourseOrchestratorService],
})
export class CourseModule { }
