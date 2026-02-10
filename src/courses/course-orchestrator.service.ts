import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import * as pLimit from 'p-limit';
import { HtmlInfographicStrategy } from '../image-gen/strategies/html-infographic.strategy';
import { CourseJob, BatchResult } from './course.dto';
import { ImageTask } from '../image-gen/image-task.schema';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class CourseOrchestratorService {
    private readonly logger = new Logger(CourseOrchestratorService.name);
    private openai: OpenAI;

    constructor(
        private readonly configService: ConfigService,
        private readonly htmlStrategy: HtmlInfographicStrategy,
    ) {
        const apiKey = this.configService.get<string>('OPENROUTER_API_KEY');
        const baseURL = 'https://openrouter.ai/api/v1';

        if (apiKey) {
            this.openai = new OpenAI({
                baseURL,
                apiKey,
                defaultHeaders: {
                    'HTTP-Referer': 'https://visualization-project.com', // Optional: Your site URL
                    'X-Title': 'Visualization Project', // Optional: Your site name
                }
            });
        }
    }

    async runCourseJob(job: CourseJob): Promise<BatchResult> {
        this.logger.log(`Starting Batch Job for Course: ${job.course_id}`);

        try {
            // 1. Pre-Pass (Architect Call)
            const prePass = await this.performArchitectPrePass(job);
            const global_style_anchor = prePass.global_style_anchor;
            const theme_mapping = prePass.theme_mapping;
            const template_suggestions = prePass.template_suggestions || {};

            this.logger.log(`Architect Style Anchor: ${global_style_anchor}`);

            // 2. Concurrency Setup
            const limit = pLimit(2);

            // 3. Generation Loop
            this.logger.log(`Processing ${job.visualizations.length} visualizations...`);
            const tasks = job.visualizations.map((viz) => limit(async () => {
                // Prepend style anchor as a mandatory prefix for deep visual harmony
                const imagePromptPrefix = global_style_anchor ? `${global_style_anchor}, ` : '';

                const task: ImageTask = {
                    type: 'infographic',
                    id: viz.id,
                    refined_prompt: `${imagePromptPrefix}${viz.title}: ${viz.description}`,
                    payload: {
                        style_anchor: global_style_anchor,
                        custom_theme: {
                            primary_accent: theme_mapping.accent,
                            background_main: theme_mapping.background,
                            text_main: theme_mapping.text
                        },
                        theme_id: prePass.theme_id, // Pass Architect-selected theme
                        folder: path.join('courses', job.course_id),
                        template_id: template_suggestions[viz.id]
                    }
                };

                try {
                    const result = await this.htmlStrategy.generate(task);
                    return {
                        visualization_id: viz.id,
                        url: result.url
                    };
                } catch (e) {
                    this.logger.error(`Failed to generate visualization ${viz.id}: ${e.message}`);
                    throw e;
                }
            }));

            const results = await Promise.all(tasks);

            this.logger.log(`Batch Job Completed: ${job.course_id}`);
            return {
                course_id: job.course_id,
                global_style_anchor,
                images: results
            };
        } catch (error) {
            this.logger.error(`Batch Job Failed: ${error.message}`);
            throw error;
        }
    }

    private async performArchitectPrePass(job: CourseJob) {
        const visualizationsSummary = job.visualizations.map(v => `- ${v.id}: ${v.title} (${v.description})`).join('\n');

        const systemMessage = `
            You are a Creative Director & Data Vis Architect. 
            Define a unified Art Directive and Template Strategy for this course.
        `;

        const userMessage = `
            Title: ${job.course_metadata.title}
            Philosophy: ${job.course_metadata.global_style_guide.philosophy}
            Image Style: ${job.course_metadata.global_style_guide.image_style}
            Primary Palette: ${job.course_metadata.global_style_guide.palette.join(', ')}

            Visualizations to generate:
            ${visualizationsSummary}

            TASK:
            1. global_style_anchor: A sharp Art Directive focused ONLY on Medium and Color (e.g., "Flat Vector, Pastel" or "Minimalist Line Art"). 
               STRICT RULE: Avoid mentions of lighting, resolution, or quality.
               STRICT RULE: For Wellness/Mindfulness, use "Minimalist hand-drawn line art, flat colors, soft pastel aesthetic."
               Must act as a prefix for image prompts.
            
            2. theme_mapping: Map palette to 'accent', 'background', 'text'. 
               STRICT RULE: Contrast Safety. 'text' must be highly legible against 'background'.
               Note: If the palette suggests a wellness vibe, favor the 'wellness_mindful' theme configuration.
            
            3. template_suggestions: Map each viz ID to the best template. 
               Templates: 'hub_radial', 'step_list', 'step_stone', 'bento_grid', 'versus_split'.
               Themes: 'cyber_neon', 'corp_blue', 'nature_fresh', 'warm_creative', 'wellness_mindful'.
               Logic: Cycles/Processes -> step_stone. Lists -> step_list. Grids/Collections -> bento_grid. Hubs/Systems -> hub_radial. Comparisons -> versus_split.
            
            OUTPUT JSON ONLY:
            {
                "global_style_anchor": "...",
                "theme_id": "wellness_mindful", 
                "theme_mapping": { "accent": "#HEX", "background": "#HEX", "text": "#HEX" },
                "template_suggestions": { "viz_id": "template_id" }
            }
        `;

        try {
            const completion = await this.generateWithBackoff(() => this.openai.chat.completions.create({
                model: 'google/gemini-2.0-flash-001', // OpenRouter model ID
                messages: [
                    { role: 'system', content: systemMessage },
                    { role: 'user', content: userMessage }
                ],
                response_format: { type: 'json_object' }
            }));

            const text = completion.choices[0].message.content;
            const parsed = JSON.parse(text);

            return parsed;
        } catch (e) {
            this.logger.error('Architect Pre-Pass Failed', e);
            return {
                global_style_anchor: job.course_metadata.global_style_guide.philosophy,
                theme_mapping: {
                    accent: job.course_metadata.global_style_guide.palette[0],
                    background: job.course_metadata.global_style_guide.palette[1],
                    text: job.course_metadata.global_style_guide.palette[2]
                }
            };
        }
    }

    private async generateWithBackoff(apiCall: () => Promise<any>, retries = 5, initialDelay = 3000): Promise<any> {
        let attempt = 0;
        let delay = initialDelay;

        while (attempt <= retries) {
            try {
                return await apiCall();
            } catch (error: any) {
                // OpenAI 429 or OpenRouter specific errors
                if (error.status === 429 || error.message?.includes('429') || error.message?.includes('Resource exhausted') || error.code === 'rate_limit_exceeded') {
                    attempt++;
                    if (attempt > retries) throw error;
                    this.logger.warn(`OpenRouter/OpenAI 429 detected. Retrying in ${delay}ms... (Attempt ${attempt}/${retries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2;
                } else {
                    throw error;
                }
            }
        }
    }
}
