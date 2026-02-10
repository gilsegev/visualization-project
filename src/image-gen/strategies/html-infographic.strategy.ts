import { Injectable, Logger } from '@nestjs/common';
import { BaseImageStrategy, ImageGenerationResult } from '../base-image.strategy';
import { ImageTask } from '../image-task.schema';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { BrowserService } from '../browser.service';
import { LocalStorageService } from '../local-storage.service';
import axios from 'axios';
import * as pLimit from 'p-limit';

import { THEME_LIBRARY, ThemeId, ThemeConfig } from '../themes.config';

export interface HtmlInfographicBlueprint {
    template_id: 'hub_radial' | 'step_list' | 'step_stone' | 'bento_grid' | 'versus_split';
    theme_id: ThemeId;
    visual_style_directive: string;
    center_topic?: { title: string; description: string; };
    versus_subjects?: {
        left_name: string;
        right_name: string;
        left_image_prompt: string;
        right_image_prompt: string;
    };
    items: {
        title: string;
        description: string;
    }[];
}

@Injectable()
export class HtmlInfographicStrategy extends BaseImageStrategy {
    private openai: OpenAI;

    constructor(
        protected readonly configService: ConfigService,
        protected readonly browserService: BrowserService,
        protected readonly localStorage: LocalStorageService
    ) {
        super();
        const apiKey = this.configService.get<string>('OPENROUTER_API_KEY');
        const baseURL = 'https://openrouter.ai/api/v1';

        if (apiKey) {
            this.openai = new OpenAI({
                baseURL,
                apiKey,
                defaultHeaders: {
                    'HTTP-Referer': 'https://visualization-project.com',
                    'X-Title': 'Visualization Project',
                }
            });
        } else {
            this.logger.warn('OPENROUTER_API_KEY not found. Blueprint generation will fail.');
        }
    }

    public async performGeneration(task: ImageTask, index?: number): Promise<ImageGenerationResult> {
        this.logger.log(`Starting HTML Infographic Generation for: ${task.refined_prompt}`);

        const payload = task.payload as any;
        const styleAnchor = payload?.style_anchor;
        const expectedTemplateId = payload?.template_id;

        // 1. Generate Blueprint
        let blueprint: HtmlInfographicBlueprint;
        try {
            blueprint = await this.generateBlueprint(task.refined_prompt, styleAnchor, expectedTemplateId);
            // [DEBUG: BLUEPRINT] - Forensic Log (Prompt 45)
            this.logger.debug(`[DEBUG: BLUEPRINT] ${JSON.stringify(blueprint, null, 2)}`);
        } catch (error) {
            this.logger.error(`Blueprint generation failed: ${error.message}`);
            throw error;
        }

        // 2. Precedence Logic: payload.custom_theme -> THEME_LIBRARY[blueprint.theme_id] -> corp_blue
        const themeId = payload?.theme_id || blueprint.theme_id || 'corp_blue';
        const themeBase = THEME_LIBRARY[themeId] || THEME_LIBRARY['corp_blue'];
        const theme: ThemeConfig = {
            ...themeBase,
            primary_accent: payload?.custom_theme?.primary_accent || payload?.custom_palette?.accent || themeBase.primary_accent,
            background_main: payload?.custom_theme?.background_main || payload?.custom_palette?.background || themeBase.background_main,
            text_main: payload?.custom_theme?.text_main || payload?.custom_palette?.text || themeBase.text_main,
        };
        const imageSuffix = styleAnchor || theme.image_style_suffix;

        // [DEBUG: COLOR SCHEME] - Purity Audit (Prompt 45)
        this.logger.debug(`[DEBUG: COLOR_SCHEME] Theme merge result:`);
        this.logger.debug(`  Base Theme: ${themeId}`);
        this.logger.debug(`  Primary Accent: ${theme.primary_accent}`);
        this.logger.debug(`  Background: ${theme.background_main}`);
        this.logger.debug(`  Text: ${theme.text_main}`);
        this.logger.debug(`  Custom Theme Override: ${payload?.custom_theme ? 'YES' : 'NO'}`);

        // [DEBUG: THEME_FINAL] - Prompt 47
        this.logger.debug(`[DEBUG: THEME_FINAL] ${JSON.stringify(theme)}`);

        // 3. Load Template
        const templateContent = this.loadTemplate(blueprint.template_id);
        this.logger.log(`Template '${blueprint.template_id}' loaded successfully.`);

        // 4. Image Generation
        let itemImages: string[] = [];
        let backgroundImage = '';
        let versusImages: Record<string, string> = {};

        if (blueprint.template_id === 'versus_split' && blueprint.versus_subjects) {
            this.logger.log(`Generating Versus images for subjects...`);
            const p1 = this.generateImage(blueprint.versus_subjects.left_image_prompt, theme, false, styleAnchor)
                .then(b64 => ({ key: 'left', base64: b64 }));
            const p2 = this.generateImage(blueprint.versus_subjects.right_image_prompt, theme, false, styleAnchor)
                .then(b64 => ({ key: 'right', base64: b64 }));
            const pBg = this.generateImage("Clean split comparison layout", theme, true, styleAnchor)
                .then(b64 => ({ key: 'bg', base64: b64 }));
            const results = await Promise.all([p1, p2, pBg]);
            results.forEach(r => versusImages[r.key] = r.base64);
            backgroundImage = versusImages['bg'];
        } else {
            this.logger.log(`Starting parallel image generation for ${blueprint.items.length} items...`);
            const promises = blueprint.items.map((item, idx) =>
                this.generateImage(`${item.title}: ${item.description}`, theme, false, styleAnchor)
                    .then(base64 => ({ index: idx, base64 }))
            );
            promises.push(this.generateImage("Abstract background texture", theme, true, styleAnchor).then(base64 => ({ index: -1, base64 })));

            const results = await Promise.all(promises);
            itemImages = new Array(blueprint.items.length);
            results.forEach(res => {
                if (res.index === -1) backgroundImage = res.base64;
                else itemImages[res.index] = res.base64;
            });
        }
        this.logger.log('Image generation completed.');

        // [DEBUG: ELEMENT COUNT] - Enforcement (Prompt 45)
        this.logger.log(`[DEBUG: ELEMENT_COUNT] Final item count for render: ${blueprint.items.length}`);
        const expectedCount = payload?.visualizations?.length || 0;
        if (expectedCount > 0 && blueprint.items.length !== expectedCount) {
            this.logger.warn(`[WARNING] Item count mismatch! Expected: ${expectedCount}, Got: ${blueprint.items.length}`);
        }

        // 4. DOM Manipulation
        const dom = new JSDOM(templateContent);
        const document = dom.window.document;

        // Inject Styles (Theme + Layout Fixes)
        const styleTag = document.querySelector('style') || document.createElement('style');
        if (!document.querySelector('style')) document.head.appendChild(styleTag);

        styleTag.textContent += `
            :root { 
                --theme-accent: ${theme.primary_accent} !important;
                --theme-glow: ${theme.primary_accent} !important;
                --primary: ${theme.primary_accent} !important;
                --bg-page: ${theme.background_main} !important;
                --text-main: ${theme.text_main} !important;
                --font-main: '${theme.font_name}', sans-serif !important;
                --glass-bg: ${theme.glass_color || 'rgba(255, 255, 255, 0.1)'} !important;
            }
            body {
                background-color: var(--bg-page) !important;
                color: var(--text-main) !important;
                font-family: var(--font-main) !important;
            }
            h1, h2, h3, h4, h5, h6, .title, .stat-row div, p, span, div { 
                font-family: var(--font-main) !important; 
                color: var(--text-main); 
            }
            h2, .title { font-size: clamp(1.25rem, 2.5vw, 2.5rem) !important; }
            h1 { font-size: clamp(2rem, 5vw, 4rem) !important; }
            p, .description { font-size: clamp(0.875rem, 1.5vw, 1.125rem) !important; }

            /* GLASSMORPHISM & COLLISION FIXES */
            .bento-item, .glass-card, .spoke-container .card-bg, .group {
                background: var(--glass-bg) !important;
                backdrop-filter: blur(12px) !important;
                -webkit-backdrop-filter: blur(12px) !important;
                border: 1px solid rgba(255, 255, 255, 0.1);
                box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.1);
                
                /* Layout Safety */
                height: auto !important;
                min-height: fit-content !important;
                display: flex !important;
                flex-direction: column !important;
                gap: 0.5rem !important;
                position: relative !important;
                z-index: 10 !important;
            }
            
            /* Specific fix for Step Stone text container */
            .step-row .glass-card {
                 /* Ensure padding is preserved */
                 padding: 2rem !important; 
            }

            /* Fail-Safe Text Truncation */
            .line-clamp-4 {
                display: -webkit-box;
                -webkit-line-clamp: 4;
                -webkit-box-orient: vertical;  
                overflow: hidden;
                text-overflow: ellipsis;
            }

            /* Prompt 41: Template Readability & Spacing */
            .text-container, .glass-card p, .glass-card h2, .bento-item p, .spoke-container .card-bg p {
                max-width: 80% !important;
                margin-left: auto !important;
                margin-right: auto !important;
                text-align: center !important;
            }

            .timeline-container {
                gap: 38px !important; /* Increased from 32px by ~20% */
            }
            
            /* Wellness High-Contrast (Prompt 46) */
            ${themeId === 'wellness_mindful' ? `
                .glass-card, .bento-item, .spoke-container .card-bg {
                    background: #FFFFFF !important;
                    backdrop-filter: none !important;
                    -webkit-backdrop-filter: none !important;
                }
                h1, h2, h3, h4, h5, h6, p, div, span {
                    font-weight: 600 !important;
                }
            ` : ''}
        `;

        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = theme.font_family;
        document.head.appendChild(link);

        if (blueprint.template_id === 'versus_split' && blueprint.versus_subjects) {
            const leftImg = document.getElementById('slot_image_left');
            if (leftImg) leftImg.setAttribute('src', versusImages['left']);
            const rightImg = document.getElementById('slot_image_right');
            if (rightImg) rightImg.setAttribute('src', versusImages['right']);

            const leftTitle = document.getElementById('slot_title_left');
            if (leftTitle) leftTitle.textContent = blueprint.versus_subjects.left_name;
            const rightTitle = document.getElementById('slot_title_right');
            if (rightTitle) rightTitle.textContent = blueprint.versus_subjects.right_name;

            const statsContainer = document.getElementById('slot_stats_container');
            if (statsContainer) {
                statsContainer.innerHTML = '';
                blueprint.items.forEach(item => {
                    const parts = item.description.split('|');
                    const valA = parts[0]?.trim() || '-';
                    const valB = parts[1]?.trim() || '-';

                    const row = document.createElement('div');
                    row.className = 'stat-row grid grid-cols-3 gap-8 items-center text-center py-4 border-b border-white/10';
                    row.style.borderColor = 'rgba(255,255,255,0.1)';
                    row.innerHTML = `
                        <div class="text-xl font-bold text-right" style="color: var(--text-main)">${valA}</div>
                        <div class="text-sm font-black tracking-widest uppercase px-3 py-1 rounded-full mx-auto" style="color: var(--theme-accent); background: rgba(0,0,0,0.05);">${item.title}</div>
                        <div class="text-xl font-bold text-left" style="color: var(--text-main)">${valB}</div>
                     `;
                    statsContainer.appendChild(row);
                });
            }
        } else {
            let container: Element | null = null;
            let masterItem: Element | null = null;

            if (blueprint.template_id === 'step_stone') {
                container = document.querySelector('.timeline-container');
                masterItem = container?.querySelector('.step-row');
            } else if (blueprint.template_id === 'bento_grid') {
                container = document.getElementById('item-wrapper');
                masterItem = container?.querySelector('.bento-item');
            } else if (blueprint.template_id === 'hub_radial') {
                container = document.querySelector('.absolute.inset-0');
                masterItem = container?.querySelector('.spoke-container');
            } else if (blueprint.template_id === 'step_list') {
                container = document.querySelector('.space-y-12');
                masterItem = container?.querySelector('.group');
            }

            if (!container || !masterItem) {
                throw new Error(`Template elements not found for: ${blueprint.template_id}`);
            }

            container.innerHTML = '';

            // Hub Center Mapping (Prompt 44): First item goes to center
            if (blueprint.template_id === 'hub_radial' && blueprint.items.length > 0) {
                // [DEBUG: ITEM_MAPPING] - Hub Center (Prompt 45)
                this.logger.debug(`[DEBUG: ITEM_MAPPING] Hub Center Assignment:`);
                this.logger.debug(`  Item[0] -> #slot_title_center: "${blueprint.items[0].title}"`);
                this.logger.debug(`  Item[0] -> #slot_txt_center: "${blueprint.items[0].description}"`);

                const centerTitle = document.getElementById('slot_title_center');
                const centerTxt = document.getElementById('slot_txt_center');
                if (centerTitle) centerTitle.textContent = blueprint.items[0].title;
                if (centerTxt) centerTxt.textContent = blueprint.items[0].description;

                // Process remaining items as spokes
                const spokeItems = blueprint.items.slice(1);
                const total = spokeItems.length;
                const radius = 42; // percent from center
                spokeItems.forEach((item, index) => {
                    const clone = masterItem!.cloneNode(true) as Element;

                    // Identification Logic
                    const setContent = (selector: string | null, val: string, isText = true) => {
                        if (!selector) return; // Should we querySelector?
                        // Logic below uses explicit IDs or classes
                    };

                    // ID Correction Loop
                    const updateId = (prefix: string) => {
                        const el = clone.querySelector(`[id^="${prefix}"]`);
                        if (el) el.id = `${prefix}_${index}`;
                        return el;
                    };

                    const img = updateId('slot_img');
                    if (img) img.setAttribute('src', itemImages[index]);

                    const num = updateId('slot_num');
                    if (num) num.textContent = String(index + 1).padStart(2, '0');

                    const title = updateId('slot_title') || clone.querySelector('h2');
                    if (title) {
                        title.textContent = item.title;
                        // Ensure title doesn't break layout if too long?
                    }

                    const txt = updateId('slot_txt') || clone.querySelector('p');
                    if (txt) {
                        txt.classList.add('line-clamp-4'); // Apply Fail-Safe
                        txt.textContent = item.description;
                    }

                    // Step List fallback
                    const stepNumEl = clone.querySelector('.step-number');
                    if (stepNumEl) stepNumEl.textContent = String(index + 1).padStart(2, '0');

                    // Hub Radial fallback
                    if (!img && blueprint.template_id === 'hub_radial') {
                        // Check existing simple <img> logic
                        const imgEl = clone.querySelector('img');
                        if (imgEl) imgEl.src = itemImages[index];
                    }

                    // Mathematical spoke positioning (Prompt 46)
                    if (blueprint.template_id === 'hub_radial') {
                        const angle = (index / total) * 2 * Math.PI;
                        const x = 50 + Math.cos(angle) * radius;
                        const y = 50 + Math.sin(angle) * radius;
                        clone.setAttribute('style', `left: ${x}%; top: ${y}%; --i: ${index};`);

                        // [MATH: HUB] - Prompt 47
                        this.logger.debug(`[MATH: HUB] Spoke ${index}: Angle=${angle.toFixed(3)}rad, X=${x.toFixed(2)}%, Y=${y.toFixed(2)}%, Radius=${radius}%`);
                    }

                    container!.appendChild(clone);
                });

                if (blueprint.template_id === 'hub_radial') {
                    container.setAttribute('style', `--total: ${blueprint.items.length};`);
                }
            }

            if (backgroundImage) {
                const bgDiv = document.createElement('div');
                bgDiv.style.position = 'fixed';
                bgDiv.style.top = '0';
                bgDiv.style.left = '0';
                bgDiv.style.width = '100vw';
                bgDiv.style.height = '100vh';
                bgDiv.style.zIndex = '-50';
                bgDiv.style.backgroundImage = `url(${backgroundImage})`;
                bgDiv.style.backgroundSize = 'cover';
                bgDiv.style.opacity = '0.3';
                document.body.prepend(bgDiv);
            }

            const finalHtml = dom.serialize();

            // [DEBUG: HTML_EXPORT] - Prompt 47: Save raw HTML
            const debugHtmlPath = path.join(payload?.folder || '', `debug_${task.refined_prompt.slice(0, 20).replace(/\s+/g, '_')}_${Date.now()}.html`);
            await this.localStorage.save(debugHtmlPath, Buffer.from(finalHtml, 'utf-8'));
            this.logger.debug(`[DEBUG: HTML_EXPORT] Saved to: ${debugHtmlPath}`);

            this.logger.log('Rendering HTML to Image...');
            const screenshotBuffer = await this.browserService.screenshotHtml(finalHtml);
            const folder = payload?.folder || '';
            const filename = path.join(folder, `html_infographic_${Date.now()}.png`);
            const publicUrl = await this.localStorage.save(filename, screenshotBuffer);
            this.logger.log(`Infographic saved to: ${publicUrl}`);

            return {
                url: publicUrl,
                posterUrl: publicUrl,
                payload: { blueprint, html: finalHtml }
            };
        }

    public async generateBlueprint(prompt: string, styleAnchor?: string, expectedTemplateId?: string): Promise<HtmlInfographicBlueprint> {
        if (!this.openai) throw new Error('OpenRouter API Key not configured/found.');

        const systemMessage = `
            You are an expert Data Visualization Architect.
            Goal: Select template, define style, generate structured content.

            Templates: 'hub_radial', 'step_list', 'step_stone', 'bento_grid', 'versus_split'.
            Themes: 'cyber_neon', 'corp_blue', 'nature_fresh', 'warm_creative', 'wellness_mindful'.
        `;

        const userMessage = `
            User Request: "${prompt}"
            ${styleAnchor ? `STRICT STYLE VIBE: ${styleAnchor}` : ''}

            Task:
            1. Select Template & Theme. ${expectedTemplateId ? `REQUIRED TEMPLATE: ${expectedTemplateId}` : ''}
            2. FOR HUB_RADIAL: Use "center_topic" for core subject, "items" (3-8) for spokes. DO NOT repeat center in items.
            3. FOR OTHER TEMPLATES: Generate 3-9 items.
            4. Theme: Tech->Cyber, Biz->Corp, Nature->Nature, Fun->Warm, Wellness->Wellness.
            
            OUTPUT JSON ONLY:
            {
                "template_id": "...",
                "theme_id": "...",
                "visual_style_directive": "...",
                "center_topic": { "title": "...", "description": "..." },
                "versus_subjects": { "left_name": "", "right_name": "", "left_image_prompt": "", "right_image_prompt": "" },
                "items": [ { "title": "...", "description": "..." } ]
            }
        `;

        try {
            const completion = await this.generateWithBackoff(() => this.openai.chat.completions.create({
                model: 'google/gemini-2.0-flash-001',
                messages: [
                    { role: 'system', content: systemMessage },
                    { role: 'user', content: userMessage }
                ],
                response_format: { type: 'json_object' }
            }));

            const text = completion.choices[0].message.content;
            const parsed = JSON.parse(text) as HtmlInfographicBlueprint;
            if (!THEME_LIBRARY[parsed.theme_id]) parsed.theme_id = 'corp_blue';
            return parsed;
        } catch (e) {
            this.logger.error('Blueprint Generation Failed', e);
            throw e;
        }
    }

    private async generateWithBackoff(apiCall: () => Promise<any>, retries = 5, initialDelay = 5000): Promise<any> {
        let attempt = 0;
        let delay = initialDelay;

        while (attempt <= retries) {
            try {
                return await apiCall();
            } catch (error) {
                if (error.message.includes('429') || error.message.includes('Resource exhausted')) {
                    attempt++;
                    if (attempt > retries) throw error;
                    this.logger.warn(`Gemini 429 detected. Retrying in ${delay}ms... (Attempt ${attempt}/${retries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2;
                } else {
                    throw error;
                }
            }
        }
    }

    public loadTemplate(id: string): string {
        const templatesDir = path.join(process.cwd(), 'public', 'assets', 'infographics', 'templates');
        const filePath = path.join(templatesDir, `${id}.html`);
        if (!fs.existsSync(filePath)) throw new Error(`Template not found: ${filePath}`);
        return fs.readFileSync(filePath, 'utf-8');
    }

    private async generateImage(prompt: string, theme: ThemeConfig, isBackground: boolean, styleAnchor?: string): Promise<string> {
        const apiKey = this.configService.get<string>('SILICONFLOW_API_KEY');
        if (!apiKey) return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

        // Atomic Prompt Engine (Prompt 44)
        let fullPrompt: string;
        const isWellness = styleAnchor?.toLowerCase().includes('wellness') || styleAnchor?.toLowerCase().includes('watercolor');

        if (isBackground) {
            fullPrompt = isWellness
                ? `high-quality heavy grain watercolor paper texture, cream-white #FAF9F6 --no text, patterns, images`
                : `very faint high-quality paper texture background, solid light color, almost white, minimalist, clean --no text, blurry, distorted, messy, shadows`;
        } else if (isWellness) {
            fullPrompt = `${prompt}, hand-drawn charcoal lines, soft watercolor wash, ${theme.primary_accent} accents, minimal detail, white background --no 3d, text, shadows, frame`;
        } else {
            const styleDirective = styleAnchor ? `${styleAnchor}, ` : "";
            fullPrompt = `${styleDirective}${prompt}, minimalist line art, vector icon, flat colors, ${theme.primary_accent} accents, white background --no shadows, 3d, realistic, blurry, text`;
        }

        this.logger.log(`SiliconFlow Prompt: ${fullPrompt}`);

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
            throw new Error('No image URL');
        } catch (e) {
            this.logger.error(`Image Gen Failed: ${e.message}`);
            return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
        }
    }
}
