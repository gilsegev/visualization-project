import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CourseJob } from './course.dto';
import { DEPRECATED_HtmlInfographicStrategy } from '../image-gen/strategies/DEPRECATED_jsdom-infographic.strategy';
import { ImageTask } from '../image-gen/image-task.schema';
import OpenAI from 'openai';
import * as pLimit from 'p-limit';
import * as path from 'path';

@Injectable()
export class CourseOrchestratorService {
    private readonly logger = new Logger(CourseOrchestratorService.name);
    private openai: OpenAI;

    constructor(
        private readonly configService: ConfigService,
        private readonly htmlStrategy: DEPRECATED_HtmlInfographicStrategy
    ) {
        const apiKey = this.configService.get<string>('OPENROUTER_API_KEY');
        this.openai = new OpenAI({
            baseURL: 'https://openrouter.ai/api/v1',
            apiKey,
            defaultHeaders: {
                'HTTP-Referer': 'https://visualization-project.local',
                'X-Title': 'Visualization Project'
            }
        });
    }

    async processCourse(courseJob: CourseJob): Promise<{ courseId: string; images: string[] }> {
        const courseId = `course_${Date.now()}`;
        this.logger.log(`[ORCHESTRATOR] Starting course batch: ${courseJob.metadata.title}`);

        // Architect Pre-Pass: Determine global style anchor & theme
        const { styleAnchor, customTheme } = await this.architectPrePass(courseJob);
        console.log(`[ARCHITECT] Global Style Anchor: ${styleAnchor}`);

        // Parallel Execution with p-limit (concurrency: 3)
        const limit = pLimit(3);
        const courseFolder = path.join('public', 'generated-images', 'courses', courseId);

        const tasks = courseJob.visualizations.map((viz, index) =>
            limit(async () => {
                const task: ImageTask = {
                    refined_prompt: viz.prompt,
                    task_type: 'html_infographic',
                    metadata: {
                        style_anchor: styleAnchor,
                        custom_theme: customTheme, // Inject theme override
                        center_topic: viz.center_topic,
                        folder: courseFolder
                    }
                } as any;

                this.logger.log(`Processing visualization ${index + 1}/${courseJob.visualizations.length}`);
                const result = await this.htmlStrategy.performGeneration(task, index);
                return result.url;
            })
        );

        const images = await Promise.all(tasks);
        this.logger.log(`[ORCHESTRATOR] Course batch completed! ${images.length} images generated.`);

        return { courseId, images };
    }

    private async architectPrePass(courseJob: CourseJob): Promise<{ styleAnchor: string; customTheme?: any }> {
        const prompt = `You are a Visual Director. Analyze this course and define a comprehensive "Art Directive" and a consistent Color Palette.

Course Title: ${courseJob.metadata.title}
Audience: ${courseJob.metadata.audience}
${courseJob.metadata.global_style_guide ? `Style Guide: ${courseJob.metadata.global_style_guide}` : ''}

Requirements:
1. Art Directive (80-100 words): Detailed visual specification. Define the lighting (e.g., "warm golden hour side-lighting"), material properties (e.g., "matte textured paper with slight grain"), camera angle/depth (e.g., "isometric view, shallow depth of field"), and overall mood. This will set the Global Style Anchor for all image generation.
2. Palette: Provide hex codes for primary_accent, background_main, and text_main.

OUTPUT JSON ONLY (no markdown):
{
  "art_directive": "...",
  "palette": {
    "primary_accent": "#HEX",
    "background_main": "#HEX",
    "text_main": "#HEX"
  }
}`;

        const model = this.configService.get<string>('OPENROUTER_MODEL') || 'google/gemini-2.0-flash-001';
        const response = await this.openai.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 1000
        });

        const content = response.choices[0]?.message?.content || '{}';
        const cleanJson = content.replace(/```json/g, '').replace(/```/g, '').trim();

        try {
            const parsed = JSON.parse(cleanJson);

            // Construct Theme Override
            const customTheme = {
                primary_accent: parsed.palette?.primary_accent || '#5B9A8B',
                background_main: parsed.palette?.background_main || '#FAF9F6',
                text_main: parsed.palette?.text_main || '#2D3748',
                font_family: 'https://fonts.googleapis.com/css2?family=Quicksand:wght@400;700&display=swap', // Default
                font_name: 'Quicksand',
                image_style_suffix: `${parsed.art_directive}, flat vector icon style, isolated on white background`,
                glass_color: 'rgba(255, 255, 255, 0.7)'
            };

            return {
                styleAnchor: parsed.art_directive || 'Clean, professional style',
                customTheme
            };
        } catch (e) {
            this.logger.error('Failed to parse Architect JSON', e);
            return { styleAnchor: 'Clean, professional style, minimalist' };
        }
    }
}
