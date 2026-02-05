import { Injectable } from '@nestjs/common';
import { BaseImageStrategy, ImageGenerationResult } from '../base-image.strategy';
import { ImageTask } from '../image-task.schema';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import * as d3 from 'd3';
import * as rough from 'roughjs';
import { getPalette } from './infographic-palettes';
import { BrowserService } from '../browser.service';
import { LocalStorageService } from '../local-storage.service';

export interface InfographicBlueprint {
    template_id: 'snake_process' | 'hub_spoke' | 'vertical_stack';
    theme_color: string;
    global_style_prompt: string;
    items: {
        subject_prompt: string;
        label_text: string;
    }[];
}

interface InfographicTemplateRegistry {
    [key: string]: {
        file: string;
        name: string;
        maxSlots: number;
    };
}

import { ConfigService } from '@nestjs/config';

@Injectable()
export class InfographicStrategy extends BaseImageStrategy {
    private model: GenerativeModel;

    constructor(
        private readonly browserService: BrowserService,
        private readonly localStorage: LocalStorageService,
        private readonly configService: ConfigService
    ) {
        super();
        const apiKey = this.configService.get<string>('GEMINI_API_KEY');
        this.logger.log(`[DEBUG] CWD: ${process.cwd()}`);
        this.logger.log(`[DEBUG] GEMINI_API_KEY: ${apiKey ? 'Found' : 'Not Found'}`);
        if (apiKey) {
            const genAI = new GoogleGenerativeAI(apiKey);
            this.model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        }
    }

    protected async performGeneration(task: ImageTask, index?: number): Promise<ImageGenerationResult> {
        this.logger.log(`Generating infographic blueprint for: ${task.refined_prompt}`);

        // 1. Generate Blueprint via LLM
        const blueprint = await this.generateBlueprint(task.refined_prompt);
        this.logger.log(`Blueprint generated: Template=${blueprint.template_id}, Items=${blueprint.items.length}`);
        this.logger.log(`Global Style: ${blueprint.global_style_prompt}`);
        blueprint.items.forEach((item, i) => {
            this.logger.log(`Item ${i + 1}: [${item.label_text}] ${item.subject_prompt}`);
        });

        // For this task, we stop here and return a placeholder as we are validating the blueprint logic.
        // The downstream rendering logic expects the old blueprint structure and would fail.
        return { url: 'https://placeholder.com/blueprint-verified.png' };
    }

    private async generateBlueprint(prompt: string): Promise<InfographicBlueprint> {
        if (!this.model) {
            throw new Error('Gemini API Key not configured for InfographicStrategy');
        }

        const systemPrompt = `
            You are an expert Information Designer and Visual Art Director.
            Analyze the user request and generate a cohesive visual blueprint for an infographic.

            User Request: "${prompt}"

            Output a strictly structured JSON object following this schema:
            {
                "template_id": "snake_process" | "hub_spoke" | "vertical_stack",
                "theme_color": "Hex code for primary accent (e.g., #FFD700)",
                "global_style_prompt": "A 20-word style glue string (e.g., 'minimalist 3D isometric, clay texture, soft lighting, professional matte white background') to ensure cohesion.",
                "items": [
                    {
                        "subject_prompt": "Specific visual subject for this step (e.g., 'a simple golden honeybee egg'). Keep it short.",
                        "label_text": "The text label for this step."
                    }
                ]
            }

            Cohesion Logic:
            - Ensure all 'items' share the same 'global_style_prompt' implicitly (the renderer will combine them).
            - 'subject_prompt' should strictly describe the object, not the style.
        `;

        try {
            const result = await this.model.generateContent(systemPrompt);
            const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(text) as InfographicBlueprint;

            // Basic validation
            if (!parsed.template_id || !parsed.items || !Array.isArray(parsed.items)) {
                throw new Error('Invalid JSON structure returned from LLM');
            }

            return parsed;
        } catch (e) {
            this.logger.error('Failed to generate blueprint', e);
            throw new Error('Blueprint generation failed');
        }
    }
}
