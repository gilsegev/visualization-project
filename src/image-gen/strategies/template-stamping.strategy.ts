
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
import { ObservabilityGateway } from '../../observability/observability.gateway'; // Import Gateway

@Injectable()
export class TemplateStampingStrategy extends BaseImageStrategy {
    private openai: OpenAI;

    constructor(
        private readonly stampingService: TemplateStampingService,
        private readonly browserService: BrowserService,
        private readonly localStorage: LocalStorageService,
        private readonly configService: ConfigService,
        private readonly observability: ObservabilityGateway, // Inject Gateway
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
        this.observability.emitLog('info', `Starting generation task`, 'StampingStrategy', task.id);

        // 1. Generate Blueprint
        this.observability.emitProgress({ taskId: task.id, status: 'processing', stage: 'Blueprinting' });
        const blueprintStart = performance.now();
        const blueprint = await this.generateBlueprint(task.refined_prompt, task.id);
        // Inject Radius Override if present in Task Metadata (Phase 3)
        if ((task as any).metadata?.radius) {
            (blueprint as any).radius = (task as any).metadata.radius;
        }

        metrics.blueprint = performance.now() - blueprintStart;
        this.logger.log(`Blueprint generated in ${metrics.blueprint.toFixed(2)}ms`);
        this.observability.emitLog('info', `Blueprint generated in ${metrics.blueprint.toFixed(2)}ms`, 'StampingStrategy', task.id);

        // 1.5 Image Generation & Asset Management
        this.observability.emitProgress({ taskId: task.id, status: 'processing', stage: 'Generating Assets' });
        const imagesStart = performance.now();
        this.logger.log('[StampingStrategy] Starting parallel image generation...');
        const usedPrompts: string[] = [];

        // Refinement 5: Structured File Organization
        const dateStr = new Date().toISOString().split('T')[0];
        const taskAny = task as any;
        const courseId = taskAny.metadata?.course_id || 'uncategorized_course';
        const lessonId = taskAny.metadata?.lesson_id || 'uncategorized_lesson';
        const taskId = task.id || `task-${Date.now()}`;

        // e.g. 2026-02-14/course-1/lesson-2/task-123/
        // e.g. 2026-02-14/course-1/lesson-2/task-123/
        const relativeOutputDir = path.join(dateStr, courseId, lessonId, taskId);
        this.logger.log(`[StampingStrategy] Output Context: ${relativeOutputDir}`);
        this.observability.emitLog('info', `Output Context: ${relativeOutputDir}`, 'StampingStrategy', task.id);

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
            this.generateImage(`minimalist visual representation of ${item.description}`, theme, false, task.id)
                .then(async (result) => {
                    if (!result.url) return { index: idx, url: '', prompt: '' };
                    const buffer = Buffer.from(result.url.replace(/^data:image\/\w+;base64,/, ''), 'base64');
                    const assetFilename = `spoke_${idx}.png`;

                    // Save to structured directory
                    await this.localStorage.save(path.join(relativeOutputDir, 'assets', assetFilename), buffer);

                    // Relative path for HTML (siblings: index.html is in relativeOutputDir, assets is in relativeOutputDir/assets)
                    return { index: idx, url: `./assets/${assetFilename}`, prompt: result.prompt };
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
            true, // isBackground
            task.id
        ).then(async (result) => {
            if (!result.url) return null;
            const buffer = Buffer.from(result.url.replace(/^data:image\/\w+;base64,/, ''), 'base64');
            const assetFilename = `center_hub.png`;

            await this.localStorage.save(path.join(relativeOutputDir, 'assets', assetFilename), buffer);
            return { url: `./assets/${assetFilename}`, prompt: result.prompt };
        }).catch(err => {
            this.logger.warn(`[ImageGen] Center image failed (non-critical): ${err.message}`);
            return null;
        });

        const results = await Promise.all(itemImagePromises);
        const centerImageResult = await centerImagePromise;

        // Update Blueprint with Local URLs and Collect Prompts
        results.forEach(res => {
            if (res.url && blueprint.items[res.index]) {
                (blueprint.items[res.index] as any).image_url = res.url;
                usedPrompts.push(`Item ${res.index}: ${res.prompt}`);
            }
        });

        if (centerImageResult) {
            console.log(`[StampingStrategy] Injecting Center Image URL: ${centerImageResult.url}`);
            (blueprint.center_topic as any).image_url = centerImageResult.url;
            usedPrompts.push(`Center Hub: ${centerImageResult.prompt}`);
        } else {
            console.warn('[StampingStrategy] No Center Image URL generated.');
        }

        metrics.images = performance.now() - imagesStart;
        this.observability.emitLog('info', `Image generation & asset saving completed in ${metrics.images.toFixed(2)}ms`, 'StampingStrategy', task.id);


        // 2. Stamp Template
        this.observability.emitProgress({ taskId: task.id, status: 'processing', stage: 'Stamping HTML' });
        const stampingStart = performance.now();
        const finalHtml = this.stampingService.stamp(blueprint.template_id, blueprint);
        metrics.stamping = performance.now() - stampingStart;

        this.logger.log(`Template stamped in ${metrics.stamping.toFixed(2)}ms`);
        this.observability.emitLog('info', `Template stamped in ${metrics.stamping.toFixed(2)}ms`, 'StampingStrategy', task.id);

        // 3. Browser Screenshot (Re-enabled per 2.md)
        this.observability.emitProgress({ taskId: task.id, status: 'processing', stage: 'Finalizing Poster' });
        const browserStart = performance.now();

        // Refinement 5: Update Base URL to the specific task directory
        const taskBaseUrl = path.join(process.cwd(), 'public', 'generated-images', relativeOutputDir);

        // Handle Dimensions from Metadata
        const dimensions = (task as any).metadata?.dimensions || {};
        const width = dimensions.width || 1200;
        const height = dimensions.height || 1200;

        const screenshotBuffer = await this.browserService.screenshotHtml(finalHtml, taskBaseUrl, { width, height });

        metrics.browser = performance.now() - browserStart;
        this.logger.log(`Screenshot taken in ${metrics.browser.toFixed(2)}ms at ${width}x${height}`);
        this.observability.emitLog('info', `Screenshot taken in ${metrics.browser.toFixed(2)}ms`, 'StampingStrategy', task.id);

        // Inject Viewport Constraints matching the actual dimensions
        const fixedHtml = finalHtml.replace('</head>', `
    <style>
        body { width: ${width}px !important; height: ${height}px !important; overflow: hidden !important; }
    </style>
</head>`);

        metrics.total = performance.now() - metrics.start;

        // Calculate Bottleneck
        const timings = {
            'Blueprint Gen': metrics.blueprint,
            'Parallel Image Gen': metrics.images,
            'HTML Stamping': metrics.stamping,
            'Browser Capture': metrics.browser
        };
        const bottleneck = Object.entries(timings).reduce((a, b) => a[1] > b[1] ? a : b);

        this.logger.log(`
[Timing Signature] Task: ${task.id}
    Blueprint Gen: ${metrics.blueprint.toFixed(2)}ms
    Parallel Image Gen (SiliconFlow): ${metrics.images.toFixed(2)}ms
    HTML Stamping: ${metrics.stamping.toFixed(2)}ms
    Browser Capture (Playwright): ${metrics.browser.toFixed(2)}ms
    >> Primary Bottleneck: ${bottleneck[0]} (${bottleneck[1].toFixed(2)}ms)
`);

        // Save Results in Structured Directory
        const publicUrl = await this.localStorage.save(path.join(relativeOutputDir, 'poster.png'), screenshotBuffer);

        // Save Debug HTML
        await this.localStorage.save(path.join(relativeOutputDir, 'index.html'), Buffer.from(fixedHtml));
        await this.localStorage.save(path.join(relativeOutputDir, 'blueprint.json'), Buffer.from(JSON.stringify(blueprint, null, 2)));

        // 5. Return Result with Prompts
        // 5. Return Result with Prompts
        // usedPrompts populated in respective steps
        // Since we didn't store them in a persistent list during the parallel execution, we can either:
        // A) Refactor generateImage to push to a class-level list (bad for concurrency)
        // B) Return the prompt from generateImage (it returns string url currently)
        // C) Re-construct them here (risky if logic changes)
        // D) Attach them to the blueprint items themselves.

        // Let's go with D: We already attached `image_url` to items. We should have attached `image_prompt` too.
        // But `generateImage` is private. 

        // Actually, let's just capture the Blueprint Prompt for now, and rely on the fact that we can't easily get the image prompts retroactively without refactoring `handleVersusSplit` etc.
        // Wait, the user specifically asked for "text used to generate every image".

        // Let's do a quick refactor of `generateImage` to return `{ url: string, prompt: string }`? 
        // No, that breaks too many callers (`handleVersusSplit`, `handleSteps`).

        // Minimal invasive change:
        // The `metrics` object is a good place to stuff this for now, or just the payload.
        // I will add `image_prompts` to the payload.

        // I will rely on the `blueprint` to carry the descriptions which are essentially the prompts. 
        // But the user wants "what was asked vs what was created". 
        // "What was asked" = The text in the manifest (Task Description).
        // "What was created" = The Resulting Image.
        // The "Refined Prompt" (Blueprint Prompt) is the bridge.

        // I will capture the Blueprint Prompt.

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
                },
                output_dir: relativeOutputDir,
                // We'll populate this more fully in a future refactor if needed, 
                // but for now, the 'refined_prompt' in the task metadata (which we added to Intake) 
                // covers the 'Validation' aspect the user likely wants.
                blueprint_prompt: task.refined_prompt,
                image_prompts: usedPrompts
            }
        };
    }

    // Duplicated from HtmlInfographicStrategy for independence, or could be extracted to a shared service
    private async generateBlueprint(prompt: string, taskId: string): Promise<HtmlInfographicBlueprint> {
        // Reuse existing logic or simplified logic
        const systemPrompt = `You are an expert Data Visualization Architect.
Goal: Select template, define style, generate structured content.

CRITICAL: Strict Text Preservation.
- You must use the EXACT text provided in the user prompt for titles and descriptions.
- Do NOT summarize, truncate, or rephrase the core content unless explicitly asked.
- Map the provided "items" directly to the template structure.

Templates: 'hub_radial' (circular hub), 'step_list' (vertical sequence), 'step_stone' (zigzag path), 'bento_grid' (grid), 'versus_split' (comparison), 'steps' (progressive list).
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
                temperature: 0.2, // Lower temperature for stricter adherence
                max_tokens: 2000
            });
            this.observability.emitLog('info', `Blueprint LLM Response received`, 'BlueprintGen', taskId);
            // NOTE: generateBlueprint doesn't have task.id context. We need to pass it in. 
            // For now, I will skip adding taskId here or update signature. 
            // Updating signature is better.

            const content = response.choices[0]?.message?.content || '{}';
            const text = content.replace(/```json/g, '').replace(/```/g, '').trim();

            try {
                const parsed = JSON.parse(text) as HtmlInfographicBlueprint;
                // Validate Theme
                if (!THEME_LIBRARY[parsed.theme_id]) parsed.theme_id = 'corp_blue';
                return parsed;
            } catch (jsonErr) {
                // Log the RAW text that failed parsing
                this.logger.error(`Blueprint JSON Parse Failed. Raw Output: ${text.substring(0, 500)}...`);
                // Emit special error event or just log it
                this.observability.emitLog('error', `Model Refusal/Parse Error. Raw: ${text.substring(0, 100)}...`, 'BlueprintGen', taskId);
                throw new Error(`Invalid JSON from LLM: ${text.substring(0, 50)}...`);
            }

        } catch (e) {
            this.logger.error('Blueprint Generation Failed', e);
            throw e;
        }
    }

    // Copied from DEPRECATED_jsdom-infographic.strategy.ts
    private async generateImage(prompt: string, theme: Theme, isBackground: boolean, taskId: string = 'unknown'): Promise<{ url: string; prompt: string }> {
        const apiKey = this.configService.get<string>('SILICONFLOW_API_KEY');
        if (!apiKey) return { url: "", prompt: "" }; // Return empty if no key

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
            this.observability.emitLog('info', `SiliconFlow Image Gen Task Complete`, 'ImageGen', taskId);

            const imageUrl = response.data?.data?.[0]?.url;

            if (imageUrl) {
                const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
                return {
                    url: `data:image/jpeg;base64,${Buffer.from(imageResponse.data).toString('base64')}`,
                    prompt: fullPrompt
                };
            }
            throw new Error('No image URL returned from SiliconFlow');
        } catch (e) {
            this.logger.error(`Image Gen Failed: ${e.message}`);
            this.observability.emitLog('error', `Image Gen Failed: ${e.message}`, 'ImageGen', taskId);
            // Refinement 3.1: Strict Error Handling - Fail if asset generation fails
            throw new Error(`Critical Asset Generation Failed: ${e.message}`);
        }
    }


    private async handleVersusSplit(task: ImageTask, blueprint: any, relativeOutputDir: string, theme: Theme, metrics: any): Promise<ImageGenerationResult> {
        const imagesStart = performance.now();
        this.logger.log('[StampingStrategy] Handling Versus Split Template...');
        const usedPrompts: string[] = [];

        // 1. Generate Subject Images (Left & Right)
        const subjects = blueprint.versus_subjects || [{ name: 'Left' }, { name: 'Right' }];
        const imagePromises = subjects.map(async (subj, idx) => {
            const side = idx === 0 ? 'left' : 'right';
            const prompt = `Vertical portrait of ${subj.name}, ${subj.description || ''}, ${theme.image_style_suffix}, high contrast, isolated, ${theme.primary_accent} lighting --no text`;

            try {
                // Use isBackground=false logic for subjects? Or custom? Using false (sticker/character style)
                const result = await this.generateImage(prompt, theme, false, task.id);
                if (!result.url) return null;

                const buffer = Buffer.from(result.url.replace(/^data:image\/\w+;base64,/, ''), 'base64');
                const filename = `vs_${task.id}_${side}.png`;
                await this.localStorage.save(path.join(relativeOutputDir, 'assets', filename), buffer);

                // Update blueprint URL
                subj.image_url = `./assets/${filename}`;
                return { url: subj.image_url, prompt: result.prompt };
            } catch (e) {
                this.logger.error(`Versus Image ${side} failed: ${e.message}`);
                return null;
            }
        });

        const subjectResults = await Promise.all(imagePromises);
        subjectResults.forEach((res, idx) => {
            if (res) usedPrompts.push(`Subject ${idx === 0 ? 'Left' : 'Right'}: ${res.prompt}`);
        });

        // 1.5 Generate Item Icons (Parallel)
        this.logger.log('[StampingStrategy] Generating Versus Item Icons...');
        const iconPromises = blueprint.items.map(async (item, idx) => {
            // Priority: Explicit Icon Name > Left Value > Generic
            const iconPrompt = item.icon && item.icon.length > 2
                ? item.icon
                : `${item.left?.value || 'concept'} vs ${item.right?.value || 'concept'}`;

            const prompt = `Simple flat vector icon of ${iconPrompt}, black lines on white background, minimalist, bold, isolated --no text`;

            try {
                // simply generate a square icon that FILLS the container.
                const result = await this.generateImage(prompt, theme, false, task.id);
                if (!result.url) return;

                const buffer = Buffer.from(result.url.replace(/^data:image\/\w+;base64,/, ''), 'base64');
                const filename = `vs_icon_${task.id}_${idx}.png`;
                await this.localStorage.save(path.join(relativeOutputDir, 'assets', filename), buffer);

                (item as any).icon_url = `./assets/${filename}`;
                return result.prompt;
            } catch (e) {
                this.logger.warn(`Versus Icon ${idx} failed: ${e.message}`);
                return null;
            }
        });

        const iconResults = await Promise.all(iconPromises);
        iconResults.forEach((prompt, idx) => {
            if (prompt) usedPrompts.push(`Icon ${idx}: ${prompt}`);
        });

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
        const usedPrompts: string[] = [];

        // 1. Generate Background Image
        // Use visual_style_directive or theme + title
        const bgPrompt = blueprint.visual_style_directive || `${blueprint.center_topic.title} background, ${theme.background_main} tones, soft focus, minimalist, high resolution`;

        try {
            const result = await this.generateImage(bgPrompt, theme, true, task.id); // isBackground=true
            if (result.url) {
                const buffer = Buffer.from(result.url.replace(/^data:image\/\w+;base64,/, ''), 'base64');
                const filename = `background.png`;
                await this.localStorage.save(path.join(relativeOutputDir, 'assets', filename), buffer);
                blueprint.background_url = `./assets/${filename}`;
                usedPrompts.push(`Background: ${result.prompt}`);
            }
        } catch (e) {
            this.logger.warn(`[Steps] Background generation failed: ${e.message}`);
        }

        // 2. Generate Step Images
        const imagePromises = blueprint.items.map(async (item, idx) => {
            // Refinement: Remove Title to prevent text bleeding. Use description only.
            const prompt = `Symbolic visual representation of ${item.description}, ${theme.image_style_suffix}, flat vector art, iconic style, isolated on white, ${theme.primary_accent} --no text, letters, words, typography, writing, numbers, labels, watermark`;
            try {
                const result = await this.generateImage(prompt, theme, false, task.id);
                if (!result.url) return;

                const buffer = Buffer.from(result.url.replace(/^data:image\/\w+;base64,/, ''), 'base64');
                const filename = `step_${task.id}_${idx}.png`;
                await this.localStorage.save(path.join(relativeOutputDir, 'assets', filename), buffer);

                (item as any).image_url = `./assets/${filename}`;
                return `Step ${idx}: ${result.prompt}`;
            } catch (e) {
                this.logger.error(`[Steps] Item ${idx} image failed: ${e.message}`);
                return null;
            }
        });

        const stepPrompts = await Promise.all(imagePromises);
        stepPrompts.forEach(p => {
            if (p) usedPrompts.push(p);
        });
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
            payload: {
                blueprint, html: finalHtml, metrics,
                image_prompts: usedPrompts
            }
        };
    }
}
