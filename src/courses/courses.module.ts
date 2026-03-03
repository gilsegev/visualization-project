import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CourseController } from './course.controller';
import { CourseOrchestratorService } from './course-orchestrator.service';
import { DEPRECATED_HtmlInfographicStrategy } from '../image-gen/strategies/DEPRECATED_jsdom-infographic.strategy';
import { BrowserService } from '../image-gen/browser.service';
import { LocalStorageService } from '../image-gen/local-storage.service';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';

@Module({
    imports: [ConfigModule, AuthModule, StorageModule],
    controllers: [CourseController],
    providers: [
        CourseOrchestratorService,
        DEPRECATED_HtmlInfographicStrategy,
        BrowserService,
        LocalStorageService
    ]
})
export class CoursesModule { }
