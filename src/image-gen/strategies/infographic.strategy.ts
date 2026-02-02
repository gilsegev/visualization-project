import { Injectable } from '@nestjs/common';
import { BaseImageStrategy, ImageGenerationResult } from '../base-image.strategy';
import { ImageTask } from '../image-task.schema';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';

export interface InfographicBlueprint {
    infographic: {
        intent: {
            narrative_type: 'journey' | 'hub' | 'stack' | 'timeline' | 'process' | 'comparison';
            explanation: string;
        };
        content: {
            title: string;
            subtitle: string;
            items: {
                title: string;
                detail: string;
                icon_keyword: string; // mapped from keyword for icon search
            }[];
        };
        visual_hints: {
            mood: string;
            complexity: 'low' | 'medium' | 'high';
            density: 'low' | 'medium' | 'high';
        };
    };
}

interface InfographicTemplateRegistry {
    [key: string]: {
        file: string;
        name: string;
        maxSlots: number;
    };
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
        this.logger.log(`Blueprint generated: Type=${blueprint.infographic.intent.narrative_type}, Items=${blueprint.infographic.content.items.length}`);

        // 2. Select Template (Real Logic)
        const templatePath = this.selectTemplate(blueprint);
        this.logger.log(`Selected Template Path: ${templatePath}`);

        // 3. For now, return the template path as the "url" just to prove selection worked in early testing,
        // or keep the placeholder but log the success.
        // The prompt says "Verify via console logs".
        const dummyUrl = `/generated-images/infographic-${task.id}-preview.png`;
        return { url: dummyUrl };
    }

    private async generateBlueprint(prompt: string): Promise<InfographicBlueprint> {
        if (!this.model) {
            throw new Error('Gemini API Key not configured for InfographicStrategy');
        }

        // Designer LLM Instruction (Canonical JSON Contract v1)
        const systemPrompt = `
            You are an expert Information Designer.
            Analyze the user request and generate a structural "Infographic Blueprint".
            Focus on the MEANING and NARRATIVE structure.

            User Request: "${prompt}"

            Output STRICT JSON following this Canonical Contract (v1):
            {
                "infographic": {
                    "intent": {
                        "narrative_type": "journey" | "hub" | "stack" | "timeline" | "process" | "comparison",
                        "explanation": "Justify why this structure fits the content..."
                    },
                    "content": {
                        "title": "Main Title",
                        "subtitle": "Overview or context",
                        "items": [
                            { "title": "Step 1", "detail": "Description...", "icon_keyword": "search" }
                        ]
                    },
                    "visual_hints": {
                        "mood": "professional" | "playful" | "urgent",
                        "complexity": "low" | "medium" | "high",
                        "density": "low" | "medium" | "high"
                    }
                }
            }
        `;

        try {
            const result = await this.model.generateContent(systemPrompt);
            const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(text) as InfographicBlueprint;

            // Basic validation
            if (!parsed.infographic || !parsed.infographic.intent || !parsed.infographic.content) {
                throw new Error('Invalid JSON structure returned from LLM');
            }

            return parsed;
        } catch (e) {
            this.logger.error('Failed to generate blueprint', e);
            throw new Error('Blueprint generation failed');
        }
    }

    private selectTemplate(blueprint: InfographicBlueprint): string {
        const templatesDir = path.join(process.cwd(), 'public', 'assets', 'infographics', 'templates');
        const registryPath = path.join(templatesDir, 'templates.json');
        const narrativeType = blueprint.infographic.intent.narrative_type;

        try {
            if (!fs.existsSync(registryPath)) {
                this.logger.warn(`Template registry not found at ${registryPath}`);
                return '';
            }

            const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as InfographicTemplateRegistry;
            const templateData = registry[narrativeType];

            if (!templateData) {
                this.logger.warn(`No template found for narrative type: ${narrativeType}`);
                return '';
            }

            // Constraint Hardening: Check Capacity
            const maxSlots = templateData.maxSlots;
            const itemCount = blueprint.infographic.content.items.length;

            if (itemCount > maxSlots) {
                this.logger.warn(`[CONSTRAINT] Content (${itemCount}) exceeds template capacity (${maxSlots}) for '${narrativeType}'. Truncating items.`);
                blueprint.infographic.content.items = blueprint.infographic.content.items.slice(0, maxSlots);
            }

            const fullPath = path.join(templatesDir, templateData.file);
            this.logger.log(`Selected Template: ${templateData.name} (${fullPath})`);
            return fullPath;

        } catch (e) {
            this.logger.error('Failed to select template', e);
            return '';
        }
    }
}
