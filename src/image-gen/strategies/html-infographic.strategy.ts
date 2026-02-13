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

// 1. Define Theme Library
export const THEME_LIBRARY = {
    cyber_neon: {
        primary_accent: '#00f3ff',
        background_main: '#09090b', // zinc-950
        text_main: '#e4e4e7',       // zinc-200
        font_family: 'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&display=swap',
        font_name: 'Orbitron',
        image_style_suffix: 'cyberpunk aesthetic, neon lighting, dark background, futuristic, glowing accents, volumetric fog',
        glass_color: 'rgba(0, 0, 0, 0.6)' // Darker glass for better contrast
    },
    corp_blue: {
        primary_accent: '#2563eb',  // blue-600
        background_main: '#ffffff',
        text_main: '#1e293b',       // slate-800
        font_family: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap',
        font_name: 'Inter',
        image_style_suffix: 'corporate memphis style, clean vector art, flat design, professional, white background, minimalist',
        glass_color: 'rgba(255, 255, 255, 0.8)' // Light frost
    },
    nature_fresh: {
        primary_accent: '#16a34a',  // green-600
        background_main: '#fcfbf9', // warm cream
        text_main: '#292524',       // stone-800
        font_family: 'https://fonts.googleapis.com/css2?family=Quicksand:wght@400;700&display=swap',
        font_name: 'Quicksand',
        image_style_suffix: 'minimalist vector icon, ample whitespace around subject, soft edges, organic style, soft lighting, natural colors, matte finish, botanic details, high quality render, abstract background texture, minimalist, high resolution',
        glass_color: 'rgba(255, 255, 255, 0.7)' // Soft organic glass
    },
    warm_creative: {
        primary_accent: '#f59e0b',  // amber-500
        background_main: '#fffbeb', // amber-50
        text_main: '#451a03',       // amber-950
        font_family: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&display=swap',
        font_name: 'Playfair Display',
        image_style_suffix: 'playful 3D style, warm lighting, round shapes, vibrant colors, claymorphism, cheerful',
        glass_color: 'rgba(255, 255, 255, 0.6)' // Warm glass
    }
} as const;

export type ThemeId = keyof typeof THEME_LIBRARY;

export interface HtmlInfographicBlueprint {
    template_id: 'hub_radial' | 'step_list' | 'step_stone' | 'bento_grid' | 'versus_split';
    theme_id: ThemeId;
    visual_style_directive: string;
    center_topic?: {
        title: string;
        description: string;
    };
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
        if (!apiKey) {
            this.logger.warn('OPENROUTER_API_KEY not found. Blueprint generation will fail.');
        }
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
        this.logger.warn(`[FORENSIC] Strategy Input: ${task.refined_prompt}`);
        this.logger.log(`Starting HTML Infographic Generation for: ${task.refined_prompt}`);

        // 1. Generate Blueprint
        let blueprint: HtmlInfographicBlueprint;
        try {
            blueprint = await this.generateBlueprint(task.refined_prompt);
            this.logger.log(`Blueprint generated: Template=${blueprint.template_id}, Theme=${blueprint.theme_id}, Items=${blueprint.items.length}`);
        } catch (error) {
            this.logger.error(`Blueprint generation failed: ${error.message}`);
            throw error;
        }

        const theme = THEME_LIBRARY[blueprint.theme_id] || THEME_LIBRARY['corp_blue'];
        const imageSuffix = theme.image_style_suffix;

        // 2. Load Template
        const templateContent = this.loadTemplate(blueprint.template_id);
        this.logger.log(`Template '${blueprint.template_id}' loaded successfully.`);

        // 3. Image Generation
        let itemImages: string[] = [];
        let backgroundImage = '';
        let versusImages: Record<string, string> = {};

        if (blueprint.template_id === 'versus_split' && blueprint.versus_subjects) {
            this.logger.log(`Generating Versus images for subjects...`);
            const p1 = this.generateImage(blueprint.versus_subjects.left_image_prompt, theme.primary_accent, false, imageSuffix)
                .then(b64 => ({ key: 'left', base64: b64 }));
            const p2 = this.generateImage(blueprint.versus_subjects.right_image_prompt, theme.primary_accent, false, imageSuffix)
                .then(b64 => ({ key: 'right', base64: b64 }));
            const pBg = this.generateImage("Subtle abstract background, split screen contest", theme.primary_accent, true, imageSuffix)
                .then(b64 => ({ key: 'bg', base64: b64 }));
            const results = await Promise.all([p1, p2, pBg]);
            results.forEach(r => versusImages[r.key] = r.base64);
            backgroundImage = versusImages['bg'];
        } else {
            this.logger.log(`Starting parallel image generation for ${blueprint.items.length} items...`);
            const itemImagePromises = blueprint.items.map((item, idx) =>
                this.generateImage(`${item.title}: ${item.description}`, theme.primary_accent, false, imageSuffix)
                    .then(base64 => ({ index: idx, base64 }))
            );
            const backgroundImagePromise = this.generateImage("Abstract background texture", theme.primary_accent, true, imageSuffix)
                .then(base64 => ({ index: -1, base64 }));
            const results = await Promise.all([...itemImagePromises, backgroundImagePromise]);
            itemImages = new Array(blueprint.items.length);
            results.forEach(res => {
                if (res.index === -1) backgroundImage = res.base64;
                else itemImages[res.index] = res.base64;
            });
        }
        this.logger.log('Image generation completed.');

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
            }

            /* Layout Safety */
            .glass-card, .bento-card, .step-row {
                background: var(--glass-bg) !important;
                backdrop-filter: blur(12px) !important;
            }

            /* Fail-Safe Text Truncation */
            .line-clamp-4 {
                display: -webkit-box;
                -webkit-line-clamp: 4;
                -webkit-box-orient: vertical;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            /* V2-DEBUG-20: ANTI-CENTER & ZERO-ORIGIN FORCE */
            html, body {
                display: block !important;
                margin: 0 !important;
                padding: 0 !important;
                width: 1200px !important;
                height: 1200px !important;
                overflow: hidden !important;
                text-align: left !important;
            }
            #main-wrapper {
                position: absolute !important;
                top: 0 !important;
                left: 0 !important;
                width: 1200px !important;
                height: 1200px !important;
            }
        `;

        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = theme.font_family;
        document.head.appendChild(link);

        // Data Injection
        if (blueprint.template_id === 'versus_split' && blueprint.versus_subjects) {
            const leftImg = document.getElementById('slot_image_left');
            const rightImg = document.getElementById('slot_image_right');
            if (leftImg) leftImg.setAttribute('src', versusImages['left']);
            if (rightImg) rightImg.setAttribute('src', versusImages['right']);

            const leftTitle = document.getElementById('slot_title_left');
            const rightTitle = document.getElementById('slot_title_right');
            if (leftTitle) leftTitle.textContent = blueprint.versus_subjects.left_name;
            if (rightTitle) rightTitle.textContent = blueprint.versus_subjects.right_name;

            const statsContainer = document.getElementById('slot_stats_container');
            if (statsContainer) {
                statsContainer.innerHTML = '';
                blueprint.items.forEach(item => {
                    const parts = item.description.split('|');
                    const valA = parts[0]?.trim() || '-';
                    const valB = parts[1]?.trim() || '-';

                    const row = document.createElement('div');
                    row.className = 'stat-row flex items-center justify-between border-b border-white/5 pb-4';
                    row.innerHTML = `
                        <div class="stat-value text-right w-[400px] text-xl font-bold" style="color: var(--text-main)">${valA}</div>
                        <div class="stat-label px-4 py-1 rounded-full text-xs font-black uppercase tracking-widest bg-black/20" style="color: var(--theme-accent)">${item.title}</div>
                        <div class="stat-value text-left w-[400px] text-xl font-bold" style="color: var(--text-main)">${valB}</div>
                    `;
                    statsContainer.appendChild(row);
                });
            }
        } else {
            if (blueprint.template_id === 'hub_radial' && blueprint.center_topic) {
                const centerTitle = document.getElementById('slot_title_center');
                const centerText = document.getElementById('slot_txt_center');
                if (centerTitle) centerTitle.textContent = blueprint.center_topic.title;
                if (centerText) centerText.textContent = blueprint.center_topic.description;
            }

            const itemWrapper = document.getElementById('item-wrapper');
            const masterItem = document.querySelector('.spoke-container') ||
                document.querySelector('.step-row') ||
                document.querySelector('.bento-card') ||
                document.querySelector('.group');

            if (itemWrapper && masterItem) {
                itemWrapper.innerHTML = '';
                blueprint.items.forEach((item, index) => {
                    const clone = masterItem.cloneNode(true) as HTMLElement;
                    clone.id = `item_${index}`;

                    // Add absolute anchor classes for Bento
                    if (blueprint.template_id === 'bento_grid') {
                        clone.classList.add(`card-${index}`);
                    }

                    // Hub Radial Positioning
                    if (blueprint.template_id === 'hub_radial') {
                        const radiusPct = 38;
                        const total = blueprint.items.length;
                        const angle = (index / total) * 2 * Math.PI - (Math.PI / 2);
                        const posX_pct = 50 + (radiusPct * Math.cos(angle));
                        const posY_pct = 50 + (radiusPct * Math.sin(angle));
                        clone.style.position = 'absolute';
                        clone.style.left = `${posX_pct}%`;
                        clone.style.top = `${posY_pct}%`;
                        clone.style.transform = 'translate(-50%, -50%)';
                    }

                    const updateId = (prefix: string) => {
                        const el = clone.querySelector(`[id^="${prefix}"]`);
                        if (el) el.id = `${prefix}_${index}`;
                        return el;
                    };

                    const img = updateId('slot_img');
                    if (img) img.setAttribute('src', itemImages[index]);

                    const title = updateId('slot_title') || clone.querySelector('h2') || clone.querySelector('h3');
                    if (title) title.textContent = item.title;

                    const txt = updateId('slot_txt') || clone.querySelector('p');
                    if (txt) {
                        txt.classList.add('line-clamp-4');
                        txt.textContent = item.description;
                    }

                    const stepNumEl = clone.querySelector('.step-number');
                    if (stepNumEl) stepNumEl.textContent = String(index + 1).padStart(2, '0');

                    clone.classList.remove('hidden', 'opacity-0', 'invisible');
                    itemWrapper.appendChild(clone);
                });
            }
        }

        if (backgroundImage) {
            const bgDiv = document.createElement('div');
            bgDiv.style.position = 'fixed';
            bgDiv.style.inset = '0';
            bgDiv.style.zIndex = '-1';
            bgDiv.style.backgroundImage = `url(${backgroundImage})`;
            bgDiv.style.backgroundSize = 'cover';
            bgDiv.style.opacity = blueprint.template_id === 'versus_split' ? '0.2' : '0.3';
            document.body.prepend(bgDiv);
        }

        const finalHtml = dom.serialize();
        const screenshotBuffer = await this.browserService.screenshotHtml(finalHtml);

        const filename = `html_infographic_${Date.now()}.png`;
        const publicUrl = await this.localStorage.save(filename, screenshotBuffer);
        this.logger.log(`Infographic saved to: ${publicUrl}`);

        return {
            url: publicUrl,
            posterUrl: publicUrl,
            payload: { blueprint, html: finalHtml }
        };
    }

    public async generateBlueprint(prompt: string): Promise<HtmlInfographicBlueprint> {
        if (!this.openai) throw new Error('OpenRouter API Key not configured/found.');

        const systemPrompt = `You are an expert Data Visualization Architect.
Goal: Select template, define style, generate structured content.

Templates: 'hub_radial', 'step_list', 'step_stone', 'bento_grid', 'versus_split'.
Themes: 'cyber_neon', 'corp_blue', 'nature_fresh', 'warm_creative'.

Task:
1. Select Template & Theme.
2. Generate Items (3-9 normal, 3-5 vs).
3. FOR THEME: Select based on topic (Tech->Cyber, Biz->Corp, Nature->Nature, Fun->Warm).
4. FOR HUB_RADIAL: Provide the main subject in "center_topic" object and supporting details in "items" array. Do NOT repeat the center topic in the items array.

OUTPUT ONLY VALID JSON, NO MARKDOWN:
{
  "template_id": "...",
  "theme_id": "...",
  "visual_style_directive": "...",
  "center_topic": { "title": "...", "description": "..." },
  "versus_subjects": { "left_name": "", "right_name": "", "left_image_prompt": "", "right_image_prompt": "" },
  "items": [ { "title": "...", "description": "..." } ]
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
            console.log(`[FORENSIC] LLM Blueprint Result: ${content}`);

            const text = content.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(text) as HtmlInfographicBlueprint;
            if (!THEME_LIBRARY[parsed.theme_id]) parsed.theme_id = 'corp_blue';
            return parsed;
        } catch (e) {
            this.logger.error('Blueprint Generation Failed', e);
            throw e;
        }
    }

    public loadTemplate(id: string): string {
        const templatesDir = path.join(process.cwd(), 'public', 'assets', 'infographics', 'templates');
        const filePath = path.join(templatesDir, `${id}.html`);
        if (!fs.existsSync(filePath)) throw new Error(`Template not found: ${filePath}`);
        return fs.readFileSync(filePath, 'utf-8');
    }

    private async generateImage(prompt: string, accentColor: string, isBackground: boolean, styleDirective: string): Promise<string> {
        const apiKey = this.configService.get<string>('SILICONFLOW_API_KEY');
        if (!apiKey) return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

        // Detect wellness/mindfulness content
        const wellnessKeywords = ['wellness', 'mindfulness', 'stress', 'autonomic', 'nervous', 'meditation', 'breathing', 'relaxation'];
        const isWellness = wellnessKeywords.some(kw => prompt.toLowerCase().includes(kw));

        let fullPrompt = isBackground
            ? `${styleDirective}, abstract background texture, minimalist, harmonious with ${accentColor}, high resolution`
            : isWellness
                ? `${prompt}, hand-drawn watercolor illustration, soft charcoal edges, isolated on white background --no text, 3d, realistic, shadows`
                : `${styleDirective}, ${prompt}, centered, high resolution, professional design, isolated on white background, matching ${accentColor}`;

        console.log(`[FORENSIC] SiliconFlow Image Prompt: ${fullPrompt}`);

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
