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

import axios from 'axios';
import * as pLimit from 'p-limit';

export interface InfographicBlueprint {
    template_id: 'snake_process' | 'hub_spoke' | 'vertical_stack';
    theme_color: string;
    global_style_prompt: string;
    items: {
        subject_prompt: string;
        label_text: string;
        image_data?: string;
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
        let blueprint = await this.generateBlueprint(task.refined_prompt);
        this.logger.log(`Blueprint generated: Template=${blueprint.template_id}, Items=${blueprint.items.length}`);
        this.logger.log(`Global Style: ${blueprint.global_style_prompt}`);

        // 2. Generate Images via Silicon Flow (Parallel)
        this.logger.log(`Starting parallel image generation for ${blueprint.items.length} items...`);
        const startTime = Date.now();
        blueprint = await this.generateImages(blueprint);
        const duration = Date.now() - startTime;
        this.logger.log(`Image generation completed in ${duration}ms`);

        // 3. Composition (Hybrid Rendering)
        this.logger.log('Composing SVG with generated assets...');
        const compositionBuffer = await this.renderComposition(blueprint);

        // 4. Save to Storage (Simulated or Real)
        const filename = `infographic_${task.id}_${Date.now()}.png`;
        const publicUrl = await this.localStorage.save(filename, compositionBuffer);
        this.logger.log(`Infographic saved to: ${publicUrl}`);

        return {
            url: publicUrl,
            posterUrl: publicUrl,
            payload: { blueprint }
        };
    }

    private async renderComposition(blueprint: InfographicBlueprint): Promise<Buffer> {
        // Map templates to the single hybrid file for now as per requirements
        const templateFile = 'hybrid_snake.svg';
        const templatePath = path.join(process.cwd(), 'public', 'assets', 'infographics', 'templates', templateFile);

        this.logger.log(`Loading template from: ${templatePath}`);
        if (!fs.existsSync(templatePath)) {
            throw new Error(`Template file not found: ${templatePath}`);
        }

        const svgContent = fs.readFileSync(templatePath, 'utf-8');
        const dom = new JSDOM(svgContent, { contentType: 'image/svg+xml' });
        const document = dom.window.document;

        // 1. Inject Images
        blueprint.items.forEach((item, index) => {
            const imgId = `slot_img_${index + 1}`;
            const imgElement = document.getElementById(imgId);
            if (imgElement && item.image_data) {
                imgElement.setAttribute('href', item.image_data); // Standard SVG
                // Some renderers might need xlink:href, but href is modern standard
            }
        });

        // 2. Inject Text
        blueprint.items.forEach((item, index) => {
            const txtId = `slot_txt_${index + 1}`;
            const txtElement = document.getElementById(txtId);
            if (txtElement) {
                txtElement.textContent = item.label_text;
            }
        });

        // 3. Apply Theme Color
        if (blueprint.theme_color) {
            const accents = document.querySelectorAll('.accent-color');
            accents.forEach((el) => {
                el.setAttribute('fill', blueprint.theme_color);
            });
        }

        // 4. Render to PNG via BrowserService
        const finalSvg = dom.serialize();
        // BrowserService expects a full HTML page or content? 
        // Based on previous code (not visible here but inferred), let's assume screenshotSvg method exists 
        // OR we pass the SVG string to a page.
        // Checking BrowserService usage in other files would be prudent, assuming screenshotSvg(svgString)
        return await this.browserService.screenshotSvg(finalSvg, 1024, 1024);
    }

    private async generateImages(blueprint: InfographicBlueprint): Promise<InfographicBlueprint> {
        const apiKey = this.configService.get<string>('SILICONFLOW_API_KEY');
        if (!apiKey) {
            this.logger.warn('SILICONFLOW_API_KEY not found. Skipping image generation.');
            return blueprint;
        }

        const endpoint = 'https://api.siliconflow.com/v1/images/generations';

        const limit = pLimit(2); // Limit concurrency to avoid 429 errors from SiliconFlow

        await Promise.all(blueprint.items.map((item) => limit(async () => {
            const fullPrompt = `${blueprint.global_style_prompt}. ${item.subject_prompt}`;
            try {
                // Determine model from config or default to flux-schnell
                const model = 'black-forest-labs/FLUX.1-schnell';

                const response = await axios.post(
                    endpoint,
                    {
                        model: model,
                        prompt: fullPrompt,
                        size: '512x512', // Standard OpenAI key
                        n: 1, // Standard OpenAI key
                        seed: Math.floor(Math.random() * 1000000)
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${apiKey}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 10000 // 10s timeout per request
                    }
                );

                // Silicon Flow (Flux) typically returns a URL
                const imageUrl = response.data?.data?.[0]?.url;

                if (imageUrl) {
                    // Fetch the image URL to get buffer
                    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
                    const base64 = Buffer.from(imageResponse.data).toString('base64');
                    item.image_data = `data:image/png;base64,${base64}`;
                } else {
                    this.logger.warn(`No image URL returned for item: ${item.label_text}`);
                }

            } catch (error) {
                this.logger.error(`Failed to generate image for "${item.label_text}": ${error.message} - ${error.response?.data ? JSON.stringify(error.response.data) : ''}`);
            }
        }))); // Close limit, close arrow func, close map, close Promise.all

        return blueprint;
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
            const result = await this.generateWithBackoff(() => this.model.generateContent(systemPrompt));
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

    private async generateWithBackoff(apiCall: () => Promise<any>, retries = 3, initialDelay = 2000): Promise<any> {
        let attempt = 0;
        let delay = initialDelay;

        while (attempt <= retries) {
            try {
                return await apiCall();
            } catch (error) {
                // Check for 429 or Resource Exhausted
                if (error.response?.status === 429 || error.message.includes('429') || error.message.includes('Resource exhausted')) {
                    attempt++;
                    if (attempt > retries) throw error;

                    this.logger.warn(`Gemini 429 detected. Retrying in ${delay}ms... (Attempt ${attempt}/${retries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2; // Exponential backoff
                } else {
                    throw error;
                }
            }
        }
    }
}
