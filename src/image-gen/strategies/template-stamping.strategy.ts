
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

        // Fail-Fast: Prompt 10 logic
        if (blueprint.quality_score && blueprint.quality_score < 75) {
            this.logger.error(`[VisualArchitect] Quality Score too low: ${blueprint.quality_score}. Halting.`);
            this.observability.emitLog('error', `Quality Rubric Failed (${blueprint.quality_score}/100). Log: ${blueprint.correction_log?.join(', ') || 'N/A'}`, 'VisualArchitect', task.id);
            throw new Error(`Generation halted: Quality Score ${blueprint.quality_score} < 75. Refusal: ${blueprint.correction_log?.join('; ')}`);
        }

        // Text Integrity Check (Prompt 10)
        const rawContent = task.refined_prompt.toLowerCase();
        const blueprintText = JSON.stringify(blueprint).toLowerCase();
        const criticalTerms = (task as any).metadata?.critical_terms || []; // Optional manual list

        // Simple heuristic: if the refined prompt has specific terms like "Hypothalamus", check if they moved over
        const suspectedNames = (task.refined_prompt.match(/[A-Z][a-z]+/g) || []).filter(n => n.length > 3);
        const missingTerms = [...criticalTerms, ...suspectedNames].filter(term => !blueprintText.includes(term.toLowerCase()));

        if (missingTerms.length > 0 && blueprint.template_id !== 'bento_grid') { // Bento grid might split text differently
            this.logger.warn(`[VisualArchitect] Possible low fidelity. Missing terms: ${missingTerms.join(', ')}`);
            this.observability.emitLog('warn', `Text Integrity Warning: Missing terms [${missingTerms.join(', ')}]`, 'VisualArchitect', task.id);
        }

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
        const themeId = taskAny.metadata?.theme_id || blueprint.theme_id;

        if (taskAny.metadata?.custom_theme) {
            theme = taskAny.metadata.custom_theme as Theme;
        } else {
            theme = THEME_LIBRARY[themeId] || THEME_LIBRARY['corp_blue'];
        }

        // Dispatch based on Template ID
        if (blueprint.template_id === 'versus_split') {
            return this.handleVersusSplit(task, blueprint, relativeOutputDir, theme, metrics);
        }
        if (blueprint.template_id === 'bento_grid') {
            return this.handleBento(task, blueprint, relativeOutputDir, theme, metrics);
        }
        if (blueprint.template_id === 'steps' || blueprint.template_id === 'step_list' || blueprint.template_id === 'step_journey') {
            return this.handleSteps(task, blueprint, relativeOutputDir, theme, metrics);
        }
        if (blueprint.template_id === 'hub_radial') {
            return this.handleHubRadial(task, blueprint, relativeOutputDir, theme, metrics);
        }

        // Final Fallback: Hub Radial
        return this.handleHubRadial(task, blueprint, relativeOutputDir, theme, metrics);
    }

    private async handleHubRadial(task: ImageTask, blueprint: any, relativeOutputDir: string, theme: Theme, metrics: any): Promise<ImageGenerationResult> {
        const imagesStart = performance.now();
        const usedPrompts: string[] = [];

        if (!blueprint.items || !Array.isArray(blueprint.items)) {
            this.logger.warn(`[VisualArchitect] Blueprint items missing or invalid. Log: ${blueprint.correction_log?.join(', ')}`);
            blueprint.items = [{ title: 'Overview', description: 'No specific items found.' }];
        }
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
            (blueprint.center_topic as any).image_url = centerImageResult.url;
            usedPrompts.push(`Center Hub: ${centerImageResult.prompt}`);
        }

        metrics.images = performance.now() - imagesStart;

        // 2. Stamp Template
        const stampingStart = performance.now();
        const fixedHtml = this.stampingService.stamp(blueprint.template_id || 'hub_radial', blueprint, theme);
        metrics.stamping = performance.now() - stampingStart;

        // 3. Browser Screenshot 
        const taskBaseUrl = path.join(process.cwd(), 'public', 'generated-images', relativeOutputDir);
        const dimensions = (task as any).metadata?.dimensions || { width: 1200, height: 1200 };
        const screenshotBuffer = await this.browserService.screenshotHtml(fixedHtml, taskBaseUrl, dimensions);

        metrics.total = performance.now() - metrics.start;

        const publicUrl = await this.localStorage.save(path.join(relativeOutputDir, 'poster.png'), screenshotBuffer);
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
                    browser_ms: '0', // Re-calculate or use placeholder
                    total_ms: metrics.total.toFixed(2)
                },
                output_dir: relativeOutputDir,
                blueprint_prompt: task.refined_prompt,
                image_prompts: usedPrompts
            }
        };
    }


    // Duplicated from HtmlInfographicStrategy for independence, or could be extracted to a shared service
    private async generateBlueprint(prompt: string, taskId: string): Promise<HtmlInfographicBlueprint> {
        // Reuse existing logic or simplified logic
        const systemPrompt = `You are a Senior Visual Architect. You do not create content; you map pedagogical specifications into stable geometric blueprints.
    
    CRITICAL DIRECTIVES:
    - Hallucination Guardrail: If input data is sparse, return a "correction_log" instead of inventing items. You must preserve the EXACT terminology from the source.
    - Quality Rubric: Calculate and return a quality_score (1-100) based on:
        1. Structural Fidelity (40 pts): Preservation of all branches/notes.
        2. Template Match (30 pts): Accuracy of the chosen geometry for the lesson goal.
        3. Wellness Alignment (30 pts): Adherence to the warm, non-clinical "Wellness Book" philosophy.

    TEMPLATE CATALOG:
    1. 'hub_radial': Circular central topic with radial spokes.
       Schema: { center_topic: { title, description }, items: [{ title, description }] }
    2. 'versus_split': A/B comparison. Required: Exactly 2 subjects.
       Schema: { center_topic: { title, subtitle }, versus_subjects: [{ name, description }], comparison_rows: [{ left: { value, description }, right: { value, description }, icon_label }], verdict: { title, text } }
    3. 'step_journey': Vertical roadmap.
       Schema: { center_topic: { title, description }, items: [{ title, description }] }
    4. 'bento_grid': 12x12 grid.
       Schema: { cells: [{ col_span, row_span, content: { type: 'text'|'image', title, text } }], background: { visual_style_directive } }

    CRITICAL: For 'versus_split', you MUST align parallel steps or features into 'comparison_rows'. If one side has more steps, group them logically to maintain row alignment.

    OUTPUT SCHEMA (VALID JSON ONLY):
    {
      "quality_score": number,
      "template_id": "hub_radial" | "versus_split" | "step_journey" | "bento_grid",
      "correction_log": string[],
      "blueprint": { ...template_specific_data... }
    }`;

        try {
            const model = this.configService.get<string>('OPENROUTER_MODEL') || 'google/gemini-2.0-flash-001';
            this.observability.emitLog('info', `VisualArchitect LLM Request: [USER]: ${prompt}`, 'VisualArchitect', taskId);

            const response = await this.openai.chat.completions.create({
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.4, // Increased from 0.2 to allow creative expansion for sparse prompts
                max_tokens: 2000
            });

            const content = response.choices[0]?.message?.content || '{}';
            this.observability.emitLog('info', `Blueprint LLM Response (Raw): ${content.substring(0, 1000)}`, 'BlueprintGen', taskId);
            const text = content.replace(/```json/g, '').replace(/```/g, '').trim();

            try {
                const responseObj = JSON.parse(text);
                const blueprint = responseObj.blueprint || responseObj;

                // Merge quality metadata into blueprint for downstream checks
                if (responseObj.quality_score) blueprint.quality_score = responseObj.quality_score;
                if (responseObj.correction_log) blueprint.correction_log = responseObj.correction_log;
                if (responseObj.template_id) blueprint.template_id = responseObj.template_id;

                const parsed = blueprint as HtmlInfographicBlueprint;
                // Validate Theme
                if (!THEME_LIBRARY[parsed.theme_id]) parsed.theme_id = 'corp_blue';
                return parsed;
            } catch (jsonErr) {
                // Log the RAW text that failed parsing
                this.logger.error(`Blueprint JSON Parse Failed. Raw Output: ${text.substring(0, 500)}...`);
                // Emit special error event or just log it
                this.observability.emitLog('error', `Model JSON Parse Error. Raw: ${text.substring(0, 200)}...`, 'BlueprintGen', taskId);
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
            fullPrompt = `${prompt}, ${theme.image_style_suffix}, high resolution, isolated on white background, ${theme.primary_accent} and ${theme.secondary_accent} highlights --no text, font, characters, words, writing, labels, numbers`;
        }
        this.observability.emitLog('info', `🖼️ Constructing Image Prompt: ${fullPrompt}`, 'ImageGen', taskId);

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

        // Robust Mapping: handle different key variations from LLM
        const subjects = blueprint.versus_subjects || blueprint.subjects || [{ name: 'Left' }, { name: 'Right' }];

        // Map comparison_rows or steps to items
        if (!blueprint.items) {
            blueprint.items = blueprint.comparison_rows || blueprint.steps || [];
        }

        if (!blueprint.center_topic && blueprint.title) {
            blueprint.center_topic = { title: blueprint.title, subtitle: blueprint.description || '' };
        }
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
        const iconPromises = (blueprint.items || []).map(async (item, idx) => {
            // Priority: Explicit Icon Name > icon_label > Left Value > Generic
            const iconPrompt = item.icon || item.icon_label || (item.icon && item.icon.length > 2 ? item.icon : null)
                || `${item.left?.value || 'concept'} vs ${item.right?.value || 'concept'}`;

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
            subjects: subjects,
            items: blueprint.items,
            center: blueprint.center_topic, // Title/Subtitle often mapped here
            verdict: blueprint.verdict
        };

        const fixedHtml = this.stampingService.stamp('versus_split', payload, theme);
        metrics.stamping = performance.now() - stampingStart;

        // 3. Screenshot
        const browserStart = performance.now();
        const taskBaseUrl = path.join(process.cwd(), 'public', 'generated-images', relativeOutputDir);

        // Extract Dimensions
        const dimensions = (task as any).metadata?.dimensions || {};
        const width = dimensions.width || 1200;
        const height = dimensions.height || 1200;

        const screenshotBuffer = await this.browserService.screenshotHtml(fixedHtml, taskBaseUrl, { width, height });
        metrics.browser = performance.now() - browserStart;

        // 4. Save
        const publicUrl = await this.localStorage.save(path.join(relativeOutputDir, 'poster.png'), screenshotBuffer);
        await this.localStorage.save(path.join(relativeOutputDir, 'index.html'), Buffer.from(fixedHtml));

        await this.localStorage.save(path.join(relativeOutputDir, 'blueprint.json'), Buffer.from(JSON.stringify(blueprint, null, 2)));

        metrics.total = performance.now() - metrics.start;

        return {
            url: publicUrl,
            posterUrl: publicUrl,
            payload: { blueprint, html: fixedHtml, metrics }
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
        const imagePromises = (blueprint.items || []).map(async (item, idx) => {
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
        const fixedHtml = this.stampingService.stamp('steps', blueprint, theme);
        metrics.stamping = performance.now() - stampingStart;

        // 4. Screenshot & Save
        const browserStart = performance.now();
        const taskBaseUrl = path.join(process.cwd(), 'public', 'generated-images', relativeOutputDir);

        // Extract Dimensions
        const dimensions = (task as any).metadata?.dimensions || {};
        const width = dimensions.width || 1200;
        const height = dimensions.height || 1200;

        const screenshotBuffer = await this.browserService.screenshotHtml(fixedHtml, taskBaseUrl, { width, height });
        metrics.browser = performance.now() - browserStart;

        const publicUrl = await this.localStorage.save(path.join(relativeOutputDir, 'poster.png'), screenshotBuffer);
        await this.localStorage.save(path.join(relativeOutputDir, 'index.html'), Buffer.from(fixedHtml));
        await this.localStorage.save(path.join(relativeOutputDir, 'blueprint.json'), Buffer.from(JSON.stringify(blueprint, null, 2)));

        metrics.total = performance.now() - metrics.start;

        return {
            url: publicUrl,
            posterUrl: publicUrl,
            payload: {
                blueprint,
                html: fixedHtml,
                metrics,
                image_prompts: usedPrompts
            }
        };
    }
    private async handleBento(task: ImageTask, blueprint: any, relativeOutputDir: string, theme: Theme, metrics: any): Promise<ImageGenerationResult> {
        const imagesStart = performance.now();
        this.logger.log('[StampingStrategy] Handling Bento Grid Template...');
        const usedPrompts: string[] = [];

        // 1. Parallel Task: Background Image
        const bgPromise = blueprint.visual_style_directive
            ? this.generateImage(blueprint.visual_style_directive, theme, true, task.id)
            : Promise.resolve(null);

        // 2. Parallel Tasks: Cell Images
        const cellImagePromises = (blueprint.cells || []).map(async (cell: any, idx: number) => {
            const type = cell.content?.type || '';
            if (type.includes('image')) {
                const imgPrompt = cell.content.title
                    ? `${cell.content.title}: ${cell.content.text || ''}`
                    : cell.content.text || 'abstract conceptual visual';

                try {
                    const result = await this.generateImage(imgPrompt, theme, false, task.id);
                    if (result.url) {
                        const buffer = Buffer.from(result.url.replace(/^data:image\/\w+;base64,/, ''), 'base64');
                        const filename = `bento_cell_${idx}.png`;
                        await this.localStorage.save(path.join(relativeOutputDir, 'assets', filename), buffer);
                        cell.content.image_url = `./assets/${filename}`;
                        return { index: idx, prompt: result.prompt };
                    }
                } catch (e) {
                    this.logger.warn(`Bento Image Cell ${idx} failed: ${e.message}`);
                }
            }
            return null;
        });

        const [bgResult, ...cellResults] = await Promise.all([bgPromise, ...cellImagePromises]);

        if (bgResult?.url) {
            const buffer = Buffer.from(bgResult.url.replace(/^data:image\/\w+;base64,/, ''), 'base64');
            await this.localStorage.save(path.join(relativeOutputDir, 'assets', 'background.png'), buffer);
            blueprint.background = { ...(blueprint.background || {}), image_url: './assets/background.png' };
            usedPrompts.push(`Background: ${bgResult.prompt}`);
        }

        cellResults.forEach((res) => {
            if (res) usedPrompts.push(`Cell ${res.index}: ${res.prompt}`);
        });

        metrics.images = performance.now() - imagesStart;

        // 3. Stamp Template
        const stampingStart = performance.now();
        const fixedHtml = this.stampingService.stamp('bento', blueprint, theme);
        metrics.stamping = performance.now() - stampingStart;

        // 4. Screenshot
        const browserStart = performance.now();
        const taskBaseUrl = path.join(process.cwd(), 'public', 'generated-images', relativeOutputDir);
        const dimensions = (task as any).metadata?.dimensions || { width: 1200, height: 1200 };

        const screenshotBuffer = await this.browserService.screenshotHtml(fixedHtml, taskBaseUrl, dimensions);
        metrics.browser = performance.now() - browserStart;

        // 5. Save Artifacts
        const publicUrl = await this.localStorage.save(path.join(relativeOutputDir, 'poster.png'), screenshotBuffer);
        await this.localStorage.save(path.join(relativeOutputDir, 'index.html'), Buffer.from(fixedHtml));
        await this.localStorage.save(path.join(relativeOutputDir, 'blueprint.json'), Buffer.from(JSON.stringify(blueprint, null, 2)));

        metrics.total = performance.now() - metrics.start;

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
                blueprint_prompt: task.refined_prompt,
                image_prompts: usedPrompts
            }
        };
    }
}
