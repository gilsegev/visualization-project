import { Injectable, Logger } from '@nestjs/common';
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
    text_color: string;
    global_style_prompt: string;
    background_image_data?: string;
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
    // logger is inherited from BaseImageStrategy

    constructor(
        protected readonly configService: ConfigService,
        protected readonly localStorage: LocalStorageService,
        protected readonly browserService: BrowserService
    ) {
        // BaseImageStrategy (in base-image.strategy.ts) likely assumes no args or doesn't use DI in constructor?
        // Wait, viewing file 862: public abstract class BaseImageStrategy ... no constructor defined?
        // If it has no constructor, super() takes no args.
        // BUT Step 855 tried `super(configService, localStorage)` and got error "Expected 0 arguments, but got 2".
        // So checking 862 again: No constructor in BaseImageStrategy.
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
        const templateFile = 'snake_process.svg';
        const templatePath = path.join(process.cwd(), 'public', 'assets', 'infographics', 'templates', templateFile);

        this.logger.log(`Loading template from: ${templatePath}`);
        if (!fs.existsSync(templatePath)) {
            throw new Error(`Template file not found: ${templatePath}`);
        }

        const svgContent = fs.readFileSync(templatePath, 'utf-8');
        const dom = new JSDOM(svgContent, { contentType: 'image/svg+xml' });
        const document = dom.window.document;
        const svgElement = document.querySelector('svg');
        if (svgElement) {
            // 1. Full-Frame Scaling Attributes
            svgElement.setAttribute('width', '100%');
            svgElement.setAttribute('height', '100%');
            svgElement.setAttribute('preserveAspectRatio', 'xMidYMid slice');

            // 2. Inject Soft Shadow Filter
            let defs = svgElement.querySelector('defs');
            if (!defs) {
                defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                svgElement.prepend(defs);
            }
            const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
            filter.setAttribute('id', 'soft-shadow');
            filter.setAttribute('x', '-50%');
            filter.setAttribute('y', '-50%');
            filter.setAttribute('width', '200%');
            filter.setAttribute('height', '200%');
            filter.innerHTML = `
                <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="blur"/>
                <feOffset in="blur" dx="2" dy="2" result="offsetBlur"/>
                <feComponentTransfer>
                    <feFuncA type="linear" slope="0.3"/>
                </feComponentTransfer>
                <feMerge>
                    <feMergeNode in="offsetBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            `;
            defs.appendChild(filter);
        }

        // 3. Inject Background Layer (Layer 0)
        let bgElement: Element | null = null;
        if (blueprint.background_image_data && svgElement) {
            bgElement = document.createElementNS('http://www.w3.org/2000/svg', 'image');
            bgElement.setAttribute('id', 'background_layer');
            bgElement.setAttribute('x', '0');
            bgElement.setAttribute('y', '0');
            bgElement.setAttribute('width', '100%');
            bgElement.setAttribute('height', '100%');
            bgElement.setAttribute('preserveAspectRatio', 'xMidYMid slice');
            bgElement.setAttribute('href', blueprint.background_image_data);
            svgElement.prepend(bgElement);
        }

        // 4. Z-Index Correction: Move Connectors behind Step Groups
        const connectors = document.querySelectorAll('path');
        connectors.forEach(connector => {
            if (bgElement) {
                bgElement.after(connector);
            } else if (svgElement) {
                svgElement.prepend(connector);
            }
        });

        // 5. Apply Filter to Step Groups
        const stepGroups = document.querySelectorAll('g, text');
        stepGroups.forEach(el => {
            if (el.tagName === 'g' || el.classList.contains('step') || el.classList.contains('title')) {
                el.setAttribute('filter', 'url(#soft-shadow)');
            }
        });

        // 3.5 Inject Opacity Mask (After Background)
        if (blueprint.background_image_data && svgElement) {
            const bgLayer = svgElement.querySelector('#background_layer');
            if (bgLayer) {
                const mask = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                mask.setAttribute('width', '100%');
                mask.setAttribute('height', '100%');
                mask.setAttribute('fill', 'white');
                mask.setAttribute('fill-opacity', '0.3');
                bgLayer.after(mask);
            }
        }

        // 6. Strict Text Z-Index Layering
        const labelsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        labelsGroup.setAttribute('id', 'labels_foreground');
        svgElement?.appendChild(labelsGroup); // Append to end to be Top Layer

        // Inject images and text items
        blueprint.items.forEach((item, index) => {
            const i = index + 1;

            // Inject Image
            const imgId = `slot_img_${i}`;
            const imgElement = document.getElementById(imgId);
            if (imgElement && item.image_data) {
                imgElement.setAttribute('href', item.image_data);
            }

            // Inject Text
            const txtId = `slot_txt_${i}`;
            const txtElement = document.getElementById(txtId);
            if (txtElement) {
                txtElement.textContent = item.label_text;

                // Glassmorphism Wrapper
                const glassGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');

                // Estimate text width (rough heuristic)
                const charCount = item.label_text.length;
                const EstWidth = charCount * 12 + 40; // 12px per char + padding
                const EstHeight = 40;

                const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                bgRect.setAttribute('x', String(-(EstWidth / 2))); // Centered relative to text anchor
                bgRect.setAttribute('y', '-25'); // Offset to center vertically on text baseline
                bgRect.setAttribute('width', String(EstWidth));
                bgRect.setAttribute('height', String(EstHeight));
                bgRect.setAttribute('rx', '12'); // Rounded corners
                bgRect.setAttribute('fill', 'rgba(255, 255, 255, 0.6)'); // Glassy
                bgRect.setAttribute('stroke', 'rgba(255, 255, 255, 0.4)');
                bgRect.setAttribute('stroke-width', '1');
                glassGroup.innerHTML = ''; // Sanity
                glassGroup.appendChild(bgRect);

                // Clone text node to put inside group? 
                // Better: Move text node into group, but text has x/y coords?
                // The text element has x/y. If we wrap it, the group needs to be at that x/y, and text at 0,0?
                // Or we just append the rect BEFORE the text in the labelsGroup?
                // Actually, simpler: Wrapper Group at Text's position?
                // The ID is on the text element.
                // Let's create a group at the text's coordinate (x,y), then make text relative?
                // Extract X/Y from text
                const x = txtElement.getAttribute('x') || '0';
                const y = txtElement.getAttribute('y') || '0';

                glassGroup.setAttribute('transform', `translate(${x}, ${y})`);

                // Adjust text to be 0,0 relative to group
                txtElement.setAttribute('x', '0');
                txtElement.setAttribute('y', '0');
                txtElement.removeAttribute('id'); // Remove ID to avoid dupes? No, we are moving it.

                glassGroup.appendChild(txtElement);
                labelsGroup.appendChild(glassGroup); // Moves to foreground

                // Apply visual text color if specified
                if (blueprint.text_color) {
                    txtElement.setAttribute('fill', blueprint.text_color);
                    // Also try setting style directly as fill attribute might be overridden by CSS
                    txtElement.style.fill = blueprint.text_color;
                }
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
        return await this.browserService.screenshotSvg(finalSvg, 2048, 2048);
    }

    private async generateImages(blueprint: InfographicBlueprint): Promise<InfographicBlueprint> {
        const apiKey = this.configService.get<string>('SILICONFLOW_API_KEY');
        if (!apiKey) {
            this.logger.warn('SILICONFLOW_API_KEY not found. Skipping image generation.');
            return blueprint;
        }

        const endpoint = 'https://api.siliconflow.com/v1/images/generations';

        const limit = pLimit(2); // Limit concurrency

        // Prepare tasks: Items + 1 Background
        const tasks = [...blueprint.items.map(item => ({ type: 'item', data: item })), { type: 'background', data: null }];

        await Promise.all(tasks.map((task) => limit(async () => {
            let prompt = '';
            if (task.type === 'item') {
                prompt = `${blueprint.global_style_prompt}. ${(task.data as any).subject_prompt}`;
            } else {
                prompt = `${blueprint.global_style_prompt}. ${blueprint.global_style_prompt}, minimalist abstract bokeh texture, cinematic lighting, out of focus, no objects, harmonious with ${blueprint.theme_color}.`;
            }

            try {
                // Determine model from config or default to flux-schnell
                const model = 'black-forest-labs/FLUX.1-schnell';

                const response = await axios.post(
                    endpoint,
                    {
                        model: model,
                        prompt: prompt,
                        size: '512x512', // Standard OpenAI key
                        n: 1, // Standard OpenAI key
                        seed: Math.floor(Math.random() * 1000000)
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${apiKey}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 15000 // Increased timeout
                    }
                );

                // Silicon Flow (Flux) typically returns a URL
                const imageUrl = response.data?.data?.[0]?.url;

                if (imageUrl) {
                    // Fetch the image URL to get buffer
                    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
                    const base64 = `data:image/png;base64,${Buffer.from(imageResponse.data).toString('base64')}`;

                    if (task.type === 'item') {
                        (task.data as any).image_data = base64;
                    } else {
                        blueprint.background_image_data = base64;
                    }
                } else {
                    this.logger.warn(`No image URL returned for task type: ${task.type}`);
                }

            } catch (error) {
                this.logger.error(`Failed to generate image for task type "${task.type}": ${error.message} - ${error.response?.data ? JSON.stringify(error.response.data) : ''}`);
            }
        })));

        return blueprint;
    }

    private async generateBlueprint(prompt: string): Promise<InfographicBlueprint> {
        if (!this.model) {
            throw new Error('Gemini API Key not configured for InfographicStrategy');
        }

        const systemPrompt = `
            You are an expert Information Designer and Visual Art Director.
            Analyze the user request and generate a cohesive visual blueprint for an infographic.

            Style Guideline:
            - Target a "National Geographic Style Macro Photography" or "3D Scientific Illustration" aesthetic.
            - Ensure the 'global_style_prompt' strictly emphasizes a "soft blurred background" or "pure white background" to ensure the subject pops within the circular mask.

            User Request: "${prompt}"

            Output a strictly structured JSON object following this schema:
            {
                "template_id": "snake_process" | "hub_spoke" | "vertical_stack",
                "theme_color": "Hex code for primary accent (e.g., #FFD700)",
                "text_color": "Hex code for text labels (e.g., #FFFFFF for dark themes, #333333 for light themes). Must contrast with background.",
                "global_style_prompt": "A 20-word style glue string (e.g., 'macro photography, hyper-realistic, soft blurred background, cinematic lighting, national geographic style') to ensure cohesion.",
                "items": [
                    {
                        "subject_prompt": "Specific visual subject for this step (e.g., 'a simple golden honeybee egg on a leaf'). Keep it short.",
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

    private async generateWithBackoff(apiCall: () => Promise<any>, retries = 5, initialDelay = 3000): Promise<any> {
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
