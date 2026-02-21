
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
import * as sharp from 'sharp';
import { ObservabilityGateway } from '../../observability/observability.gateway'; // Import Gateway
import * as pLimit from 'p-limit';

@Injectable()
export class TemplateStampingStrategy extends BaseImageStrategy {
    private openai: OpenAI;
    private readonly imageApiLimit: ReturnType<typeof pLimit>;
    private readonly blueprintApiLimit: ReturnType<typeof pLimit>;
    private readonly imageApiMaxRetries: number;
    private readonly blueprintApiMaxRetries: number;

    constructor(
        private readonly stampingService: TemplateStampingService,
        private readonly browserService: BrowserService,
        private readonly localStorage: LocalStorageService,
        private readonly configService: ConfigService,
        private readonly observability: ObservabilityGateway, // Inject Gateway
    ) {
        super();
        const apiKey = this.configService.get<string>('OPENROUTER_API_KEY');
        const configuredImageConcurrency = Number(this.configService.get<string>('IMAGE_API_CONCURRENCY') || 6);
        const imageConcurrency = Number.isFinite(configuredImageConcurrency) && configuredImageConcurrency > 0
            ? configuredImageConcurrency
            : 6;
        this.imageApiLimit = pLimit(imageConcurrency);
        const configuredBlueprintConcurrency = Number(this.configService.get<string>('OPENROUTER_API_CONCURRENCY') || 3);
        const blueprintConcurrency = Number.isFinite(configuredBlueprintConcurrency) && configuredBlueprintConcurrency > 0
            ? configuredBlueprintConcurrency
            : 3;
        this.blueprintApiLimit = pLimit(blueprintConcurrency);
        this.imageApiMaxRetries = Math.max(0, Number(this.configService.get<string>('IMAGE_API_MAX_RETRIES') || 2));
        this.blueprintApiMaxRetries = Math.max(0, Number(this.configService.get<string>('OPENROUTER_MAX_RETRIES') || 2));
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

        // Incorporate payload into the prompt for "Visual Architect"
        const fullPrompt = `${task.refined_prompt}\n\nDATA SPECIFICATION (USE THIS FOR ITEMS AND STRUCTURE):\n${JSON.stringify(task.payload, null, 2)}`;
        let blueprint: HtmlInfographicBlueprint;
        try {
            blueprint = await this.generateBlueprint(fullPrompt, task.id, task.payload);
        } catch (e) {
            const details = this.extractErrorDetails(e);
            const authFailure = details.statusCode === 401 || details.statusCode === 403 || /user not found/i.test(details.message);
            if (!authFailure) {
                throw e;
            }

            this.logger.warn(`[VisualArchitect] OpenRouter auth failed (${details.statusCode}). Falling back to deterministic blueprint builder.`);
            this.observability.emitLog(
                'warn',
                `Blueprint provider auth failed (status=${details.statusCode ?? 'n/a'}). Using deterministic fallback blueprint from manifest payload.`,
                'VisualArchitect',
                task.id
            );
            blueprint = this.buildFallbackBlueprint(task);
        }

        // Ensure we always end up with one supported render template.
        blueprint = this.normalizeBlueprintTemplate(blueprint, task.payload, task.id);

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
        this.logger.log(`[VisualArchitect] Blueprint generated (${metrics.blueprint.toFixed(2)}ms). Score: ${blueprint.quality_score}. Explanation: ${blueprint.explanation}`);
        this.observability.emitLog('info', `Blueprint generated in ${metrics.blueprint.toFixed(2)}ms. Explanation: ${blueprint.explanation}`, 'StampingStrategy', task.id);

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
        const relativeOutputDir = path.join(dateStr, courseId, lessonId, taskId);
        this.logger.log(`[StampingStrategy] Target Directory Initialized: ${relativeOutputDir}`);
        this.observability.emitLog('info', `Target Directory Initialized: ${relativeOutputDir}`, 'StampingStrategy', task.id);

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
            return await this.handleVersusSplit(task, blueprint, relativeOutputDir, theme, metrics);
        }
        if (blueprint.template_id === 'bento_grid') {
            return await this.handleBento(task, blueprint, relativeOutputDir, theme, metrics);
        }
        if (blueprint.template_id === 'steps' || blueprint.template_id === 'step_list' || blueprint.template_id === 'step_journey') {
            return await this.handleSteps(task, blueprint, relativeOutputDir, theme, metrics);
        }
        if (blueprint.template_id === 'hub_radial') {
            return await this.handleHubRadial(task, blueprint, relativeOutputDir, theme, metrics);
        }

        // Final Fallback: Hub Radial
        return await this.handleHubRadial(task, blueprint, relativeOutputDir, theme, metrics);
    }

    private async handleHubRadial(task: ImageTask, blueprint: any, relativeOutputDir: string, theme: Theme, metrics: any): Promise<ImageGenerationResult> {
        const imagesStart = performance.now();
        const usedPrompts: string[] = [];
        const promptUsage = new Map<string, number>();

        if (!blueprint.items || !Array.isArray(blueprint.items)) {
            this.logger.warn(`[VisualArchitect] Blueprint items missing or invalid. Log: ${blueprint.correction_log?.join(', ')}`);
            blueprint.items = [{ title: 'Overview', description: 'No specific items found.' }];
        }

        const totalItems = blueprint.items.length || 1;
        const centerTitle = blueprint.center_topic?.title || 'core topic';

        const buildSpokePrompt = (item: any, idx: number): string => {
            const title = (item?.title || `Spoke ${idx + 1}`).trim();
            const desc = (item?.description || '').trim();
            const concept = this.toTextSafeIconConcept(`${title}. ${desc}`);

            // Use neutral slot cues for diversity; avoid time words that bias toward clock imagery.
            const slotHint = `radial slot ${idx + 1} of ${totalItems}`;

            const base = `symbolic minimalist icon for ${concept}. Semantic cue for ${this.toTextSafeIconConcept(centerTitle)}. ${slotHint}. Focus on object/action metaphor, not UI symbols. Avoid clocks, watches, timer dials, countdown graphics, compasses, gauges, or circular tick marks. No words, letters, numbers, equations, formulas, or labels.`;
            const normalized = base.toLowerCase().replace(/\s+/g, ' ').trim();
            const seen = promptUsage.get(normalized) || 0;
            promptUsage.set(normalized, seen + 1);

            // Deterministic anti-duplication token for repeated semantic prompts.
            if (seen > 0) {
                return `${base}. Variation seed ${idx + 1}`;
            }
            return base;
        };

        const itemImagePromises = blueprint.items.map((item, idx) =>
            this.generateImage(buildSpokePrompt(item, idx), theme, false, task.id, '256x256')
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
            task.id,
            '640x640'
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
    private async generateBlueprint(prompt: string, taskId: string, sourcePayload?: any): Promise<HtmlInfographicBlueprint> {
        // Reuse existing logic or simplified logic
        const systemPrompt = `You are a Senior Visual Architect. You do not create content; you map pedagogical specifications into stable geometric blueprints.
    
    CRITICAL DIRECTIVES:
    - Type Normalization: The incoming "type" is advisory. If it is unknown (e.g. "annotated_triangle"), you MUST normalize to the closest supported template and continue. Do NOT reject solely because the source type label is not in the template catalog.
    - Hallucination Guardrail: If input is extremely sparse (e.g. only a title with no context), return a "correction_log". However, if subjects and metrics are provided for a comparison, you SHOULD use your world knowledge to populate the values, descriptions, and scores to provide a complete pedagogical experience. Preserve the EXACT terminology from the source for the core subjects and metrics.
    - Quality Rubric: Calculate and return a quality_score (1-100) based on:
        1. Structural Fidelity (40 pts): Preservation of all branches/notes.
        2. Template Match (30 pts): Accuracy of the chosen geometry for the lesson goal.
        3. Wellness Alignment (30 pts): Adherence to the warm, non-clinical "Wellness Book" philosophy.
    - Refusal Policy: Only use correction_log for missing/empty source content. Never refuse based only on unsupported type names.
    - Technical Explanation: You MUST provide a 1-2 sentence "explanation" justifying your choice of template and your quality score.

    TEMPLATE CATALOG:
    1. 'hub_radial': Circular central topic with radial spokes.
       Schema: { center_topic: { title, description }, items: [{ title, description }] }
    2. 'versus_split': Comparative analysis of 2-4 entities (Subjects).
       AXIAL LOGIC: 
       - Subjects (versus_subjects): The nouns being compared (e.g., "iPhone", "Android"). If the input has "panels", "columns", or "categories", these are typically your subjects.
       - Metrics (comparison_items): The dimensions of comparison (e.g., "Battery Life"). The "characteristics" or bullet points within panels are your metrics.
       Schema: { 
         center_topic: { title, subtitle }, 
         versus_subjects: [{ name, description }], 
         comparison_items: [{ 
           metric: "e.g. Speed", 
           values: [{ value: "e.g. 100mph", description: "...", score: 1-10 }] 
         }], 
         verdict: { title, text } 
       }
    3. 'step_journey': Vertical roadmap.
       Schema: { center_topic: { title, description }, items: [{ title, description }] }
    4. 'bento_grid': 12x12 grid.
       Schema: { cells: [{ col_span, row_span, content: { type: 'text'|'image', title, text } }], background: { visual_style_directive } }

    CRITICAL: For 'versus_split', 'comparison_items[].values' MUST match the length and order of 'versus_subjects'. Each subject gets one value per metric.

    OUTPUT SCHEMA (VALID JSON ONLY):
    {
      "quality_score": number,
      "explanation": "string",
      "source_type": "string",
      "normalized_template_id": "hub_radial" | "versus_split" | "step_journey" | "bento_grid",
      "normalization_reason": "string",
      "template_id": "hub_radial" | "versus_split" | "step_journey" | "bento_grid",
      "correction_log": string[],
      "blueprint": { ...template_specific_data... }
    }`;

        const model = this.configService.get<string>('OPENROUTER_MODEL') || 'google/gemini-2.0-flash-001';
        this.observability.emitLog('info', `VisualArchitect LLM Request: [USER]: ${prompt}`, 'VisualArchitect', taskId);

        try {
            return await this.withRetries<HtmlInfographicBlueprint>(
                async () => {
                    const response = await this.blueprintApiLimit(async () => {
                        return this.openai.chat.completions.create({
                            model: model,
                            messages: [
                                { role: 'system', content: systemPrompt },
                                { role: 'user', content: prompt }
                            ],
                            temperature: 0.2,
                            max_tokens: 2000
                        });
                    });

                    let content = response.choices[0]?.message?.content || '{}';
                    this.observability.emitLog('info', `Blueprint LLM Response (Raw): ${content.substring(0, 1000)}`, 'BlueprintGen', taskId);
                    let text = content.replace(/```json/g, '').replace(/```/g, '').trim();

                    try {
                        let responseObj = JSON.parse(text);
                        let blueprint = responseObj.blueprint || responseObj;

                        // Single repair pass when model refuses due unsupported input type.
                        if (this.isTypeNormalizationRefusal(responseObj, blueprint)) {
                            const repairPrompt = `Repair this blueprint response. It incorrectly refused due source type naming.

Rules:
1) Do not refuse due unknown type labels.
2) Normalize to nearest supported template: hub_radial | versus_split | step_journey | bento_grid.
3) Preserve source semantics and structure.
4) Return valid JSON only in the required schema.

Original user request:
${prompt}

Rejected response to repair:
${text}`;

                            this.observability.emitLog('warn', 'Blueprint normalization repair retry triggered', 'BlueprintGen', taskId);
                            const repairResponse = await this.blueprintApiLimit(async () => {
                                return this.openai.chat.completions.create({
                                    model: model,
                                    messages: [
                                        { role: 'system', content: systemPrompt },
                                        { role: 'user', content: repairPrompt }
                                    ],
                                    temperature: 0.2,
                                    max_tokens: 2000
                                });
                            });
                            content = repairResponse.choices[0]?.message?.content || '{}';
                            this.observability.emitLog('info', `Blueprint LLM Repair Response (Raw): ${content.substring(0, 1000)}`, 'BlueprintGen', taskId);
                            text = content.replace(/```json/g, '').replace(/```/g, '').trim();
                            responseObj = JSON.parse(text);
                            blueprint = responseObj.blueprint || responseObj;
                        }

                        // Merge quality metadata into blueprint for downstream checks
                        if (responseObj.quality_score) blueprint.quality_score = responseObj.quality_score;
                        if (responseObj.explanation) blueprint.explanation = responseObj.explanation;
                        if (responseObj.correction_log) blueprint.correction_log = responseObj.correction_log;
                        if (responseObj.template_id) blueprint.template_id = responseObj.template_id;
                        if (responseObj.normalized_template_id && !blueprint.template_id) blueprint.template_id = responseObj.normalized_template_id;
                        if (responseObj.source_type) (blueprint as any).source_type = responseObj.source_type;
                        if (responseObj.normalization_reason) (blueprint as any).normalization_reason = responseObj.normalization_reason;

                        blueprint = this.normalizeBlueprintTemplate(blueprint, sourcePayload, taskId);

                        const parsed = blueprint as HtmlInfographicBlueprint;
                        // Validate Theme
                        if (!THEME_LIBRARY[parsed.theme_id]) parsed.theme_id = 'corp_blue';
                        return parsed;
                    } catch (jsonErr) {
                        // Log the RAW text that failed parsing
                        this.logger.error(`Blueprint JSON Parse Failed. Raw Output: ${text.substring(0, 500)}...`);
                        this.observability.emitLog('error', `Model JSON Parse Error. Raw: ${text.substring(0, 200)}...`, 'BlueprintGen', taskId);
                        const fallback = this.buildFallbackBlueprintFromPayload(sourcePayload, prompt);
                        this.observability.emitLog('warn', `Blueprint JSON invalid; using deterministic fallback template='${fallback.template_id}'`, 'BlueprintGen', taskId);
                        const normalizedFallback = this.normalizeBlueprintTemplate(fallback, sourcePayload, taskId);
                        if (!THEME_LIBRARY[(normalizedFallback as HtmlInfographicBlueprint).theme_id]) {
                            (normalizedFallback as HtmlInfographicBlueprint).theme_id = 'corp_blue';
                        }
                        return normalizedFallback as HtmlInfographicBlueprint;
                    }
                },
                {
                    maxRetries: this.blueprintApiMaxRetries,
                    provider: 'OpenRouter',
                    operation: 'Blueprint generation',
                    taskId
                }
            );
        } catch (e) {
            const details = this.extractErrorDetails(e);
            const msg = `Blueprint Generation Failed | provider=OpenRouter status=${details.statusCode ?? 'n/a'} code=${details.code ?? 'n/a'} message=${details.message}`;
            this.logger.error(msg);
            this.observability.emitLog('error', msg, 'BlueprintGen', taskId);
            const err: any = new Error(details.message);
            err.status = details.statusCode;
            err.code = details.code;
            err.provider = 'OpenRouter';
            throw err;
        }
    }

    private isTypeNormalizationRefusal(responseObj: any, blueprint: any): boolean {
        const templateId = responseObj?.template_id || responseObj?.normalized_template_id || blueprint?.template_id;
        const logText = Array.isArray(responseObj?.correction_log)
            ? responseObj.correction_log.join(' ').toLowerCase()
            : Array.isArray(blueprint?.correction_log)
                ? blueprint.correction_log.join(' ').toLowerCase()
                : '';
        const refusalTerms = ['not a supported template', 'unsupported template', 'please choose from'];
        return (!templateId || templateId === 'null') && refusalTerms.some(term => logText.includes(term));
    }

    private normalizeBlueprintTemplate(blueprint: any, sourcePayload: any, taskId: string): any {
        const supported = new Set(['hub_radial', 'versus_split', 'step_journey', 'bento_grid', 'steps', 'step_list']);
        if (supported.has(String(blueprint?.template_id || ''))) {
            return blueprint;
        }

        const inferredTemplate = this.inferTemplateFromStructure(sourcePayload, blueprint);
        this.observability.emitLog(
            'warn',
            `Blueprint template normalized via structural fallback to '${inferredTemplate}' (original='${blueprint?.template_id ?? 'null'}')`,
            'BlueprintGen',
            taskId
        );
        return {
            ...blueprint,
            template_id: inferredTemplate,
            quality_score: Math.max(Number(blueprint?.quality_score || 0), 75),
            explanation: blueprint?.explanation || `Template normalized to ${inferredTemplate} using structural fallback.`,
            normalization_reason: (blueprint as any)?.normalization_reason || 'Structural fallback from source payload'
        };
    }

    private inferTemplateFromStructure(sourcePayload: any, blueprint: any): 'hub_radial' | 'versus_split' | 'step_journey' | 'bento_grid' {
        const payload = sourcePayload || {};
        const hasComparisonSignals =
            Array.isArray(payload.panels) ||
            Array.isArray(payload.comparison_items) ||
            Array.isArray(payload?.paths) ||
            Array.isArray(blueprint?.versus_subjects) ||
            Array.isArray(blueprint?.comparison_items);
        if (hasComparisonSignals) return 'versus_split';

        const hasJourneySignals =
            Array.isArray(payload.steps) ||
            Array.isArray(payload.sequence) ||
            Array.isArray(payload?.structure?.branches) ||
            Array.isArray(blueprint?.items) && blueprint.items.length >= 4;
        if (hasJourneySignals) return 'step_journey';

        const hasGridSignals =
            Array.isArray(payload.cells) ||
            Array.isArray(payload.distortions) ||
            Array.isArray(blueprint?.cells);
        if (hasGridSignals) return 'bento_grid';

        return 'hub_radial';
    }

    // Copied from DEPRECATED_jsdom-infographic.strategy.ts
    private async generateImage(prompt: string, theme: Theme, isBackground: boolean, taskId: string = 'unknown', imageSize?: string): Promise<{ url: string; prompt: string }> {
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
        const resolvedImageSize = imageSize || (isBackground ? '768x768' : '512x512');
        this.observability.emitLog('info', `ðŸ–¼ï¸ Constructing Image Prompt (size=${resolvedImageSize}): ${fullPrompt}`, 'ImageGen', taskId);

        try {
            return await this.withRetries<{ url: string; prompt: string }>(
                async () => {
                    return this.imageApiLimit(async () => {
                        const response = await axios.post(
                            'https://api.siliconflow.com/v1/images/generations',
                            {
                                model: 'black-forest-labs/FLUX.1-schnell',
                                prompt: fullPrompt,
                                image_size: resolvedImageSize,
                                num_inference_steps: 4,
                                batch_size: 1
                            },
                            { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 }
                        );
                        this.observability.emitLog('info', `SiliconFlow Image Gen Task Complete`, 'ImageGen', taskId);

                        const imageUrl = response.data?.data?.[0]?.url;
                        if (!imageUrl) {
                            throw new Error('No image URL returned from SiliconFlow');
                        }

                        const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
                        return {
                            url: `data:image/jpeg;base64,${Buffer.from(imageResponse.data).toString('base64')}`,
                            prompt: fullPrompt
                        };
                    });
                },
                {
                    maxRetries: this.imageApiMaxRetries,
                    provider: 'SiliconFlow',
                    operation: 'Image generation',
                    taskId
                }
            );
        } catch (e) {
            const details = this.extractErrorDetails(e);
            const msg = `Image Gen Failed | provider=SiliconFlow status=${details.statusCode ?? 'n/a'} code=${details.code ?? 'n/a'} message=${details.message}`;
            this.logger.error(msg);
            this.observability.emitLog('error', msg, 'ImageGen', taskId);
            // Refinement 3.1: Strict Error Handling - Fail if asset generation fails
            const err: any = new Error(`Critical Asset Generation Failed: ${details.message}`);
            err.status = details.statusCode;
            err.code = details.code;
            err.provider = 'SiliconFlow';
            throw err;
        }
    }

    private buildFallbackBlueprint(task: ImageTask): HtmlInfographicBlueprint {
        const payload: any = (task as any).payload || {};
        return this.buildFallbackBlueprintFromPayload(payload, task?.refined_prompt || '');
    }

    private buildFallbackBlueprintFromPayload(payload: any, refinedPrompt: string): HtmlInfographicBlueprint {
        const rawType = String(payload.type || '').toLowerCase();
        const title = payload.title || 'Visualization';
        const summary = payload.description || payload.purpose || refinedPrompt || 'Auto-generated blueprint from manifest payload.';

        const toItems = (arr: any[], itemMapper: (x: any, i: number) => any) => (Array.isArray(arr) ? arr.map(itemMapper).filter(Boolean) : []);

        if (rawType.includes('split_panel') || rawType.includes('diverging') || rawType.includes('comparison')) {
            const panels = Array.isArray(payload.panels) ? payload.panels : [];
            const subjects = panels.length >= 2
                ? panels.slice(0, 2).map((p: any, idx: number) => ({
                    name: p.label || p.system || p.side || `Subject ${idx + 1}`,
                    description: p.system || p.side || ''
                }))
                : [{ name: 'Subject A', description: '' }, { name: 'Subject B', description: '' }];

            const leftChars = Array.isArray(panels[0]?.characteristics) ? panels[0].characteristics : [];
            const rightChars = Array.isArray(panels[1]?.characteristics) ? panels[1].characteristics : [];
            const rowCount = Math.max(leftChars.length, rightChars.length, 4);
            const comparison_items = Array.from({ length: rowCount }).map((_, i) => {
                const lv = leftChars[i] || 'N/A';
                const rv = rightChars[i] || 'N/A';
                const metric = String(lv).split(':')[0] || `Dimension ${i + 1}`;
                return {
                    metric,
                    values: [
                        { value: String(lv), description: '', score: 5 },
                        { value: String(rv), description: '', score: 5 }
                    ]
                };
            });

            return {
                quality_score: 78,
                explanation: 'Fallback versus blueprint synthesized from panel data due provider auth failure.',
                template_id: 'versus_split',
                center_topic: { title, subtitle: summary },
                versus_subjects: subjects,
                comparison_items,
                verdict: payload.bottomNote ? { title: 'Takeaway', text: payload.bottomNote } : undefined
            } as any;
        }

        if (rawType.includes('flowchart') || rawType.includes('journey') || rawType.includes('step')) {
            const structureSeq = payload?.structure?.branches
                ? payload.structure.branches.flatMap((b: any) => [b.name, ...(b.sequence || [])])
                : [];
            const items = toItems(structureSeq, (s, i) => ({ title: `Step ${i + 1}`, description: String(s) }));
            return {
                quality_score: 76,
                explanation: 'Fallback step journey synthesized from manifest structure due provider auth failure.',
                template_id: 'step_journey',
                center_topic: { title, description: summary },
                items: items.length ? items : [{ title: 'Step 1', description: summary }]
            } as any;
        }

        const domainItems = toItems(payload.domains, (d: any) => ({
            title: d?.name || 'Domain',
            description: Array.isArray(d?.symptoms) ? d.symptoms.slice(0, 2).join('; ') : (d?.category || '')
        }));
        const genericItems = toItems(payload.items, (it: any) => ({
            title: it?.title || 'Item',
            description: it?.description || ''
        }));
        const hubItems = domainItems.length ? domainItems : genericItems;

        return {
            quality_score: 75,
            explanation: 'Fallback hub radial blueprint synthesized from manifest payload due provider auth failure.',
            template_id: 'hub_radial',
            center_topic: { title, description: summary },
            items: hubItems.length ? hubItems : [{ title: 'Overview', description: summary }]
        } as any;
    }

    private estimateBentoCellImageSize(cell: any): string {
        const colSpan = Math.max(1, Number(cell?.col_span || cell?.layout?.col_span || 3));
        const rowSpan = Math.max(1, Number(cell?.row_span || cell?.layout?.row_span || 3));

        // bento.html: canvas 1200, padding 60 each side, gap 40 in a 12x12 grid.
        const canvasInner = 1200 - 120;
        const gap = 40;
        const cols = 12;
        const rows = 12;
        const colUnit = (canvasInner - (cols - 1) * gap) / cols;
        const rowUnit = (canvasInner - (rows - 1) * gap) / rows;
        const width = colUnit * colSpan + gap * (colSpan - 1);
        const height = rowUnit * rowSpan + gap * (rowSpan - 1);

        return this.quantizeResolution(width, height);
    }

    private quantizeResolution(targetWidth: number, targetHeight: number): string {
        const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
        const quantize64 = (n: number) => Math.round(clamp(n, 256, 1024) / 64) * 64;

        const w = quantize64(targetWidth);
        const h = quantize64(targetHeight);
        const ratio = w / Math.max(h, 1);

        // Use square outputs for near-square targets to increase cache hit chances.
        if (ratio > 0.85 && ratio < 1.15) {
            const s = Math.max(w, h);
            return `${s}x${s}`;
        }
        return `${w}x${h}`;
    }

    private async withRetries<T>(
        fn: () => Promise<T>,
        options: { maxRetries: number; provider: string; operation: string; taskId?: string }
    ): Promise<T> {
        let attempt = 0;
        let lastError: any;
        const maxAttempts = options.maxRetries + 1;

        while (attempt < maxAttempts) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                const details = this.extractErrorDetails(error);
                const retryable = this.isRetryableError(error);
                const currentAttempt = attempt + 1;

                this.observability.emitLog(
                    retryable && currentAttempt < maxAttempts ? 'warn' : 'error',
                    `${options.operation} failed (attempt ${currentAttempt}/${maxAttempts}) | provider=${options.provider} status=${details.statusCode ?? 'n/a'} code=${details.code ?? 'n/a'} message=${details.message}`,
                    'Retry',
                    options.taskId
                );

                if (!retryable || currentAttempt >= maxAttempts) {
                    break;
                }

                const backoffMs = 750 * Math.pow(2, attempt) + Math.floor(Math.random() * 300);
                await this.sleep(backoffMs);
            }
            attempt++;
        }

        throw lastError;
    }

    private isRetryableError(error: any): boolean {
        const details = this.extractErrorDetails(error);
        const status = details.statusCode;
        const code = (details.code || '').toString().toLowerCase();
        const message = details.message.toLowerCase();

        if (status && [408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true;
        if (code.includes('timeout') || code.includes('econnreset') || code.includes('etimedout') || code.includes('eai_again')) return true;
        if (message.includes('timeout') || message.includes('rate limit') || message.includes('temporar')) return true;
        return false;
    }

    private extractErrorDetails(error: any): { statusCode?: number; code?: string; message: string } {
        const statusCode = error?.status ?? error?.response?.status;
        const code = error?.code ?? error?.response?.data?.error?.code;
        const responseMessage = error?.response?.data?.error?.message
            || error?.response?.data?.message
            || error?.response?.statusText;
        const message = responseMessage || error?.message || 'Unknown error';
        return { statusCode, code, message };
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }


    private async handleVersusSplit(task: ImageTask, blueprint: any, relativeOutputDir: string, theme: Theme, metrics: any): Promise<ImageGenerationResult> {
        const imagesStart = performance.now();
        this.logger.log('[StampingStrategy] Handling Versus Split Template...');
        const usedPrompts: string[] = [];

        // Robust Mapping: handle different key variations from LLM
        const subjects = blueprint.versus_subjects || blueprint.subjects || [{ name: 'Subject A' }, { name: 'Subject B' }];

        // Map comparison_items or items
        if (!blueprint.comparison_items) {
            blueprint.comparison_items = blueprint.items || blueprint.comparison_rows || [];
        }

        // Programmatic Safeguard: Ensure metric values length matches subject length
        const subCount = subjects.length;
        blueprint.comparison_items = blueprint.comparison_items.map((item: any) => {
            if (item.values && item.values.length !== subCount) {
                this.logger.warn(`[StampingStrategy] Subject/Value mismatch for metric "${item.metric}". Expected ${subCount}, got ${item.values.length}. Padding/Truncating.`);
                this.observability.emitLog('warn', `Subject/Value mismatch for metric "${item.metric}". Expected ${subCount}, got ${item.values.length}.`, 'StampingStrategy', task.id);

                if (item.values.length < subCount) {
                    // Pad with empty values
                    const padding = Array(subCount - item.values.length).fill({ value: 'N/A', description: 'No data provided', score: 0 });
                    item.values = [...item.values, ...padding];
                } else {
                    // Truncate
                    item.values = item.values.slice(0, subCount);
                }
            }
            return item;
        });

        if (!blueprint.center_topic && blueprint.title) {
            blueprint.center_topic = { title: blueprint.title, subtitle: blueprint.description || '' };
        }
        const imagePromises = subjects.map(async (subj: any, idx: number) => {
            const concept = this.toTextSafeIconConcept(`${subj?.name || ''}. ${subj?.description || ''}`);
            const prompt = `Vertical symbolic portrait of ${concept}, ${theme.image_style_suffix}, high contrast, isolated, ${theme.primary_accent} lighting --no text, letters, words, numbers, equations, formulas, labels`;

            try {
                const result = await this.generateImage(prompt, theme, false, task.id, '256x256');
                if (!result.url) return null;

                const buffer = Buffer.from(result.url.replace(/^data:image\/\w+;base64,/, ''), 'base64');
                const filename = `vs_${task.id}_sub_${idx}.png`;
                await this.localStorage.save(path.join(relativeOutputDir, 'assets', filename), buffer);

                // Update blueprint URL
                subj.image_url = `./assets/${filename}`;
                return { url: subj.image_url, prompt: result.prompt };
            } catch (e) {
                this.logger.error(`Versus Subject Image ${idx} failed: ${e.message}`);
                return null;
            }
        });

        const subjectResults = await Promise.all(imagePromises);
        subjectResults.forEach((res, idx) => {
            if (res) usedPrompts.push(`Subject ${idx}: ${res.prompt}`);
        });

        // Metric icons intentionally disabled to reduce image API load.

        metrics.images = performance.now() - imagesStart;

        // 2. Stamp Template
        const stampingStart = performance.now();
        // versus.html expected Data Format: { center: { title, subtitle }, subjects: [], items: [], verdict: {} }
        const payload = {
            center: {
                title: blueprint.center_topic?.title || blueprint.title || 'Comparison',
                subtitle: blueprint.center_topic?.subtitle || blueprint.center_topic?.description || blueprint.description || ''
            },
            subjects: subjects,
            items: blueprint.comparison_items,
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

    private async handleSteps(task: ImageTask, blueprint: any, relativeOutputDir: string, theme: Theme, metrics: any): Promise<ImageGenerationResult> {
        const imagesStart = performance.now();
        this.logger.log('[StampingStrategy] Handling Steps Template...');
        const usedPrompts: string[] = [];

        // 1. Generate Background Image
        // Use visual_style_directive or theme + title
        const bgPrompt = blueprint.visual_style_directive || `${blueprint.center_topic.title} background, ${theme.background_main} tones, soft focus, minimalist, high resolution`;

        try {
            const result = await this.generateImage(bgPrompt, theme, true, task.id, '768x768'); // isBackground=true
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

        // 2. Generate Step Images (deterministic local icons to guarantee no text/numbers in icon layer)
        const imagePromises = (blueprint.items || []).map(async (item, idx) => {
            try {
                const buffer = await this.generateProceduralStepIcon(idx, theme, 256);
                const filename = `step_${task.id}_${idx}.png`;
                await this.localStorage.save(path.join(relativeOutputDir, 'assets', filename), buffer);

                (item as any).image_url = `./assets/${filename}`;
                return `Step ${idx}: procedural no-text icon`;
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

    private toTextSafeIconConcept(input: string): string {
        const raw = String(input || '').toLowerCase();
        const mapped = raw
            .replace(/\b(?:step|decision|output|start|footer|note|title)\b/g, ' ')
            .replace(/\b(?:qnan|snan|nan)\b/g, 'undefined numeric state')
            .replace(/\b(?:infinity|infinite)\b/g, 'infinite scale concept')
            .replace(/\b(?:zero)\b/g, 'empty state concept')
            .replace(/\b(?:subnormal|denormalized?)\b/g, 'near-threshold state')
            .replace(/\b(?:exponent|fraction|frac|bitmask|ieee)\b/g, 'numeric classification concept')
            .replace(/\b(?:if|then|else|is|are|was|were|be|to|for|of|in|on|at|by|from|with)\b/g, ' ')
            .replace(/[0-9]+/g, ' ')
            .replace(/[=+\-*/<>()[\]{}:;.,±∞'"`]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const fallback = 'decision process symbol, branching flow, classification states';
        const concept = mapped.length ? mapped : fallback;
        return concept.split(' ').slice(0, 14).join(' ');
    }

    private async generateProceduralStepIcon(idx: number, theme: Theme, size = 256): Promise<Buffer> {
        const primary = theme.primary_accent || '#5B9A8B';
        const secondary = theme.secondary_accent || '#E8A598';
        const stroke = '#1A365D';
        const center = Math.floor(size / 2);
        const r = Math.floor(size * 0.26);
        const variant = idx % 6;

        let symbol = '';
        if (variant === 0) {
            symbol = `<path d="M ${center - 28} ${center} L ${center - 4} ${center + 24} L ${center + 32} ${center - 20}" fill="none" stroke="${stroke}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />`;
        } else if (variant === 1) {
            symbol = `<path d="M ${center} ${center - 30} L ${center - 28} ${center + 26} L ${center + 28} ${center + 26} Z" fill="none" stroke="${stroke}" stroke-width="8" stroke-linejoin="round" />`;
        } else if (variant === 2) {
            symbol = `<rect x="${center - 30}" y="${center - 30}" width="60" height="60" rx="12" fill="none" stroke="${stroke}" stroke-width="8" />`;
        } else if (variant === 3) {
            symbol = `<circle cx="${center}" cy="${center}" r="28" fill="none" stroke="${stroke}" stroke-width="8" /><circle cx="${center}" cy="${center}" r="10" fill="${stroke}" />`;
        } else if (variant === 4) {
            symbol = `<path d="M ${center - 30} ${center + 12} C ${center - 16} ${center - 18}, ${center + 8} ${center - 18}, ${center + 28} ${center + 12}" fill="none" stroke="${stroke}" stroke-width="8" stroke-linecap="round" />`;
        } else {
            symbol = `<path d="M ${center - 30} ${center + 24} L ${center - 6} ${center - 16} L ${center + 10} ${center + 2} L ${center + 30} ${center - 24}" fill="none" stroke="${stroke}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />`;
        }

        const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g${idx}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${primary}" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="${secondary}" stop-opacity="0.85"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${size}" height="${size}" rx="${Math.floor(size * 0.12)}" fill="#FFFFFF"/>
  <circle cx="${center}" cy="${center}" r="${r + 22}" fill="url(#g${idx})" opacity="0.22"/>
  <circle cx="${center}" cy="${center}" r="${r}" fill="#FFFFFF" stroke="${primary}" stroke-width="4"/>
  ${symbol}
</svg>`;

        return await sharp(Buffer.from(svg)).png().toBuffer();
    }
    private async handleBento(task: ImageTask, blueprint: any, relativeOutputDir: string, theme: Theme, metrics: any): Promise<ImageGenerationResult> {
        const imagesStart = performance.now();
        this.logger.log('[StampingStrategy] Handling Bento Grid Template...');
        const usedPrompts: string[] = [];

        // 1. Parallel Task: Background Image
        const bgPromise = blueprint.visual_style_directive
            ? this.generateImage(blueprint.visual_style_directive, theme, true, task.id, '768x768')
            : Promise.resolve(null);

        // 2. Parallel Tasks: Cell Images
        const cellImagePromises = (blueprint.cells || []).map(async (cell: any, idx: number) => {
            const type = cell.content?.type || '';
            if (type.includes('image')) {
                const iconConcept = this.toTextSafeIconConcept(`${cell.content?.title || ''}. ${cell.content?.text || ''}`);
                const imgPrompt = `symbolic conceptual icon for ${iconConcept}. Clean vector visual metaphor. No words, letters, numbers, equations, formulas, or labels.`;

                try {
                    const cellSize = this.estimateBentoCellImageSize(cell);
                    const result = await this.generateImage(imgPrompt, theme, false, task.id, cellSize);
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


