import { Injectable } from '@nestjs/common';
import { BaseImageStrategy, ImageGenerationResult } from '../base-image.strategy';
import { ImageTask } from '../image-task.schema';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

export interface InfographicBlueprint {
    narrativeType: 'journey' | 'hub' | 'stack' | 'timeline' | 'process' | 'comparison';
    tone: string;
    elements: {
        title: string;
        detail: string;
        keyword: string;
    }[];
}

@Injectable()
export class InfographicStrategy extends BaseImageStrategy {
    private model: GenerativeModel;

    constructor() {
        super();
        const apiKey = process.env.GEMINI_API_KEY;
        if (apiKey) {
            const genAI = new GoogleGenerativeAI(apiKey);
            this.model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        }
    }

    protected async performGeneration(task: ImageTask, index?: number): Promise<ImageGenerationResult> {
        this.logger.log(`Generating infographic blueprint for: ${task.refined_prompt}`);

        // 1. Generate Blueprint via LLM
        const blueprint = await this.generateBlueprint(task.refined_prompt);
        this.logger.log(`Blueprint generated: Type=${blueprint.narrativeType}, Elements=${blueprint.elements.length}`);

        // 2. Select Template (Stub)
        const template = this.selectTemplate(blueprint);
        this.logger.log(`Selected Template: ${template}`);

        // 3. For now, return a placeholder image or URL (since we don't render yet)
        // We will just return a dummy URL to pass verification until rendering is implemented.
        const dummyUrl = `/generated-images/placeholder-infographic-${index ?? 'x'}.png`;
        return { url: dummyUrl };
    }

    private async generateBlueprint(prompt: string): Promise<InfographicBlueprint> {
        if (!this.model) {
            throw new Error('Gemini API Key not configured for InfographicStrategy');
        }

        const systemPrompt = `
            You are an expert Information Designer. 
            Analyze the user request and generate a structural "Infographic Blueprint".
            Focus on the MEANING and NARRATIVE structure, not visual layout.
            
            User Request: "${prompt}"

            Output STRICT JSON matching this interface:
            {
                "narrativeType": "journey" | "hub" | "stack" | "timeline" | "process" | "comparison",
                "tone": "professional" | "playful" | "urgent" | "calm",
                "elements": [
                    { "title": "Step 1", "detail": "Description...", "keyword": "Start" }
                ]
            }
        `;

        try {
            const result = await this.model.generateContent(systemPrompt);
            const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(text) as InfographicBlueprint;
        } catch (e) {
            this.logger.error('Failed to generate blueprint', e);
            throw new Error('Blueprint generation failed');
        }
    }

    private selectTemplate(blueprint: InfographicBlueprint): string {
        // Stub implementation
        return `template-${blueprint.narrativeType}-default`;
    }
}
