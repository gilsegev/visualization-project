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

    constructor(
        private readonly browserService: BrowserService,
        private readonly localStorage: LocalStorageService
    ) {
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

        // 4. Determine Format
        const exportType = 'exportType' in task ? task.exportType : 'static'; // Fallback
        const payload = task.payload as any || {};
        const format = payload.format || exportType;
        const isAnimated = format === 'animated';

        // 5. Render
        let result: ImageGenerationResult;

        if (isAnimated) {
            this.logger.log(`[DEBUG] Task ${task.id}: Rendering Infographic Video & Poster...`);
            const posterUrl = await this.renderToPng(populatedSvg, task.id, false);
            const videoUrl = await this.renderToVideo(populatedSvg, task.id);
            result = { url: videoUrl, posterUrl };
        } else {
            this.logger.log(`[DEBUG] Task ${task.id}: Rendering Infographic Static PNG...`);
            const url = await this.renderToPng(populatedSvg, task.id, false);
            result = { url };
        }

        return result;
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

            // 1. Aesthetics Injection
            const palette = getPalette(blueprint.infographic.visual_hints.mood);
            this.injectStyles(document, palette);
            this.injectPaperFilter(document);

            // 2. Map Global Content
            this.setText(document, 'title_0', blueprint.infographic.content.title);
            this.setText(document, 'desc_0', blueprint.infographic.content.subtitle);

            // 3. Loop Items
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

                        // Add roughness to highlighted node
                        this.applyRoughnessToElement(document, group);
                    }
                }
            });

            // 4. Apply Roughness to Connectors
            this.applyRoughnessToConnectors(document);

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

    private injectStyles(document: Document, palette: any) {
        const style = document.createElement('style');
        style.textContent = `
            :root {
                --primary: ${palette.primary};
                --secondary: ${palette.secondary};
                --accent: ${palette.accent};
                --bg-color: ${palette.background};
                --text-color: ${palette.text};
                --stroke-color: ${palette.stroke};
            }
            .highlighted-step circle, .highlighted-step rect {
                stroke: var(--accent);
                stroke-width: 4px;
                filter: drop-shadow(0 0 5px var(--accent));
            }
            text { font-family: 'Inter', sans-serif; fill: var(--text-color); }
        `;
        document.querySelector('svg')?.prepend(style);

        let bgRect = document.querySelector('rect[width="100%"]');
        if (!bgRect) {
            bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bgRect.setAttribute('width', '100%');
            bgRect.setAttribute('height', '100%');
            document.querySelector('svg')?.prepend(bgRect);
        }
        bgRect.setAttribute('fill', 'var(--bg-color)');
        bgRect.setAttribute('filter', 'url(#paper-grain)');
    }

    private injectPaperFilter(document: Document) {
        const defs = document.querySelector('defs') || document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        if (!document.querySelector('defs')) document.querySelector('svg')?.prepend(defs);

        const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
        filter.setAttribute('id', 'paper-grain');
        filter.innerHTML = `
            <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" result="noise" />
            <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.1 0" in="noise" result="coloredNoise" />
            <feComposite operator="in" in="coloredNoise" in2="SourceGraphic" result="composite" />
            <feBlend mode="multiply" in="composite" in2="SourceGraphic" />
        `;
        defs.appendChild(filter);
    }

    private applyRoughnessToConnectors(document: Document) {
        try {
            const svg = document.querySelector('svg');
            const lines = document.querySelectorAll('line');
            // JSDOM specific RoughJS usage
            // @ts-ignore
            const rc = rough.svg(svg as any);

            lines.forEach((line) => {
                const x1 = parseFloat(line.getAttribute('x1') || '0');
                const y1 = parseFloat(line.getAttribute('y1') || '0');
                const x2 = parseFloat(line.getAttribute('x2') || '0');
                const y2 = parseFloat(line.getAttribute('y2') || '0');

                const node = rc.line(x1, y1, x2, y2, {
                    stroke: 'var(--stroke-color)', strokeWidth: 2, roughness: 1.5, bowing: 2
                });
                line.replaceWith(node);
            });
        } catch (e) { }
    }

    private applyRoughnessToElement(document: Document, element: Element) {
        try {
            const svg = document.querySelector('svg');
            // @ts-ignore
            const rc = rough.svg(svg as any);

            const circles = element.querySelectorAll('circle');
            circles.forEach(circle => {
                const cx = parseFloat(circle.getAttribute('cx') || '0');
                const cy = parseFloat(circle.getAttribute('cy') || '0');
                const r = parseFloat(circle.getAttribute('r') || '0');

                const node = rc.circle(cx, cy, r * 2, {
                    stroke: 'var(--accent)', strokeWidth: 3, roughness: 2, fill: 'none'
                });
                circle.parentElement?.appendChild(node);
            });
        } catch (e) { }
    }

    private async renderToPng(svgContent: string, taskId: string, isAnimated: boolean): Promise<string> {
        const { context, page } = await this.browserService.getNewPage();

        try {
            await page.setContent(svgContent, { waitUntil: 'networkidle' });

            // Ensure SVG fills viewport
            await page.addStyleTag({ content: 'body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; } svg { width: 1024px; height: 1024px; }' });

            await page.waitForTimeout(500); // Wait for Rough.js / Filters

            const buffer = await page.screenshot({ type: 'png' });
            this.logger.log(`[AUDIT] Infographic PNG Buffer Size: ${buffer.length} bytes`);

            if (buffer.length === 0) {
                throw new Error('Screenshot buffer is empty');
            }

            const fileName = `infographic-${taskId}-${Date.now()}.png`;
            return await this.localStorage.upload(buffer, fileName);
        } finally {
            await page.close();
            await context.close();
        }
    }

    private async renderToVideo(svgContent: string, taskId: string): Promise<string> {
        const videoDir = path.resolve(process.cwd(), 'videos');
        const videoOptions = { recordVideo: { dir: videoDir, size: { width: 1024, height: 1024 } } };
        const { context, page } = await this.browserService.getNewPage(videoOptions);

        try {
            // Inject Animation CSS
            const animatedSvg = svgContent.replace('</svg>', `
                <style>
                    /* Simple Fade In Stagger */
                    g[id^="step_"], g[id^="title_"] { opacity: 0; animation: fadeIn 0.5s forwards; }
                    ${Array.from({ length: 10 }).map((_, i) => `g[id^="step_${i + 1}"] { animation-delay: ${i * 0.3}s; }`).join('\n')}
                    
                    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
                </style>
                </svg>
            `);

            await page.setContent(animatedSvg, { waitUntil: 'networkidle' });
            await page.addStyleTag({ content: 'body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; } svg { width: 1024px; height: 1024px; }' });

            // Record 2 seconds
            await page.waitForTimeout(2000);

            await page.close();
            await context.close();

            const videoPath = await page.video()?.path();
            if (!videoPath) throw new Error('Video file not found');

            this.logger.log(`[AUDIT] Raw Video Path: ${videoPath}`);

            const buffer = fs.readFileSync(videoPath);
            this.logger.log(`[AUDIT] Video Buffer Size: ${buffer.length} bytes`);

            const fileName = `infographic-${taskId}-${Date.now()}.mp4`;
            return await this.localStorage.upload(buffer, fileName);

        } catch (e) {
            await page.close().catch(() => { });
            await context.close().catch(() => { });
            throw e;
        }
    }
}
