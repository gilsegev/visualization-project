import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CourseController } from './course.controller';
import { CourseOrchestratorService } from './course-orchestrator.service';
import { HtmlInfographicStrategy } from '../image-gen/strategies/html-infographic.strategy';
import { BrowserService } from '../image-gen/browser.service';
import { LocalStorageService } from '../image-gen/local-storage.service';

@Module({
    imports: [ConfigModule],
    controllers: [CourseController],
    providers: [
        CourseOrchestratorService,
        HtmlInfographicStrategy,
        BrowserService,
        LocalStorageService
    ]
})
export class CoursesModule { }
