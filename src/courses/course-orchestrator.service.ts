import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CourseJob } from './course.dto';
import { HtmlInfographicStrategy } from '../image-gen/strategies/html-infographic.strategy';
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
        private readonly htmlStrategy: HtmlInfographicStrategy
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

        // Architect Pre-Pass: Determine global style anchor
        const styleAnchor = await this.architectPrePass(courseJob);
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

    private async architectPrePass(courseJob: CourseJob): Promise<string> {
        const prompt = `Based on this course description, define a concise global visual style anchor (one sentence max):
Title: ${courseJob.metadata.title}
Audience: ${courseJob.metadata.audience}
${courseJob.metadata.global_style_guide ? `Style Guide: ${courseJob.metadata.global_style_guide}` : ''}`;

        const model = this.configService.get<string>('OPENROUTER_MODEL') || 'google/gemini-2.0-flash-001';
        const response = await this.openai.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.5,
            max_tokens: 100
        });

        return response.choices[0]?.message?.content?.trim() || 'Clean, professional style';
    }
}
