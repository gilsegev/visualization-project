
import { Injectable, Logger } from '@nestjs/common';
import { BaseImageStrategy, ImageGenerationResult } from '../base-image.strategy';
import { ImageTask } from '../image-task.schema';
import { TemplateStampingService } from '../services/template-stamping.service';
import { BrowserService } from '../browser.service';
import { LocalStorageService } from '../local-storage.service';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { HtmlInfographicBlueprint } from './DEPRECATED_jsdom-infographic.strategy'; // Reuse type for now
import { performance } from 'perf_hooks';
import { THEME_LIBRARY, Theme } from '../themes.config';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class TemplateStampingStrategy extends BaseImageStrategy {
    private openai: OpenAI;

    constructor(
        private readonly stampingService: TemplateStampingService,
        private readonly browserService: BrowserService,
        private readonly localStorage: LocalStorageService,
        private readonly configService: ConfigService,
    ) {
        super();
        const apiKey = this.configService.get<string>('OPENROUTER_API_KEY');
        this.openai = new OpenAI({
            apiKey: apiKey,
            baseURL: 'https://openrouter.ai/api/v1',
            defaultHeaders: {
                'HTTP-Referer': 'https://visualization-project.local',
                'X-Title': 'Visualization Project Infographic Generator'
            }
        });
    }

    public async performGeneration(task: ImageTask, index?: number): Promise<ImageGenerationResult> {
        const metrics = {
            start: performance.now(),
            blueprint: 0,
            images: 0,
            stamping: 0,
            browser: 0,
            total: 0
        };

        this.logger.log(`[StampingStrategy] Starting generation for: ${task.refined_prompt}`);

        // 1. Generate Blueprint
        const blueprintStart = performance.now();
        const blueprint = await this.generateBlueprint(task.refined_prompt);
        // Inject Radius Override if present in Task Metadata (Phase 3)
        if ((task as any).metadata?.radius) {
            (blueprint as any).radius = (task as any).metadata.radius;
        }

        metrics.blueprint = performance.now() - blueprintStart;
        this.logger.log(`Blueprint generated in ${metrics.blueprint.toFixed(2)}ms`);

        // 1.5 Image Generation & Asset Management
        const imagesStart = performance.now();
        this.logger.log('[StampingStrategy] Starting parallel image generation...');

        // Refinement 5: Structured File Organization
        const dateStr = new Date().toISOString().split('T')[0];
        const taskAny = task as any;
        const courseId = taskAny.metadata?.course_id || 'uncategorized_course';
        const lessonId = taskAny.metadata?.lesson_id || 'uncategorized_lesson';
        const taskId = task.id || `task-${Date.now()}`;

        // e.g. 2026-02-14/course-1/lesson-2/task-123/
        const relativeOutputDir = path.join(dateStr, courseId, lessonId, taskId);
        this.logger.log(`[StampingStrategy] Output Context: ${relativeOutputDir}`);

        // Resolve Theme
        let theme: Theme;
        if (taskAny.metadata?.custom_theme) {
            theme = taskAny.metadata.custom_theme as Theme;
        } else {
            theme = THEME_LIBRARY[blueprint.theme_id] || THEME_LIBRARY['corp_blue'];
        }

        // Dispatch based on Template ID
        if (blueprint.template_id === 'versus_split') {
            return this.handleVersusSplit(task, blueprint, relativeOutputDir, theme, metrics);
        }
        if (blueprint.template_id === 'steps' || blueprint.template_id === 'step_list') {
            return this.handleSteps(task, blueprint, relativeOutputDir, theme, metrics);
        }

        // Default: Hub/Radial Logic


        // Generate Spoke Images
        const itemImagePromises = blueprint.items.map((item, idx) =>
            // Refinement 6: Use Descripton ONLY (No Title)
            this.generateImage(`minimalist visual representation of ${item.description}`, theme, false)
                .then(async (base64) => {
                    if (!base64) return { index: idx, url: '' };
                    const buffer = Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
                    const assetFilename = `spoke_${idx}.png`;

                    // Save to structured directory
                    await this.localStorage.save(path.join(relativeOutputDir, 'assets', assetFilename), buffer);

                    // Relative path for HTML (siblings: index.html is in relativeOutputDir, assets is in relativeOutputDir/assets)
                    return { index: idx, url: `./assets/${assetFilename}` };
                })
                .catch(err => {
                    this.logger.error(`[ImageGen] Item ${idx} failed: ${err.message}`);
                    throw new Error(`Critical Asset Generation Failed: ${err.message}`);
                })
        );

        // Refinement 4: Generate Center Hub Image
        const centerImagePromise = this.generateImage(
            `${blueprint.center_topic.title}: ${blueprint.center_topic.description} abstract serene background, soft lighting, ${theme.primary_accent} and ${theme.background_main} tones`,
            theme,
            true // isBackground
        ).then(async (base64) => {
            if (!base64) return null;
            const buffer = Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
            const assetFilename = `center_hub.png`;

            await this.localStorage.save(path.join(relativeOutputDir, 'assets', assetFilename), buffer);
            return `./assets/${assetFilename}`;
        }).catch(err => {
            this.logger.warn(`[ImageGen] Center image failed (non-critical): ${err.message}`);
            return null;
        });

        const results = await Promise.all(itemImagePromises);
        const centerImageUrl = await centerImagePromise;

        // Update Blueprint with Local URLs
        results.forEach(res => {
            if (res.url && blueprint.items[res.index]) {
                (blueprint.items[res.index] as any).image_url = res.url;
            }
        });

        if (centerImageUrl) {
            console.log(`[StampingStrategy] Injecting Center Image URL: ${centerImageUrl}`);
            (blueprint.center_topic as any).image_url = centerImageUrl;
        } else {
            console.warn('[StampingStrategy] No Center Image URL generated.');
        }

        metrics.images = performance.now() - imagesStart;
        this.logger.log(`Image generation & asset saving completed in ${metrics.images.toFixed(2)}ms`);


        // 2. Stamp Template
        const stampingStart = performance.now();
        const finalHtml = this.stampingService.stamp(blueprint.template_id, blueprint);
        metrics.stamping = performance.now() - stampingStart;
        this.logger.log(`Template stamped in ${metrics.stamping.toFixed(2)}ms`);

        // 3. Browser Screenshot (Re-enabled per 2.md)
        const browserStart = performance.now();

        // Refinement 5: Update Base URL to the specific task directory
        const taskBaseUrl = path.join(process.cwd(), 'public', 'generated-images', relativeOutputDir);
        const screenshotBuffer = await this.browserService.screenshotHtml(finalHtml, taskBaseUrl);

        metrics.browser = performance.now() - browserStart;
        this.logger.log(`Screenshot taken in ${metrics.browser.toFixed(2)}ms`);

        // Inject Viewport Constraints
        const fixedHtml = finalHtml.replace('</head>', `
    <style>
        body { width: 1200px !important; height: 1200px !important; overflow: hidden !important; }
    </style>
</head>`);

        metrics.total = performance.now() - metrics.start;

        // Save Results in Structured Directory
        const publicUrl = await this.localStorage.save(path.join(relativeOutputDir, 'poster.png'), screenshotBuffer);

        // Save Debug HTML
        await this.localStorage.save(path.join(relativeOutputDir, 'index.html'), Buffer.from(fixedHtml));
        await this.localStorage.save(path.join(relativeOutputDir, 'blueprint.json'), Buffer.from(JSON.stringify(blueprint, null, 2)));

        return {
            url: publicUrl,
            posterUrl: publicUrl,
            payload: {
                blueprint,
                html: fixedHtml,
                metrics: {
                    blueprint_ms: metrics.blueprint.toFixed(2),
                    images_ms: metrics.images.toFixed(2),
                    stamping_ms: metrics.stamping.toFixed(2),
                    browser_ms: metrics.browser.toFixed(2),
                    total_ms: metrics.total.toFixed(2)
                }
            }
        };
    }

    // Duplicated from HtmlInfographicStrategy for independence, or could be extracted to a shared service
    private async generateBlueprint(prompt: string): Promise<HtmlInfographicBlueprint> {
        // Reuse existing logic or simplified logic
        const systemPrompt = `You are an expert Data Visualization Architect.
Goal: Select template, define style, generate structured content.

Templates: 'hub_radial' (circular hub), 'step_list' (vertical sequence), 'step_stone' (zigzag path), 'bento_grid' (grid), 'versus_split' (comparison).
Themes: 'cyber_neon', 'corp_blue', 'nature_fresh', 'warm_creative'.

Task:
1. Select Template & Theme.
2. Generate Items (3-9 normal).
3. FOR STEP_LIST: Use this for vertical "roadmaps" or lists. Use '|' to separate stage name from description.
4. FOR STEP_STONE: Zigzag path.
5. FOR VERSUS_SPLIT: Comparison between two entities.
    - "versus_subjects": [ { "name": "Left Entity", "description": "..." }, { "name": "Right Entity", "description": "..." } ]
    - "items": [ { "icon": "sword", "left": { "value": "100", "description": "High" }, "right": { "value": "50", "description": "Low" } } ]
    - "verdict": { "title": "Winner", "text": "Conclusion..." }
    - "center_topic": { "title": "Main Comparison Title", "description": "Subtitle" }
6. FOR STEPS (or step_list): Progressive list/journey.
    - "items": [ { "title": "Step 01", "description": "..." }, ... ] (3-5 items)
    - "center_topic": { "title": "Journey Title", "description": "Subtitle" }
    - "visual_style_directive": "Description for background image (e.g. minimalist nature landscape)"

OUTPUT VALID JSON ONLY:
{
  "template_id": "...",
  "theme_id": "...",
  "center_topic": { "title": "...", "description": "..." },
  "items": [ { "title": "...", "description": "...", "left": {...}, "right": {...} } ],
  "versus_subjects": [ ... ],
  "verdict": { ... }
}`;

        try {
            const model = this.configService.get<string>('OPENROUTER_MODEL') || 'google/gemini-2.0-flash-001';
            const response = await this.openai.chat.completions.create({
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 2000
            });

            const content = response.choices[0]?.message?.content || '{}';
            const text = content.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(text) as HtmlInfographicBlueprint;

            // Validate Theme
            if (!THEME_LIBRARY[parsed.theme_id]) parsed.theme_id = 'corp_blue';

            return parsed;
        } catch (e) {
            this.logger.error('Blueprint Generation Failed', e);
            throw e;
        }
    }

    // Copied from DEPRECATED_jsdom-infographic.strategy.ts
    private async generateImage(prompt: string, theme: Theme, isBackground: boolean): Promise<string> {
        const apiKey = this.configService.get<string>('SILICONFLOW_API_KEY');
        if (!apiKey) return ""; // Return empty if no key

        // Atomic "Sticker-Style" Prompt Construction
        let fullPrompt = '';
        if (isBackground) {
            // Refinement 8: Use the prompt for the center image background, but keep it abstract/soft
            fullPrompt = `soft abstract background for ${prompt}, minimalist, high resolution, subtle grain, elegant, ${theme.background_main} tones --no text, letters, numbers, typography, writing, busy patterns, realistic photos`;
        } else {
            // "Sticker" Rule: Isolated on white, flat vector, matching theme accent
            // Refinement 6: Strong Negative Prompting for Text
            fullPrompt = `${prompt}, ${theme.image_style_suffix}, flat vector icon style, isolated on white background, matching ${theme.primary_accent} color --no text, letters, numbers, typography, writing, shadows, blurry, complex background, 3d, realistic, photo`;
        }

        try {
            const response = await axios.post(
                'https://api.siliconflow.com/v1/images/generations',
                {
                    model: 'black-forest-labs/FLUX.1-schnell',
                    prompt: fullPrompt,
                    image_size: '512x512',
                    num_inference_steps: 4,
                    batch_size: 1
                },
                { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 }
            );

            const imageUrl = response.data?.data?.[0]?.url;
            if (imageUrl) {
                const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
                return `data:image/jpeg;base64,${Buffer.from(imageResponse.data).toString('base64')}`;
            }
            throw new Error('No image URL returned from SiliconFlow');
        } catch (e) {
            this.logger.error(`Image Gen Failed: ${e.message}`);
            // Refinement 3.1: Strict Error Handling - Fail if asset generation fails
            throw new Error(`Critical Asset Generation Failed: ${e.message}`);
        }
    }


    private async handleVersusSplit(task: ImageTask, blueprint: any, relativeOutputDir: string, theme: Theme, metrics: any): Promise<ImageGenerationResult> {
        const imagesStart = performance.now();
        this.logger.log('[StampingStrategy] Handling Versus Split Template...');

        // 1. Generate Subject Images (Left & Right)
        const subjects = blueprint.versus_subjects || [{ name: 'Left' }, { name: 'Right' }];
        const imagePromises = subjects.map(async (subj, idx) => {
            const side = idx === 0 ? 'left' : 'right';
            const prompt = `Vertical portrait of ${subj.name}, ${subj.description || ''}, ${theme.image_style_suffix}, high contrast, isolated, ${theme.primary_accent} lighting --no text`;

            try {
                // Use isBackground=false logic for subjects? Or custom? Using false (sticker/character style)
                const base64 = await this.generateImage(prompt, theme, false);
                if (!base64) return null;

                const buffer = Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
                const filename = `vs_${task.id}_${side}.png`;
                await this.localStorage.save(path.join(relativeOutputDir, 'assets', filename), buffer);

                // Update blueprint URL
                subj.image_url = `./assets/${filename}`;
                return subj.image_url;
            } catch (e) {
                this.logger.error(`Versus Image ${side} failed: ${e.message}`);
                return null;
            }
        });

        await Promise.all(imagePromises);

        // 1.5 Generate Item Icons (Parallel)
        this.logger.log('[StampingStrategy] Generating Versus Item Icons...');
        const iconPromises = blueprint.items.map(async (item, idx) => {
            // Priority: Explicit Icon Name > Left Value > Generic
            const iconPrompt = item.icon && item.icon.length > 2
                ? item.icon
                : `${item.left?.value || 'concept'} vs ${item.right?.value || 'concept'}`;

            const prompt = `Simple flat vector icon of ${iconPrompt}, black lines on white background, minimalist, bold, isolated --no text`;

            try {
                // Use a modified theme or specific style for icons? 
                // We want them to match the "yellow squared" look or just be the content inside?
                // The template has a yellow background, so we probably want a transparent or matching icon.
                // The template uses .row-icon yellow background. So we need a transparent PNG or just a simple icon on white/yellow.
                // Let's try to generate an icon with a solid background or transparent. 
                // Since our generator usually does white background, we might need mix-blend-mode multiply in CSS if it's white.
                // Or we generate on yellow #FFD100.

                // Let's rely on the strategy's standard generation but force a specific style.
                // Actually, `generateImage` uses white background by default.
                // Let's stick effectively to "isolated on white" and rely on `mix-blend-mode` if needed, OR 
                // simply generate a square icon that FILLS the container.
                const base64 = await this.generateImage(prompt, theme, false);
                if (!base64) return;

                const buffer = Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
                const filename = `vs_icon_${task.id}_${idx}.png`;
                await this.localStorage.save(path.join(relativeOutputDir, 'assets', filename), buffer);

                (item as any).icon_url = `./assets/${filename}`;
            } catch (e) {
                this.logger.warn(`Versus Icon ${idx} failed: ${e.message}`);
            }
        });

        await Promise.all(iconPromises);

        metrics.images = performance.now() - imagesStart;

        // 2. Stamp Template
        const stampingStart = performance.now();
        // Versus uses the same stamping service, which replaces /* INSERT_JSON_HERE */
        // We ensure blueprint matches the schema expected by versus_split.html render()
        // Schema: { subjects: [...], items: [...], verdict: {...} }
        const payload = {
            subjects: blueprint.versus_subjects,
            items: blueprint.items,
            center: blueprint.center_topic, // Title/Subtitle often mapped here
            verdict: blueprint.verdict
        };

        const finalHtml = this.stampingService.stamp('versus_split', payload);
        metrics.stamping = performance.now() - stampingStart;

        // 3. Screenshot
        const browserStart = performance.now();
        const taskBaseUrl = path.join(process.cwd(), 'public', 'generated-images', relativeOutputDir);
        const screenshotBuffer = await this.browserService.screenshotHtml(finalHtml, taskBaseUrl);
        metrics.browser = performance.now() - browserStart;

        // 4. Save
        const publicUrl = await this.localStorage.save(path.join(relativeOutputDir, 'poster.png'), screenshotBuffer);
        await this.localStorage.save(path.join(relativeOutputDir, 'index.html'), Buffer.from(finalHtml));
        await this.localStorage.save(path.join(relativeOutputDir, 'blueprint.json'), Buffer.from(JSON.stringify(blueprint, null, 2)));

        metrics.total = performance.now() - metrics.start;

        return {
            url: publicUrl,
            posterUrl: publicUrl,
            payload: { blueprint, html: finalHtml, metrics }
        };
    }

    private async handleSteps(task: ImageTask, blueprint: any, relativeOutputDir: string, theme: Theme, metrics: any): Promise<ImageGenerationResult> {
        const imagesStart = performance.now();
        this.logger.log('[StampingStrategy] Handling Steps Template...');

        // 1. Generate Background Image
        // Use visual_style_directive or theme + title
        const bgPrompt = blueprint.visual_style_directive || `${blueprint.center_topic.title} background, ${theme.background_main} tones, soft focus, minimalist, high resolution`;

        try {
            const bgBase64 = await this.generateImage(bgPrompt, theme, true); // isBackground=true
            if (bgBase64) {
                const buffer = Buffer.from(bgBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
                const filename = `background.png`;
                await this.localStorage.save(path.join(relativeOutputDir, 'assets', filename), buffer);
                blueprint.background_url = `./assets/${filename}`;
            }
        } catch (e) {
            this.logger.warn(`[Steps] Background generation failed: ${e.message}`);
        }

        // 2. Generate Step Images
        const imagePromises = blueprint.items.map(async (item, idx) => {
            // Refinement: Remove Title to prevent text bleeding. Use description only.
            const prompt = `Symbolic visual representation of ${item.description}, ${theme.image_style_suffix}, flat vector art, iconic style, isolated on white, ${theme.primary_accent} --no text, letters, words, typography, writing, numbers, labels, watermark`;
            try {
                const base64 = await this.generateImage(prompt, theme, false);
                if (!base64) return;

                const buffer = Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
                const filename = `step_${task.id}_${idx}.png`;
                await this.localStorage.save(path.join(relativeOutputDir, 'assets', filename), buffer);

                (item as any).image_url = `./assets/${filename}`;
            } catch (e) {
                this.logger.error(`[Steps] Item ${idx} image failed: ${e.message}`);
            }
        });

        await Promise.all(imagePromises);
        metrics.images = performance.now() - imagesStart;

        // 3. Stamp Template
        const stampingStart = performance.now();
        // Steps template expects: { background_url, center: { title, subtitle }, items: [...] }
        const finalHtml = this.stampingService.stamp('steps', blueprint);
        metrics.stamping = performance.now() - stampingStart;

        // 4. Screenshot & Save
        const browserStart = performance.now();
        const taskBaseUrl = path.join(process.cwd(), 'public', 'generated-images', relativeOutputDir);
        const screenshotBuffer = await this.browserService.screenshotHtml(finalHtml, taskBaseUrl);
        metrics.browser = performance.now() - browserStart;

        const publicUrl = await this.localStorage.save(path.join(relativeOutputDir, 'poster.png'), screenshotBuffer);
        await this.localStorage.save(path.join(relativeOutputDir, 'index.html'), Buffer.from(finalHtml));
        await this.localStorage.save(path.join(relativeOutputDir, 'blueprint.json'), Buffer.from(JSON.stringify(blueprint, null, 2)));

        metrics.total = performance.now() - metrics.start;

        return {
            url: publicUrl,
            posterUrl: publicUrl,
            payload: { blueprint, html: finalHtml, metrics }
        };
    }
}
