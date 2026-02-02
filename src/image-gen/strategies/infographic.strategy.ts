import { Injectable } from '@nestjs/common';
import { BaseImageStrategy, ImageGenerationResult } from '../base-image.strategy';
import { ImageTask } from '../image-task.schema';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import * as d3 from 'd3';

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
                icon_keyword: string;
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

        // 2. Select Template
        const templatePath = this.selectTemplate(blueprint);
        this.logger.log(`Selected Template Path: ${templatePath}`);

        if (!templatePath) {
            return { url: `/generated-images/error-template-not-found.png` };
        }

        // 3. Populate Template (SVG Composition)
        const populatedSvg = this.populateTemplate(templatePath, blueprint);

        // 4. Save to Disk
        const outputFilename = `infographic-${task.id}-generated.svg`;
        const outputPath = path.join(process.cwd(), 'dist', 'public', 'generated-images', outputFilename);

        // Ensure directory exists
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        fs.writeFileSync(outputPath, populatedSvg);
        this.logger.log(`Generated Infographic saved to: ${outputPath}`);

        return { url: `/generated-images/${outputFilename}` };
    }

    private async generateBlueprint(prompt: string): Promise<InfographicBlueprint> {
        if (!this.model) {
            throw new Error('Gemini API Key not configured for InfographicStrategy');
        }

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

    private populateTemplate(templatePath: string, blueprint: InfographicBlueprint): string {
        try {
            const svgContent = fs.readFileSync(templatePath, 'utf-8');
            const dom = new JSDOM(svgContent);
            const document = dom.window.document;

            // 1. Map Global Content
            this.setText(document, 'title_0', blueprint.infographic.content.title);
            this.setText(document, 'desc_0', blueprint.infographic.content.subtitle);

            // 2. Loop Items
            blueprint.infographic.content.items.forEach((item, index) => {
                const i = index + 1; // 1-based IDs

                // Set Title
                this.setText(document, `title_${i}`, item.title);

                // Set Description (Smart Wrap)
                this.wrapText(document, `desc_${i}`, item.detail, 160);

                // Inject Icon
                this.injectIcon(document, `icon_${i}`, item.icon_keyword);

                // Emphasis
                if ((item as any).emphasis === 'highlight') {
                    const group = document.getElementById(`step_${i}`) || document.getElementById(`title_${i}`)?.parentElement;
                    if (group) {
                        group.setAttribute('class', (group.getAttribute('class') || '') + ' highlighted-step');
                    }
                }
            });

            return dom.window.document.body.innerHTML;

        } catch (e) {
            this.logger.error('Failed to populate template', e);
            throw e;
        }
    }

    private setText(document: Document, id: string, text: string) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    private wrapText(document: Document, id: string, text: string, maxWidth: number) {
        const el = document.getElementById(id);
        if (!el) return;

        el.textContent = ''; // Clear

        const words = text.split(/\s+/);
        let line: string[] = [];
        const lineHeight = 1.2; // em
        const charWidth = 7; // Heuristic

        const x = el.getAttribute('x') || '0';
        const y = el.getAttribute('y') || '0';

        let tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        tspan.setAttribute('x', x);
        tspan.setAttribute('dy', '0');
        el.appendChild(tspan);

        words.forEach(word => {
            line.push(word);
            const estimatedWidth = line.join(' ').length * charWidth;

            if (estimatedWidth > maxWidth && line.length > 1) {
                line.pop();
                tspan.textContent = line.join(' ');

                line = [word];
                tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                tspan.setAttribute('x', x);
                tspan.setAttribute('dy', `${lineHeight}em`);
                el.appendChild(tspan);
            }
            tspan.textContent = line.join(' ');
        });
    }

    private injectIcon(document: Document, id: string, keyword: string) {
        const container = document.getElementById(id);
        if (!container) return;

        const iconDir = path.join(process.cwd(), 'public', 'assets', 'icons');
        let iconPath = path.join(iconDir, `${keyword.toLowerCase()}.svg`);

        if (!fs.existsSync(iconPath)) {
            iconPath = path.join(iconDir, 'default.svg');
            if (!fs.existsSync(iconPath)) return;
        }

        const iconContent = fs.readFileSync(iconPath, 'utf-8');
        const pathMatch = iconContent.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
        if (pathMatch && pathMatch[1]) {
            container.innerHTML = pathMatch[1];
            container.setAttribute('transform', (container.getAttribute('transform') || '') + ' scale(1.5)');
        }
    }
}
