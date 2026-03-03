import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ImageGenController } from './image-gen.controller';
import { ImageRouterService } from './image-router.service';
import { ImageStrategyFactory } from './image-strategy.factory';
import { ImageOrchestratorService } from './image-orchestrator.service';
import { LocalStorageService } from './local-storage.service';
import { VisualConceptStrategy } from './strategies/visual-concept.strategy';
import { DataVizStrategy } from './strategies/data-viz.strategy';
import { MathFormulaStrategy } from './strategies/math-formula.strategy';
import { BeautifySlideStrategy } from './strategies/beautify-slide.strategy';
import { InfographicStrategy } from './strategies/infographic.strategy';
import { DEPRECATED_HtmlInfographicStrategy } from './strategies/DEPRECATED_jsdom-infographic.strategy';
import { TemplateStampingStrategy } from './strategies/template-stamping.strategy';
import { StoryImageStrategy } from './strategies/story-image.strategy';
import { SourcedImageStrategy } from './strategies/sourced-image.strategy';
import { D2DiagramStrategy } from './strategies/d2-diagram.strategy';
import { TemplateStampingService } from './services/template-stamping.service';
import { LocalClipService } from './services/local-clip.service';
import { WorkerHealthSupervisorService } from './services/worker-health-supervisor.service';
import { BrowserService } from './browser.service';
import { ObservabilityModule } from '../observability/observability.module';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';

@Module({
    imports: [
        ConfigModule,
        ObservabilityModule,
        AuthModule,
        StorageModule,
    ],
    controllers: [ImageGenController],
    providers: [
        ImageRouterService,
        ImageStrategyFactory,
        ImageOrchestratorService,
        LocalStorageService,
        VisualConceptStrategy,
        DataVizStrategy,
        MathFormulaStrategy,
        BeautifySlideStrategy,
        InfographicStrategy,
        DEPRECATED_HtmlInfographicStrategy,
        TemplateStampingStrategy,
        StoryImageStrategy,
        SourcedImageStrategy,
        D2DiagramStrategy,
        TemplateStampingService,
        LocalClipService,
        WorkerHealthSupervisorService,
        BrowserService,
    ],
})
export class ImageGenModule { }
