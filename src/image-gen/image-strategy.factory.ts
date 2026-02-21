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
        const taskAny = task as any;
        const raw = String(taskAny?.metadata?.template_type || taskAny?.payload?.type || '').toLowerCase().trim();
        const refined = String(taskAny?.refined_prompt || '').toLowerCase();
        const payload = taskAny?.payload || {};
        const structure = payload?.structure || {};
        const hasBranchingStructure =
            (Array.isArray(structure?.decisionNodes) && structure.decisionNodes.length > 0)
            || (structure?.outputs && typeof structure.outputs === 'object' && Object.keys(structure.outputs).length > 0)
            || (Array.isArray(payload?.items) && payload.items.length > 5 && /decision|flow|branch/.test(refined));

        if (hasBranchingStructure) return true;
        if (/create a\s+(flowchart|timeline|process[_\s-]?map|process[_\s-]?flow)\b/.test(refined)) return true;

        return raw === 'flowchart'
            || raw === 'timeline'
            || raw === 'process_map'
            || raw === 'process_flow'
            || raw === 'process map'
            || raw === 'process-flow';
    }
}
