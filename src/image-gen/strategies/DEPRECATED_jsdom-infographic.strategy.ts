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
import { performance } from 'perf_hooks';

import { THEME_LIBRARY, Theme, ThemeId } from '../themes.config';

// Removed local THEME_LIBRARY definition



export interface HtmlInfographicBlueprint {
    template_id: 'hub_radial' | 'step_list' | 'step_stone' | 'bento_grid' | 'versus_split' | 'steps';
    theme_id: ThemeId;
    visual_style_directive: string;
    background_url?: string; // For templates like "steps" requiring a full bg
    center_topic?: {
        title: string;
        description: string;
    };
    // Update for Versus Split (Array of subjects)
    versus_subjects?: {
        name: string;
        description?: string; // e.g. "The Challenger"
        image_url?: string;   // Populated after generation
        image_prompt?: string; // Optional prompt override
    }[];
    // New Verdict field
    verdict?: {
        title: string;
        text: string;
    };
    items: {
        title: string;
        description: string;
        // Optional structural fields for Versus
        icon?: string;
        left?: { value: string; description: string };
        right?: { value: string; description: string };
    }[];
}

@Injectable()
export class DEPRECATED_HtmlInfographicStrategy extends BaseImageStrategy {
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
        const metrics = {
            start: performance.now(),
            blueprint: 0,
            images: 0,
            dom: 0,
            browser: 0,
            total: 0
        };

        this.logger.warn(`[FORENSIC] Strategy Input: ${task.refined_prompt}`);
        this.logger.log(`Starting HTML Infographic Generation for: ${task.refined_prompt}`);

        // 1. Generate Blueprint
        const blueprintStart = performance.now();
        let blueprint: HtmlInfographicBlueprint;
        try {
            blueprint = await this.generateBlueprint(task.refined_prompt);
            metrics.blueprint = performance.now() - blueprintStart;
            this.logger.log(`Blueprint generated in ${metrics.blueprint.toFixed(2)}ms: Template=${blueprint.template_id}, Theme=${blueprint.theme_id}, Items=${blueprint.items.length}`);
        } catch (error) {
            this.logger.error(`Blueprint generation failed: ${error.message}`);
            throw error;
        }

        // Resolve Theme (Payload > Blueprint > Default)
        let theme: Theme;
        const taskAny = task as any;
        if (taskAny.metadata?.custom_theme) {
            this.logger.log(`[Theme] Using Custom Theme override from payload.`);
            theme = taskAny.metadata.custom_theme as Theme;
        } else {
            theme = THEME_LIBRARY[blueprint.theme_id] || THEME_LIBRARY['corp_blue'];
        }

        // 2. Load Template
        const templateContent = this.loadTemplate(blueprint.template_id);
        this.logger.log(`Template '${blueprint.template_id}' loaded successfully.`);

        // 3. Image Generation
        const imagesStart = performance.now();
        let itemImages: string[] = [];
        let backgroundImage = '';
        let versusImages: Record<string, string> = {};

        if (blueprint.template_id === 'versus_split' && blueprint.versus_subjects) {
            this.logger.log(`Generating Versus images for subjects...`);
            const subLeft = blueprint.versus_subjects[0] || { name: 'Left', image_prompt: 'Left Subject' };
            const subRight = blueprint.versus_subjects[1] || { name: 'Right', image_prompt: 'Right Subject' };

            const p1 = this.generateImage(subLeft.image_prompt || subLeft.name, theme, false)
                .then(b64 => ({ key: 'left', base64: b64 }));
            const p2 = this.generateImage(subRight.image_prompt || subRight.name, theme, false)
                .then(b64 => ({ key: 'right', base64: b64 }));
            const pBg = this.generateImage("Subtle abstract background, split screen contest", theme, true)
                .then(b64 => ({ key: 'bg', base64: b64 }));
            const results = await Promise.all([p1, p2, pBg]);
            results.forEach(r => versusImages[r.key] = r.base64);
            backgroundImage = versusImages['bg'];
        } else {
            this.logger.log(`Starting parallel image generation for ${blueprint.items.length} items...`);
            const itemImagePromises = blueprint.items.map((item, idx) =>
                this.generateImage(`${item.title}: ${item.description}`, theme, false)
                    .then(base64 => {
                        // DEBUG LOGGING
                        if (!base64 || base64.length < 100) {
                            this.logger.warn(`[ImageGen] Item ${idx} returned empty/short base64!`);
                        } else {
                            this.logger.log(`[ImageGen] Item ${idx} generated (${base64.slice(0, 20)}...)`);
                        }
                        return { index: idx, base64 };
                    })
                    .catch(err => {
                        this.logger.error(`[ImageGen] Item ${idx} failed: ${err.message}`);
                        return { index: idx, base64: '' }; // Fallback
                    })
            );
            const backgroundImagePromise = this.generateImage("Abstract background texture", theme, true)
                .then(base64 => ({ index: -1, base64 }));

            const results = await Promise.all([...itemImagePromises, backgroundImagePromise]);
            itemImages = new Array(blueprint.items.length);
            results.forEach(res => {
                if (res.index === -1) backgroundImage = res.base64;
                else itemImages[res.index] = res.base64;
            });

            // Verify Logic
            itemImages.forEach((img, i) => {
                if (!img) this.logger.warn(`[ImageGen] FINAL CHECK: Index ${i} is missing!`);
            });
        }
        metrics.images = performance.now() - imagesStart;
        this.logger.log(`Image generation completed in ${metrics.images.toFixed(2)}ms.`);

        // 4. DOM Manipulation
        const domStart = performance.now();
        const dom = new JSDOM(templateContent);
        const document = dom.window.document;
        let debugLog = "<!-- LAYOUT DEBUG LOG\n"; // Init Debug Log
        debugLog += `Generated at: ${new Date().toISOString()}\n`;
        debugLog += `Template: ${blueprint.template_id}\n`;

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

            .left-align { text-align: right !important; }
            .right-align { text-align: left !important; }

            /* Sticker Blend Fix */
            img, .step-icon, .slot-img, #slot_img { 
                mix-blend-mode: multiply !important; 
            }
        `;

        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = theme.font_family;
        document.head.appendChild(link);

        // Data Injection
        if (blueprint.template_id === 'versus_split' && blueprint.versus_subjects) {
            const leftImgDiv = document.getElementById('slot_image_left');
            const rightImgDiv = document.getElementById('slot_image_right');
            if (leftImgDiv) leftImgDiv.style.backgroundImage = `url('${versusImages['left']}')`;
            if (rightImgDiv) rightImgDiv.style.backgroundImage = `url('${versusImages['right']}')`;

            const leftTitle = document.getElementById('slot_title_left');
            const rightTitle = document.getElementById('slot_title_right');
            if (leftTitle && rightTitle) {
                const subLeft = blueprint.versus_subjects[0] || { name: 'Left' };
                const subRight = blueprint.versus_subjects[1] || { name: 'Right' };

                const lenL = subLeft.name.length;
                const lenR = subRight.name.length;
                const maxLen = Math.max(lenL, lenR);

                let unifiedSize = 5.0;
                if (maxLen > 12) {
                    unifiedSize = Math.max(3.0, Math.min(5.0, 5.0 * (12 / maxLen)));
                }

                leftTitle.textContent = subLeft.name;
                leftTitle.style.fontSize = `${unifiedSize}rem`;

                rightTitle.textContent = subRight.name;
                rightTitle.style.fontSize = `${unifiedSize}rem`;
            }

            const rowsContainer = document.getElementById('stat_rows_container');

            if (rowsContainer) {
                // PRESERVE the VS Badge (v3 Template)
                const vsBadge = rowsContainer.querySelector('.vs-badge');
                rowsContainer.innerHTML = '';
                if (vsBadge) {
                    rowsContainer.appendChild(vsBadge);
                }

                blueprint.items.forEach((item, idx) => {
                    const parts = item.description.split('|');
                    let valA = parts[0]?.trim() || '-';
                    let valB = parts[1]?.trim() || '-';

                    // Create row div (Glassmorphism structure)
                    const row = document.createElement('div');
                    row.className = 'glass-card stat-row';
                    row.innerHTML = `
                        <div class="stat-left">
                            <div class="stat-value accent-red">${valA}</div>
                        </div>
                        <div class="stat-center">
                            ${item.title}
                        </div>
                        <div class="stat-right">
                            <div class="stat-value accent-blue">${valB}</div>
                        </div>
                    `;
                    rowsContainer.appendChild(row);
                });
            }
        } else {
            if (blueprint.template_id === 'hub_radial' && blueprint.center_topic) {
                const centerTitle = document.getElementById('slot_title_center');
                const centerText = document.getElementById('slot_txt_center');
                if (centerTitle) centerTitle.textContent = blueprint.center_topic.title;
                if (centerText) centerText.textContent = blueprint.center_topic.description;
            }

            if (blueprint.template_id === 'step_list' && blueprint.center_topic) {
                // Header Injection (Optional - user removed from template, but logic can remain if ID exists)
                const header = document.getElementById('infographic-header');
                if (header) {
                    header.style.display = 'block';
                    const titleEl = header.querySelector('.infographic-title');
                    const subtEl = header.querySelector('.infographic-subtitle');
                    if (titleEl) titleEl.textContent = blueprint.center_topic.title;
                    if (subtEl) subtEl.textContent = blueprint.center_topic.description;
                }

                // Dynamic Step Generation (New Article/Grid Logic)
                console.log("--- RELOADING STRATEGY: Step List Article Layout ---");
                const container = document.getElementById('steps-container');
                if (container) {
                    container.innerHTML = ''; // Clear existing
                    document.documentElement.style.setProperty('--n', blueprint.items.length.toString());

                    // Color Palette Generator (Vibrant Theme)
                    const getColors = (idx: number) => {
                        const palettes = [
                            ['#6366f1', '#818cf8', '#4f46e5'], // Indigo
                            ['#f59e0b', '#fbbf24', '#d97706'], // Amber
                            ['#10b981', '#34d399', '#059669'], // Emerald
                            ['#ec4899', '#f472b6', '#db2777'], // Pink
                            ['#3b82f6', '#60a5fa', '#2563eb'], // Blue
                            ['#8b5cf6', '#a78bfa', '#7c3aed'], // Violet
                        ];
                        return palettes[idx % palettes.length];
                    };

                    debugLog += `--- Step List Layout ---\n`;
                    debugLog += `Item Count: ${blueprint.items.length}\n`;

                    blueprint.items.forEach((item, index) => {
                        const [c0, c1, c2] = getColors(index);

                        const article = document.createElement('article');
                        article.className = 'step-article';
                        article.style.setProperty('--c0', c0);
                        article.style.setProperty('--c1', c1);
                        article.style.setProperty('--c2', c2);
                        article.style.setProperty('--idx', index.toString());

                        // Content Injection
                        article.innerHTML = `
                            <div class="step-icon-circle">
                                <img class="step-icon" src="${itemImages[index]}" alt="Step ${index + 1}">
                            </div>
                            <h3 class="step-title">${item.title}</h3>
                            <p class="step-description">${item.description.replace('|', '').trim()}</p>
                        `;

                        container.appendChild(article);
                    });

                    // Update wrapper height based on content
                    const wrapper = document.getElementById('main-wrapper');
                    if (wrapper) {
                        const steps = blueprint.items.length;
                        const minHeight = Math.max(1600, (steps * 280) + 300);
                        wrapper.style.minHeight = `${minHeight}px`;
                    }
                }
            } else if (blueprint.template_id === 'hub_radial') {
                // HUB RADIAL SPECIFIC LOGIC
                console.log("--- RELOADING STRATEGY: Hub Radial Layout ---");

                // Update Center
                const centerTitle = document.getElementById('hub-center')?.querySelector('h2');
                const centerText = document.getElementById('hub-center')?.querySelector('p');
                if (centerTitle && blueprint.center_topic) centerTitle.textContent = blueprint.center_topic.title;
                if (centerText && blueprint.center_topic) centerText.textContent = blueprint.center_topic.description;

                const itemWrapper = document.getElementById('item-wrapper');
                // Use the FIRST spoke as the master template
                const masterSpoke = itemWrapper?.querySelector('.spoke-container');

                if (itemWrapper && masterSpoke) {
                    // Clone the master before clearing
                    const templateSpoke = masterSpoke.cloneNode(true) as HTMLElement;
                    itemWrapper.innerHTML = ''; // Clear initial spokes

                    const count = blueprint.items.length;
                    const radius = 400; // Distance from center
                    const centerX = 600; // Canvas center X
                    const centerY = 600; // Canvas center Y

                    debugLog += `--- Hub Radial Layout ---\nCenter: (${centerX}, ${centerY}), Radius: ${radius}\n`;

                    blueprint.items.forEach((item, index) => {
                        const spoke = templateSpoke.cloneNode(true) as HTMLElement;
                        const angle = (index / count) * 2 * Math.PI - (Math.PI / 2); // Start at top

                        const x = centerX + radius * Math.cos(angle);
                        const y = centerY + radius * Math.sin(angle);

                        spoke.style.left = `${x}px`;
                        spoke.style.top = `${y}px`;

                        debugLog += `Item ${index}: Angle=${angle.toFixed(2)}rad, X=${x.toFixed(1)}, Y=${y.toFixed(1)}\n`;

                        // Inject Data
                        const img = spoke.querySelector('img');
                        if (img) img.src = itemImages[index];

                        const title = spoke.querySelector('h3');
                        if (title) title.textContent = item.title;

                        const desc = spoke.querySelector('p');
                        if (desc) desc.textContent = item.description;

                        itemWrapper.appendChild(spoke);
                    });
                }

            } else {
                // Legacy / Standard Fallback (Step List, Bento, etc if not handled above)
                const itemWrapper = document.getElementById('item-wrapper');
                const masterItem = document.querySelector('.group'); // Expects Tailwind 'group' class for hover effects often used in these templates
                const separator = document.getElementById('slot_separator');

                if (itemWrapper && masterItem) {
                    itemWrapper.innerHTML = '';
                    blueprint.items.forEach((item, index) => {
                        const clone = masterItem.cloneNode(true) as HTMLElement;
                        clone.id = `item_${index}`;

                        let badgeText = '';
                        let cleanDescription = item.description;
                        if (item.description.includes('|')) {
                            const parts = item.description.split('|');
                            badgeText = parts[0].trim();
                            cleanDescription = parts[1].trim();
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
                            txt.textContent = cleanDescription;
                        }

                        const badge = updateId('slot_badge');
                        if (badge && badgeText) {
                            badge.textContent = badgeText;
                        } else if (badge) {
                            badge.textContent = `STEP ${String(index + 1).padStart(2, '0')}`;
                        }

                        const stepNumEl = clone.querySelector('.step-number');
                        if (stepNumEl) stepNumEl.textContent = String(index + 1).padStart(2, '0');

                        clone.classList.remove('hidden', 'opacity-0', 'invisible');
                        itemWrapper.appendChild(clone);

                        if (separator && index < blueprint.items.length - 1) {
                            const sepClone = separator.cloneNode(true) as HTMLElement;
                            sepClone.id = `separator_${index}`;
                            itemWrapper.appendChild(sepClone);
                        }
                    });
                }
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

        metrics.dom = performance.now() - domStart;
        this.logger.log(`DOM manipulation completed in ${metrics.dom.toFixed(2)}ms.`);

        // 5. Browser Screenshot
        const browserStart = performance.now();
        const finalHtml = dom.serialize();
        const screenshotBuffer = await this.browserService.screenshotHtml(finalHtml);
        metrics.browser = performance.now() - browserStart;

        metrics.total = performance.now() - metrics.start;
        this.logger.log(`Overall generation time: ${metrics.total.toFixed(2)}ms`);

        const filename = `html_infographic_${Date.now()}.png`;
        const publicUrl = await this.localStorage.save(filename, screenshotBuffer);
        this.logger.log(`Infographic saved to: ${publicUrl}`);

        // Save Debug HTML
        // Save Debug HTML
        debugLog += "-->";
        // Safe injection into body
        const debugComment = document.createComment(debugLog.replace(/<!--|-->/g, ''));
        document.body.insertBefore(debugComment, document.body.firstChild);

        const htmlFilename = filename.replace('.png', '.html');
        await this.localStorage.save(htmlFilename, Buffer.from(dom.serialize()));
        this.logger.log(`Debug HTML saved to: ${htmlFilename}`);

        return {
            url: publicUrl,
            posterUrl: publicUrl,
            payload: {
                blueprint,
                html: finalHtml,
                metrics: {
                    blueprint_ms: metrics.blueprint.toFixed(2),
                    images_ms: metrics.images.toFixed(2),
                    dom_ms: metrics.dom.toFixed(2),
                    browser_ms: metrics.browser.toFixed(2),
                    total_ms: metrics.total.toFixed(2)
                }
            }
        };
    }

    public async generateBlueprint(prompt: string): Promise<HtmlInfographicBlueprint> {
        if (!this.openai) throw new Error('OpenRouter API Key not configured/found.');

        const systemPrompt = `You are an expert Data Visualization Architect.
Goal: Select template, define style, generate structured content.

Templates: 'hub_radial' (circular hub), 'step_list' (vertical sequence), 'step_stone' (zigzag path), 'bento_grid' (grid), 'versus_split' (comparison).
Themes: 'cyber_neon', 'corp_blue', 'nature_fresh', 'warm_creative'.

Task:
1. Select Template & Theme.
2. Generate Items (3-9 normal).
3. FOR STEP_LIST: Use this for vertical "roadmaps" or lists. In the "description" field, you MUST use a pipe character '|' to separate a short stage name from the detailed description (e.g., "Foundation | Long detailed text...").
4. FOR STEP_STONE: Use this for zigzag path layouts.
5. FOR VERSUS_SPLIT: You MUST generate exactly 4-5 items. Each item "description" MUST contain two values separated by a pipe character '|' (e.g., "100k thrust | 80k thrust"). The first value relates to left_name, the second to right_name.

OUTPUT ONLY VALID JSON, NO MARKDOWN:
{
  "template_id": "...",
  "theme_id": "...",
  "visual_style_directive": "...",
  "center_topic": { "title": "...", "description": "..." },
  "versus_subjects": { "left_name": "", "right_name": "", "left_image_prompt": "", "right_image_prompt": "" },
  "items": [ { "title": "Metric Name", "description": "Val A | Val B" } ]
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

    private async generateImage(prompt: string, theme: Theme, isBackground: boolean): Promise<string> {
        const apiKey = this.configService.get<string>('SILICONFLOW_API_KEY');
        if (!apiKey) return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

        // Atomic "Sticker-Style" Prompt Construction
        // We remove conflicting terms like "8k", "studio", "volumetric" to ensure flat vector style.
        let fullPrompt = '';

        if (isBackground) {
            fullPrompt = `very faint paper texture, off-white, minimalist, high resolution, subtle grain, absolutely no text, no characters, no busy patterns`;
        } else {
            // "Sticker" Rule: Isolated on white, flat vector, matching theme accent
            fullPrompt = `${prompt}, ${theme.image_style_suffix}, flat vector icon style, isolated on white background, matching ${theme.primary_accent} color --no shadows, text, blurry, complex background, 3d, realistic, photo`;
        }

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
