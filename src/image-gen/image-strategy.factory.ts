import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { VisualConceptStrategy } from './strategies/visual-concept.strategy';
import { DataVizStrategy } from './strategies/data-viz.strategy';
import { MathFormulaStrategy } from './strategies/math-formula.strategy';
import { BeautifySlideStrategy } from './strategies/beautify-slide.strategy';
import { InfographicStrategy } from './strategies/infographic.strategy';
import { ImageGeneratorStrategy } from './image-generator.strategy';

@Injectable()
export class ImageStrategyFactory {
    constructor(
        private readonly visualConceptStrategy: VisualConceptStrategy,
        private readonly dataVizStrategy: DataVizStrategy,
        private readonly mathFormulaStrategy: MathFormulaStrategy,
        private readonly beautifySlideStrategy: BeautifySlideStrategy,
        private readonly infographicStrategy: InfographicStrategy,
    ) { }

    getStrategy(type: string): ImageGeneratorStrategy {
        switch (type) {
            case 'visual_concept':
                return this.visualConceptStrategy;
            case 'data_viz':
                return this.dataVizStrategy;
            case 'math_formula':
                return this.mathFormulaStrategy;
            case 'beautify_slide':
                return this.beautifySlideStrategy;
            case 'infographic':
                return this.infographicStrategy;
            default:
                throw new InternalServerErrorException(`No strategy found for image task type: ${type}`);
        }
    }
}
