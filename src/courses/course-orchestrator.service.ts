import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import * as pLimit from 'p-limit';
import { HtmlInfographicStrategy } from '../image-gen/strategies/html-infographic.strategy';
import { CourseJob, BatchResult } from './course.dto';
import { ImageTask } from '../image-gen/image-task.schema';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class CourseOrchestratorService {
    private readonly logger = new Logger(CourseOrchestratorService.name);
    private model: GenerativeModel;

    constructor(
        private readonly configService: ConfigService,
        private readonly htmlStrategy: HtmlInfographicStrategy,
    ) {
        const apiKey = this.configService.get<string>('GEMINI_API_KEY');
        if (apiKey) {
            const genAI = new GoogleGenerativeAI(apiKey);
            this.model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        }
    }

    async runCourseJob(job: CourseJob): Promise<BatchResult> {
        this.logger.log(`Starting Batch Job for Course: ${job.course_id}`);

        try {
            // 1. Pre-Pass (Architect Call)
            const { global_style_anchor, theme_mapping } = await this.performArchitectPrePass(job);
            this.logger.log(`Architect Style Anchor: ${global_style_anchor}`);

            // 2. Concurrency Setup
            const limit = pLimit(2);

            // 3. Generation Loop
            this.logger.log(`Processing ${job.visualizations.length} visualizations...`);
            const tasks = job.visualizations.map((viz) => limit(async () => {
                const task: ImageTask = {
                    type: 'infographic',
                    id: viz.id,
                    refined_prompt: `${viz.title}: ${viz.description}`,
                    payload: {
                        style_anchor: global_style_anchor,
                        custom_palette: theme_mapping,
                        folder: path.join('courses', job.course_id)
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
        const prompt = `
            You are a Creative Director. 
            Analyze this course metadata and define a consistent visual vibe.
            
            Course Title: ${job.course_metadata.title}
            Philosophy: ${job.course_metadata.global_style_guide.philosophy}
            Image Style: ${job.course_metadata.global_style_guide.image_style}
            Primary Palette: ${job.course_metadata.global_style_guide.palette.join(', ')}

            TASK:
            1. Return a 20-word 'global_style_anchor' that describes the visual vibe (e.g. "Minimalist watercolor, soft textures, muted teal accents...").
            2. Map the provided palette to specific UI roles: 'accent', 'background', 'text'.
            
            OUTPUT JSON ONLY:
            {
                "global_style_anchor": "...",
                "theme_mapping": {
                    "accent": "#HEX",
                    "background": "#HEX",
                    "text": "#HEX"
                }
            }
        `;

        try {
            const result = await this.generateWithBackoff(() => this.model.generateContent(prompt));
            const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(text);
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
                if (error.message?.includes('429') || error.message?.includes('Resource exhausted')) {
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
}
