import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StorageModule } from '../storage/storage.module';
import { ObservabilityModule } from '../observability/observability.module';
import { ImageStrategyFactory } from '../image-gen/image-strategy.factory';
import { LocalStorageService } from '../image-gen/local-storage.service';
import { VisualConceptStrategy } from '../image-gen/strategies/visual-concept.strategy';
import { DataVizStrategy } from '../image-gen/strategies/data-viz.strategy';
import { MathFormulaStrategy } from '../image-gen/strategies/math-formula.strategy';
import { BeautifySlideStrategy } from '../image-gen/strategies/beautify-slide.strategy';
import { InfographicStrategy } from '../image-gen/strategies/infographic.strategy';
import { DEPRECATED_HtmlInfographicStrategy } from '../image-gen/strategies/DEPRECATED_jsdom-infographic.strategy';
import { TemplateStampingStrategy } from '../image-gen/strategies/template-stamping.strategy';
import { StoryImageStrategy } from '../image-gen/strategies/story-image.strategy';
import { SourcedImageStrategy } from '../image-gen/strategies/sourced-image.strategy';
import { D2DiagramStrategy } from '../image-gen/strategies/d2-diagram.strategy';
import { TemplateStampingService } from '../image-gen/services/template-stamping.service';
import { LocalClipService } from '../image-gen/services/local-clip.service';
import { BrowserService } from '../image-gen/browser.service';
import { DurableQueueWorkerService } from './durable-queue.worker.service';
import { DocumentQueueWorkerService } from './document-queue.worker.service';
import { DocumentAnalysisService } from '../documents/analysis/document-analysis.service';
import { DocxTextExtractorService } from '../documents/analysis/docx-text-extractor.service';
import { VisualManifestPlannerService } from '../documents/planning/visual-manifest-planner.service';

@Module({
    imports: [ConfigModule.forRoot({ isGlobal: true }), StorageModule, ObservabilityModule],
    providers: [
        DurableQueueWorkerService,
        DocumentQueueWorkerService,
        DocumentAnalysisService,
        DocxTextExtractorService,
        VisualManifestPlannerService,
        ImageStrategyFactory,
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
        BrowserService,
    ],
})
export class WorkerModule {}
