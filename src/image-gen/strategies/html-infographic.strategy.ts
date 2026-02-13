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

        // [FORENSIC] Stage 1: LLM Output
        this.logger.warn(`[FORENSIC] Stage 1 (LLM Output): ${JSON.stringify(blueprint)}`);

        const theme = THEME_LIBRARY[blueprint.theme_id] || THEME_LIBRARY['corp_blue'];
        const imageSuffix = theme.image_style_suffix;

        // 2. Load Template
        const templateContent = this.loadTemplate(blueprint.template_id);
        this.logger.log(`Template '${blueprint.template_id}' loaded successfully.`);

        // Forensic Mapping Log
        this.logger.warn(`[FORENSIC] Mapping Data for Template: ${blueprint.template_id}`);
        if (blueprint.template_id === 'hub_radial' && blueprint.center_topic) {
            this.logger.warn(`[FORENSIC] Center Topic Detected: ${blueprint.center_topic.title}`);
        }
        if (blueprint.template_id === 'versus_split' && blueprint.versus_subjects) {
            this.logger.warn(`[FORENSIC] Mapping Versus Left: ${blueprint.versus_subjects.left_name}`);
        }

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

        // [FORENSIC] Stage 2: DOM Initial
        const initialSlots = document.querySelectorAll('[id^="slot_"]');
        this.logger.warn(`[FORENSIC] Stage 2 (DOM Initial): Found ${initialSlots.length} slot elements.`);

        // [FORENSIC] Stage 3: Asset State
        this.logger.warn(`[FORENSIC] Stage 3 (Asset State): itemImages length: ${itemImages.length}. Image Index 0 exists: ${!!itemImages[0]}`);

        // Inject Styles (Theme + Layout Fixes)
        const styleTag = document.querySelector('style') || document.createElement('style');
        if (!document.querySelector('style')) document.head.appendChild(styleTag);

        // V2-RESET-01: ANTI-ELASTIC CSS - Consolidating into V2-DEBUG-20 block below
        // styleTag.textContent += ... (Removed to avoid double injection)


        styleTag.textContent += `
            :root {
            --theme - accent: ${theme.primary_accent} !important;
            --theme - glow: ${theme.primary_accent} !important;
            --primary: ${theme.primary_accent} !important;
            --bg - page: ${theme.background_main} !important;
            --text - main: ${theme.text_main} !important;
            --font - main: '${theme.font_name}', sans - serif!important;
            --glass - bg: ${theme.glass_color || 'rgba(255, 255, 255, 0.1)'} !important;
        }
            body {
            background - color: var(--bg - page)!important;
            color: var(--text - main)!important;
            font - family: var(--font - main)!important;
        }
        h1, h2, h3, h4, h5, h6, .title, .stat - row div, p, span, div {
            font - family: var(--font - main)!important;
            color: var(--text - main);
        }
        h2, .title { font - size: clamp(1.25rem, 2.5vw, 2.5rem)!important; }
            h1 { font - size: clamp(2rem, 5vw, 4rem)!important; }
        p, .description { font - size: clamp(0.875rem, 1.5vw, 1.125rem)!important; }

            /* GLASSMORPHISM & COLLISION FIXES */
            .bento - item, .glass - card, .spoke - container.card - bg, .group {
            background: var(--glass - bg)!important;
            backdrop - filter: blur(12px)!important;
            -webkit - backdrop - filter: blur(12px)!important;
            border: 1px solid rgba(255, 255, 255, 0.1);
            box - shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.1);

            /* Layout Safety */
            height: auto!important;
            min - height: fit - content!important;
            display: flex!important;
            flex - direction: column!important;
            gap: 0.5rem!important;
            position: relative!important;
            z - index: 10!important;
        }

            /* Specific fix for Step Stone text container */
            .step - row.glass - card {
            /* Ensure padding is preserved */
            padding: 2rem!important;
        }

            /* Fail-Safe Text Truncation */
            .line - clamp - 4 {
            display: -webkit - box;
            -webkit - line - clamp: 4;
            -webkit - box - orient: vertical;
            overflow: hidden;
            text - overflow: ellipsis;
        }
            .spoke - container.spoke - icon img,
            .spoke - container img,
            .bento - item img,
            .step - icon img,
            .step - row img,
            .group img {
            width: 100 %;
            height: 100 %;
            object - fit: cover;
            object - position: center;
        }
            .spoke - container.spoke - icon,
            .step - icon,
            .bento - item.flex.items - center.justify - center.rounded - 2xl {
            overflow: hidden;
            display: block;
        }
            .spoke - container h3,
            .bento - item h3,
            .step - row h3,
            .group h3 {
            display: -webkit - box;
            -webkit - line - clamp: 2;
            -webkit - box - orient: vertical;
            overflow: hidden;
            text - overflow: ellipsis;
        }
            .spoke - container p,
            .bento - item p,
            .step - row p,
            .group p {
            display: -webkit - box;
            -webkit - line - clamp: 4;
            -webkit - box - orient: vertical;
            overflow: hidden;
            text - overflow: ellipsis;
        }
        `;

        // [FORENSIC] Stage 5: CSS Audit
        this.logger.warn(`[FORENSIC] Stage 5(CSS Audit): ${styleTag.textContent.substring(0, 500)}...`);

        // V2-DEBUG-09: "Wellness Book" Global CSS Pass
        styleTag.textContent += `
            .glass - card, .step - row, .versus - container {
            background: var(--bg - page)!important;
            color: var(--text - main)!important;
            border: 1px solid rgba(0, 0, 0, 0.1)!important;
            box - shadow: 0 4px 12px rgba(0, 0, 0, 0.05)!important;
        }

        /* V2-DEBUG-09: Versus Contrast Overrides */
        #slot_title_left, #slot_title_right, .stat - row div {
            color: var(--text - main)!important;
            text - shadow: none!important;
        }
        `;

        // Anti-Mud Color Enforcement for Wellness Themes
        if (blueprint.theme_id === 'nature_fresh' || blueprint.visual_style_directive.toLowerCase().includes('wellness') || blueprint.visual_style_directive.toLowerCase().includes('mindful')) {
            styleTag.textContent += `
            .card - bg, #hub - center {
            background: var(--bg - page)!important;
            backdrop - filter: none!important;
        }
        #hub - center h1, #hub - center p, #hub - center h2,
                .card - bg h3, .card - bg p {
            color: var(--text - main)!important;
        }
        `;
        }

        // V2-DEBUG-01 High-Contrast & ID Visibility Force
        if (blueprint.template_id === 'hub_radial') {
            styleTag.textContent += `
        #slot_title_center, .spoke - container h3, .spoke - container p {
            color: var(--text - main)!important; /* Deep charcoal */
            opacity: 1!important;
            visibility: visible!important;
        }
        #hub - center {
            background: var(--bg - page)!important;
            border: 4px solid var(--theme - accent)!important;
        }

        /* V2-DEBUG-03: OVERLORD CSS - FORCE CLEARANCE */
        #main - wrapper, .absolute.inset - 0 {
            display: block!important;
            flex: none!important;
            position: relative!important;
            width: 1200px!important;
            height: 1200px!important;
        }

                /* SPOKE PRECISION */
                .spoke - container {
            /* REMOVED GEOMETRY OVERRIDES TO FIX LAYOUT SHIFT */
            /* Width/Height/Display are now handled by the template's anchor logic (0x0) */
            z - index: 50!important;
            position: absolute!important;
        }
                /* .spoke-container img {
                    width: 120px !important; 
                    height: 120px !important;
                    object-fit: contain !important;
                    margin-bottom: 1rem !important;
                } */
                .spoke - container h3 {
            font - size: 1.15rem!important; /* V2-DEBUG-08 */
            line - height: 1.2!important;
        }
                .spoke - container p {
            font - size: 0.85rem!important; /* V2-DEBUG-08 */
            line - height: 1.4!important;
        }

        /* CENTER VISIBILITY OVERRIDE */
        #hub - center {
            position: absolute!important;
            top: 50 % !important;
            left: 50 % !important;
            transform: translate(-50 %, -50 %)!important;
            width: 360px!important; /* V2-DEBUG-07: Reduced from 400px */
            height: 360px!important;
            background: var(--bg - page)!important;
            border: 6px solid var(--theme - accent)!important;
            z - index: 1000!important;
            display: flex!important;
            align - items: center!important;
            justify - content: center!important;
            border - radius: 50 % !important;
        }

        /* V2-DEBUG-20: ANTI-CENTER & ZERO-ORIGIN FORCE */
        html, body {
            display: block!important; /* KILL FLEX IMMEDIATELY */
            margin: 0!important;
            padding: 0!important;
            width: 1200px!important;
            height: 1200px!important;
            overflow: hidden!important;
            text - align: left!important;
            align - items: flex - start!important;
            justify - content: flex - start!important;
            background - color: var(--bg-page)!important;
            -moz - transform: scale(1);
            -moz - transform - origin: 0 0;
            zoom: 1!important;
        }
        #main - wrapper {
            position: absolute!important; /* Flush to top-left */
            top: 0!important;
            left: 0!important;
            margin: 0!important;
            padding: 0!important;
            width: 1200px!important;
            height: 1200px!important;
            overflow: hidden!important;
            background - color: var(--bg - page)!important; /* Cover magenta if aligned */
        }
        `;
        }

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
            < div class="text-xl font-bold text-right" style = "color: var(--text-main)" > ${valA} </div>
                < div class="text-sm font-black tracking-widest uppercase px-3 py-1 rounded-full mx-auto" style = "color: var(--theme-accent); background: rgba(0,0,0,0.05);" > ${item.title} </div>
                    < div class="text-xl font-bold text-left" style = "color: var(--text-main)" > ${valB} </div>
                        `;
                    statsContainer.appendChild(row);
                });
            }
        } else {
            // Handle center_topic for hub_radial
            if (blueprint.template_id === 'hub_radial' && blueprint.center_topic) {
                const centerTitle = document.getElementById('slot_title_center');
                const centerText = document.getElementById('slot_txt_center');
                if (centerTitle) centerTitle.textContent = blueprint.center_topic.title;
                if (centerText) centerText.textContent = blueprint.center_topic.description;
            }

            let container: Element | null = null;
            let masterItem: Element | null = null;

            if (blueprint.template_id === 'step_stone') {
                container = document.getElementById('item-wrapper');
                masterItem = container?.querySelector('.step-row');
            } else if (blueprint.template_id === 'bento_grid') {
                container = document.getElementById('item-wrapper');
                masterItem = container?.querySelector('.bento-item');
            } else if (blueprint.template_id === 'hub_radial') {
                container = document.getElementById('item-wrapper');
                // Support both legacy .spoke-template and direct .spoke-container
                masterItem = document.querySelector('.spoke-template .spoke-container') || document.querySelector('.spoke-container');
            } else if (blueprint.template_id === 'step_list') {
                container = document.querySelector('.space-y-12');
                masterItem = container?.querySelector('.group');
            }

            if (!container || !masterItem) {
                throw new Error(`Template elements not found for: ${blueprint.template_id} `);
            }

            container.innerHTML = '';

            if (blueprint.template_id === 'hub_radial') {
                // V2-DEBUG-14: PURE CONTENT INJECTION
                // No positioning logic. No styles. Just content.
                // Trusting the template CSS implicitly.

                const total = blueprint.items.length;

                blueprint.items.forEach((item, index) => {
                    const clone = masterItem!.cloneNode(true) as Element;

                    // [FORENSIC] V2-DEBUG-18: Relative Percentage Positioning
                    // Calculate as percentages of the 1200px parent container
                    const radiusPct = 38; // 38% radius
                    const total = blueprint.items.length;
                    const angle = (index / total) * 2 * Math.PI - (Math.PI / 2); // Start at 12 o'clock

                    // V2-DEBUG-18: Standard 50% Center
                    const centerX_pct = 50; // V2-DEBUG-18: Reset to 50%
                    const centerY_pct = 50; // V2-DEBUG-18: Reset to 50%
                    const posX_pct = centerX_pct + (radiusPct * Math.cos(angle));
                    const posY_pct = centerY_pct + (radiusPct * Math.sin(angle));

                    // Inject as % to force the browser to scale them relatively
                    (clone as HTMLElement).style.position = 'absolute';
                    (clone as HTMLElement).style.left = `${posX_pct}% `;
                    (clone as HTMLElement).style.top = `${posY_pct}% `;
                    (clone as HTMLElement).style.transform = 'translate(-50%, -50%)';

                    this.logger.warn(`[FORENSIC] Stage 4(Math & Injection): Item Index: ${index} | Total: ${total} `);
                    this.logger.warn(`[FORENSIC] Inline Styles: ${(clone as HTMLElement).getAttribute('style')} `);

                    // Standard Content Injection
                    const updateId = (prefix: string) => {
                        const el = clone.querySelector(`[id ^= "${prefix}"]`);
                        if (el) el.id = `${prefix}_${index} `;
                        return el;
                    };

                    const img = updateId('slot_img');
                    if (img) img.setAttribute('src', itemImages[index]);

                    const title = updateId('slot_title') || clone.querySelector('h2');
                    if (title) title.textContent = item.title;

                    const txt = updateId('slot_txt') || clone.querySelector('p');
                    if (txt) {
                        txt.classList.add('line-clamp-4');
                        txt.textContent = item.description;
                    }

                    clone.classList.remove('hidden', 'opacity-0', 'invisible');
                    container!.appendChild(clone);
                });

                // V2-DEBUG-18: Red Dot calibration point removed for final delivery
            } else {
                // Standard loop for other templates
                blueprint.items.forEach((item, index) => {
                    const clone = masterItem!.cloneNode(true) as Element;

                    // [FORENSIC] Stage 4: Math & Injection (Non-Radial)
                    this.logger.warn(`[FORENSIC] Stage 4(Math & Injection): Item Index: ${index} `);

                    // Identification Logic
                    const updateId = (prefix: string) => {
                        const el = clone.querySelector(`[id ^= "${prefix}"]`);
                        if (el) el.id = `${prefix}_${index} `;
                        return el;
                    };

                    const img = updateId('slot_img');
                    if (img) img.setAttribute('src', itemImages[index]);

                    const num = updateId('slot_num');
                    if (num) num.textContent = String(index + 1).padStart(2, '0');

                    const title = updateId('slot_title') || clone.querySelector('h2');
                    if (title) title.textContent = item.title;

                    const txt = updateId('slot_txt') || clone.querySelector('p');
                    if (txt) {
                        txt.classList.add('line-clamp-4');
                        txt.textContent = item.description;
                    }

                    const stepNumEl = clone.querySelector('.step-number');
                    if (stepNumEl) stepNumEl.textContent = String(index + 1).padStart(2, '0');

                    clone.classList.remove('hidden', 'opacity-0', 'invisible');
                    container!.appendChild(clone);
                });
            }
        }

        if (backgroundImage) {
            const bgDiv = document.createElement('div');
            bgDiv.style.position = 'fixed';
            bgDiv.style.top = '0';
            bgDiv.style.left = '0';
            bgDiv.style.width = '100vw';
            bgDiv.style.height = '100vh';
            bgDiv.style.zIndex = '-1'; // V2-DEBUG-04: Prevent swallowing spokes
            bgDiv.style.backgroundImage = `url(${backgroundImage})`;
            bgDiv.style.backgroundSize = 'cover';
            bgDiv.style.opacity = blueprint.template_id === 'versus_split' ? '0.2' : '0.3';
            document.body.prepend(bgDiv);
        }

        const finalHtml = dom.serialize();

        // 2. The "State Dump" Debug File: Inject Metadata Header
        const metadataScript = `
            < script id = "forensic-metadata" type = "application/json" >
                ${JSON.stringify(blueprint)}
        </script>
            `;
        const finalHtmlWithMetadata = finalHtml.replace('</body>', `${metadataScript} </body>`);


        // [FORENSIC] Stage 6: Final Serialization
        this.logger.warn(`[FORENSIC] Stage 6 (Final Serialization) Start: ${finalHtmlWithMetadata.substring(0, 500)}`);
        this.logger.warn(`[FORENSIC] Stage 6 (Final Serialization) End: ${finalHtmlWithMetadata.substring(finalHtmlWithMetadata.length - 500)}`);

        // HTML Autopsy Export
        const autopsyDir = path.join(process.cwd(), 'public', 'generated-images');
        const autopsyPath = path.join(autopsyDir, 'debug_last_run.html');
        fs.mkdirSync(autopsyDir, { recursive: true });
        fs.writeFileSync(autopsyPath, finalHtmlWithMetadata);
        this.logger.warn(`[FORENSIC] HTML Autopsy saved to: ${autopsyPath}`);

        // V2-RESET-01: Use Shared "Clip-Only" Capture
        // We rely on BrowserService to handle the 1200x1200px lock and clipping.
        const screenshotBuffer = await this.browserService.screenshotHtml(finalHtmlWithMetadata);

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
