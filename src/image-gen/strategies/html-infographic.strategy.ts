import { Injectable, Logger } from '@nestjs/common';
import { BaseImageStrategy, ImageGenerationResult } from '../base-image.strategy';
import { ImageTask } from '../image-task.schema';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

export interface HtmlInfographicBlueprint {
    template_id: 'hub_radial' | 'step_list';
    theme_accent: string;
    items: {
        title: string;
        description: string;
    }[];
}

@Injectable()
export class HtmlInfographicStrategy extends BaseImageStrategy {
    private model: GenerativeModel;

    constructor(
        protected readonly configService: ConfigService,
    ) {
        super();
        const apiKey = this.configService.get<string>('GEMINI_API_KEY');
        if (apiKey) {
            const genAI = new GoogleGenerativeAI(apiKey);
            this.model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        } else {
            this.logger.warn('GEMINI_API_KEY not found. Blueprint generation will fail.');
        }
    }

    protected async performGeneration(task: ImageTask, index?: number): Promise<ImageGenerationResult> {
        this.logger.log(`Starting HTML Infographic Generation for: ${task.refined_prompt}`);

        // 1. Generate Blueprint via LLM
        let blueprint: HtmlInfographicBlueprint;
        try {
            blueprint = await this.generateBlueprint(task.refined_prompt);
            this.logger.log(`Blueprint generated: Template=${blueprint.template_id}, Items=${blueprint.items.length}`);
        } catch (error) {
            this.logger.error(`Blueprint generation failed: ${error.message}`);
            // Fallback or rethrow? 
            // For now rethrow as we can't proceed without a valid template/content
            throw error;
        }

        // 2. Load Template
        const templateContent = this.loadTemplate(blueprint.template_id);
        this.logger.log(`Template '${blueprint.template_id}' loaded successfully.`);

        // 3. Populate Template (Mock for now, will be detailed in next step)
        // Demonstration of jsdom manipulation (requirement)
        const dom = new JSDOM(templateContent);
        const document = dom.window.document;
        const title = document.querySelector('h1');
        if (title) {
            // Basic title update if we had valid title data (not in current blueprint spec, but good practice)
            // title.textContent = task.refined_prompt.substring(0, 20).toUpperCase(); 
        }

        return {
            url: 'placeholder_url_until_rendering_is_implemented', // Will be implemented in future steps
            posterUrl: 'placeholder_poster_url',
            payload: { blueprint }
        };
    }

    public async generateBlueprint(prompt: string): Promise<HtmlInfographicBlueprint> {
        if (!this.model) {
            throw new Error('Gemini API Key not configured/found.');
        }

        const systemPrompt = `
            You are an expert Data Visualization Architect.
            Your goal is to select the perfect infographic template and generate structured content based on user intent.

            Available Templates:
            1. 'hub_radial': Use this for lists of items centered around one core topic (e.g., "Top 5 NBA Players", "Key features of a car").
            2. 'step_list': Use this for sequential processes, timelines, or guides (e.g., "How to grow a tree", "The lifecycle of a star").

            User Request: "${prompt}"

            Task:
            1. Analyze the User Request to determine the most suitable template ('hub_radial' or 'step_list').
            2. Generate a widely compatible accent color (hex code) that fits the mood.
            3. Create a list of 4-6 items. Each item must have:
               - title: A short, punchy header (2-5 words).
               - description: A concise explanation (approx 30 words).

            Output strict JSON:
            {
                "template_id": "hub_radial" | "step_list",
                "theme_accent": "#HEXCODE",
                "items": [
                    { "title": "...", "description": "..." }
                ]
            }
        `;

        try {
            const result = await this.model.generateContent(systemPrompt);
            const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(text) as HtmlInfographicBlueprint;

            // Basic Validation
            if (!['hub_radial', 'step_list'].includes(parsed.template_id)) {
                // Fallback or correct? Let's just default to step_list if hallucinated
                this.logger.warn(`Invalid template_id '${parsed.template_id}' returned. Defaulting to 'step_list'.`);
                parsed.template_id = 'step_list';
            }
            return parsed;
        } catch (e) {
            this.logger.error('Failed to generate blueprint via Gemini', e);
            throw new Error(`Blueprint generation failed: ${e.message} - ${JSON.stringify(e)}`);
        }
    }

    public loadTemplate(id: string): string {
        const templatesDir = path.join(process.cwd(), 'public', 'assets', 'infographics', 'templates');
        let filename = `${id}.html`;
        const filePath = path.join(templatesDir, filename);

        if (!fs.existsSync(filePath)) {
            throw new Error(`Template file not found: ${filePath}`);
        }

        return fs.readFileSync(filePath, 'utf-8');
    }
}
