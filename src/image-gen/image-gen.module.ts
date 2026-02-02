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
import { BrowserService } from './browser.service';

@Module({
    imports: [ConfigModule],
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
        BrowserService,
    ],
})
export class ImageGenModule { }
