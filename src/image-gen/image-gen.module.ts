import { Module } from '@nestjs/common';
import { ImageGenController } from './image-gen.controller';
import { ImageRouterService } from './image-router.service';
import { ImageStrategyFactory } from './image-strategy.factory';
import { VisualConceptStrategy } from './strategies/visual-concept.strategy';
import { DataVizStrategy } from './strategies/data-viz.strategy';
import { MathFormulaStrategy } from './strategies/math-formula.strategy';
import { BeautifySlideStrategy } from './strategies/beautify-slide.strategy';

@Module({
    controllers: [ImageGenController],
    providers: [
        ImageRouterService,
        ImageStrategyFactory,
        VisualConceptStrategy,
        DataVizStrategy,
        MathFormulaStrategy,
        BeautifySlideStrategy,
    ],
})
export class ImageGenModule { }
