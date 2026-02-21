import { Injectable, InternalServerErrorException } from '@nestjs/common';
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
import { ImageGeneratorStrategy } from './image-generator.strategy';
import { ImageTask } from './image-task.schema';

@Injectable()
export class ImageStrategyFactory {
    constructor(
        private readonly visualConceptStrategy: VisualConceptStrategy,
        private readonly dataVizStrategy: DataVizStrategy,
        private readonly mathFormulaStrategy: MathFormulaStrategy,
        private readonly beautifySlideStrategy: BeautifySlideStrategy,
        private readonly infographicStrategy: InfographicStrategy, // Kept for legacy if needed/used
        private readonly deprecatedHtmlStrategy: DEPRECATED_HtmlInfographicStrategy,
        private readonly templateStampingStrategy: TemplateStampingStrategy,
        private readonly storyImageStrategy: StoryImageStrategy,
        private readonly sourcedImageStrategy: SourcedImageStrategy,
        private readonly d2DiagramStrategy: D2DiagramStrategy,
    ) { }

    getStrategy(task: ImageTask): ImageGeneratorStrategy {
        switch (task.type) {
            case 'visual_concept':
                return this.visualConceptStrategy;
            case 'data_viz':
                return this.dataVizStrategy;
            case 'math_formula':
                return this.mathFormulaStrategy;
            case 'beautify_slide':
                return this.beautifySlideStrategy;
            case 'infographic':
                if (this.isD2TemplateType(task)) {
                    return this.d2DiagramStrategy;
                }
                return this.templateStampingStrategy;
            case 'story_image':
                return this.storyImageStrategy;
            case 'sourced_image':
                return this.sourcedImageStrategy;
            default:
                throw new InternalServerErrorException(`No strategy found for image task type: ${(task as any).type}`);
        }
    }

    private isD2TemplateType(task: ImageTask): boolean {
        const raw = String((task as any)?.metadata?.template_type || (task as any)?.payload?.type || '').toLowerCase().trim();
        return raw === 'flowchart' || raw === 'timeline' || raw === 'process_map';
    }
}
