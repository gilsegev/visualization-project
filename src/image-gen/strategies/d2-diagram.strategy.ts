import { Injectable } from '@nestjs/common';
import { BaseImageStrategy, ImageGenerationResult } from '../base-image.strategy';
import { ImageTask } from '../image-task.schema';
import { ConfigService } from '@nestjs/config';
import { LocalStorageService } from '../local-storage.service';
import { BrowserService } from '../browser.service';
import { ObservabilityGateway } from '../../observability/observability.gateway';
import { THEME_LIBRARY, Theme } from '../themes.config';
import { performance } from 'perf_hooks';
import * as path from 'path';
import * as fs from 'fs';
import OpenAI from 'openai';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

@Injectable()
export class D2DiagramStrategy extends BaseImageStrategy {
    private readonly openai: OpenAI;
    private readonly d2Bin: string;
    private readonly renderTimeoutMs: number;

    constructor(
        private readonly configService: ConfigService,
        private readonly localStorage: LocalStorageService,
        private readonly browserService: BrowserService,
        private readonly observability: ObservabilityGateway,
    ) {
        super();
        this.d2Bin = this.configService.get<string>('D2_BIN') || 'd2';
        this.renderTimeoutMs = Math.max(1000, Number(this.configService.get<string>('D2_RENDER_TIMEOUT_MS') || 5000));
        const apiKey = this.configService.get<string>('OPENROUTER_API_KEY');
        this.openai = new OpenAI({
            apiKey: apiKey,
            baseURL: 'https://openrouter.ai/api/v1',
            defaultHeaders: {
                'HTTP-Referer': 'https://visualization-project.local',
                'X-Title': 'Visualization Project D2 Diagram Generator'
            }
        });
    }

    protected async performGeneration(task: ImageTask): Promise<ImageGenerationResult> {
        const start = performance.now();
        const taskAny = task as any;
        const dateStr = new Date().toISOString().split('T')[0];
        const courseId = taskAny.metadata?.course_id || 'uncategorized_course';
        const lessonId = taskAny.metadata?.lesson_id || 'uncategorized_lesson';
        const taskId = task.id || `task-${Date.now()}`;
        const relativeOutputDir = path.join(dateStr, courseId, lessonId, taskId);
        const absoluteOutputDir = path.join(process.cwd(), 'public', 'generated-images', relativeOutputDir);
        await fs.promises.mkdir(absoluteOutputDir, { recursive: true });

        const theme = this.resolveTheme(taskAny);
        this.observability.emitLog('info', `D2 strategy selected for template_type=${taskAny.metadata?.template_type || taskAny.payload?.type || 'unknown'}`, 'D2Strategy', task.id);

        const d2Start = performance.now();
        const d2Script = await this.generateD2Script(task, theme);
        const scriptPath = path.join(absoluteOutputDir, 'diagram.d2');
        const svgPath = path.join(absoluteOutputDir, 'diagram.svg');
        await fs.promises.writeFile(scriptPath, d2Script, 'utf8');
        await this.runD2(scriptPath, svgPath, task.id);
        const d2Ms = performance.now() - d2Start;

        const dims = taskAny.metadata?.dimensions || {};
        const width = Math.max(1400, Number(dims.width) || 1400);
        const height = Math.max(900, Number(dims.height) || 900);
        const reviewHtml = this.buildReviewHtml(theme, width, height);
        const screenshotBuffer = await this.browserService.screenshotHtml(reviewHtml, absoluteOutputDir, { width, height });
        const posterUrl = await this.localStorage.save(path.join(relativeOutputDir, 'poster.png'), screenshotBuffer);

        const blueprint = {
            template_id: 'd2_diagram',
            source_type: taskAny.metadata?.template_type || taskAny.payload?.type || 'flowchart',
            theme_id: taskAny.metadata?.theme_id || 'corp_blue',
            d2: {
                script_path: './diagram.d2',
                svg_path: './diagram.svg',
                layout: 'dagre',
                theme: 200
            }
        };

        await this.localStorage.save(path.join(relativeOutputDir, 'index.html'), Buffer.from(reviewHtml));
        await this.localStorage.save(path.join(relativeOutputDir, 'blueprint.json'), Buffer.from(JSON.stringify(blueprint, null, 2)));

        const totalMs = performance.now() - start;
        return {
            url: posterUrl,
            posterUrl,
            payload: {
                blueprint,
                html: reviewHtml,
                output_dir: relativeOutputDir,
                metrics: {
                    d2_render_ms: d2Ms.toFixed(2),
                    total_ms: totalMs.toFixed(2)
                },
                blueprint_prompt: task.refined_prompt
            }
        };
    }

    private resolveTheme(taskAny: any): Theme {
        if (taskAny.metadata?.custom_theme) return taskAny.metadata.custom_theme as Theme;
        const themeId = taskAny.metadata?.theme_id || 'corp_blue';
        return THEME_LIBRARY[themeId] || THEME_LIBRARY['corp_blue'];
    }

    private async generateD2Script(task: ImageTask, theme: Theme): Promise<string> {
        const fullPrompt = `${task.refined_prompt}\n\nDATA SPECIFICATION (USE THIS FOR NODES/EDGES):\n${JSON.stringify(task.payload || {}, null, 2)}`;
        const systemPrompt = `Return valid D2 script only. No markdown.
Target types: flowchart, timeline, process_map.
Constraints:
- Use --layout=dagre friendly graph.
- Use rectangle nodes; use person shape only for people/actors.
- Use -> edges for process flow.
- If groups are present, use containers with { }.
- Keep labels concise and readable.
- No decorative unicode or emojis.`;

        try {
            const model = this.configService.get<string>('OPENROUTER_MODEL') || 'google/gemini-2.0-flash-001';
            const completion = await this.openai.chat.completions.create({
                model,
                response_format: { type: 'text' },
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: fullPrompt }
                ],
                max_tokens: 2000,
                temperature: 0.2
            });
            const raw = completion.choices?.[0]?.message?.content || '';
            const cleaned = raw.replace(/```d2/gi, '').replace(/```/g, '').trim();
            if (cleaned) {
                return this.injectBranding(cleaned, theme);
            }
        } catch (error) {
            const message = (error as any)?.message || 'Unknown LLM error';
            this.logger.warn(`D2 LLM translation failed, using deterministic fallback: ${message}`);
            this.observability.emitLog('warn', `D2 LLM translation failed; fallback generator used. reason=${message}`, 'D2Strategy', task.id);
        }

        return this.buildDeterministicD2(task.payload || {}, theme);
    }

    private injectBranding(script: string, theme: Theme): string {
        const fontFamily = String(theme.font_name || 'Inter').replace(/"/g, '');
        const fill = this.normalizeColor(theme.background_main, '#FAF9F6');
        const stroke = this.normalizeColor(theme.primary_accent, '#5B9A8B');
        const text = this.normalizeColor(theme.text_main, '#1A365D');
        const header = [
            'direction: down',
            `vars: { d2-config: { theme-overrides: { N1: "${fill}", N7: "${stroke}", N2: "${text}" } } }`,
            '',
            'classes: {',
            '  primary: {',
            '    shape: rectangle',
            '    style: {',
            `      fill: "${fill}"`,
            `      stroke: "${stroke}"`,
            `      font-family: "${fontFamily}"`,
            '      font-size: 16',
            `      font-color: "${text}"`,
            '    }',
            '  }',
            '}',
            ''
        ].join('\n');
        return `${header}\n${script}`;
    }

    private buildDeterministicD2(payload: any, theme: Theme): string {
        const items = Array.isArray(payload?.items) ? payload.items : [];
        const flowNodes = items.length
            ? items.map((it: any, idx: number) => ({ id: `n${idx + 1}`, title: String(it?.title || `Step ${idx + 1}`), description: String(it?.description || '') }))
            : [{ id: 'n1', title: String(payload?.title || 'Start'), description: String(payload?.description || '') }];

        const nodes = flowNodes.map((n) => {
            const label = `${n.title}${n.description ? `\\n${n.description.slice(0, 90)}` : ''}`.replace(/"/g, '\'');
            const shape = /\b(user|actor|person|teacher|student|patient|client)\b/i.test(n.title) ? 'person' : 'rectangle';
            return `${n.id}: "${label}" { shape: ${shape} class: primary }`;
        });
        const edges = flowNodes.slice(0, -1).map((n, idx) => `${n.id} -> n${idx + 2}`);
        const body = [nodes.join('\n'), '', edges.join('\n')].join('\n');
        return this.injectBranding(body, theme);
    }

    private async runD2(inputPath: string, outputSvgPath: string, taskId: string): Promise<void> {
        const args = [inputPath, outputSvgPath, '--layout=dagre', '--theme=200'];
        const started = performance.now();
        try {
            await execFileAsync(this.d2Bin, args, { timeout: this.renderTimeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
            const duration = performance.now() - started;
            this.observability.emitLog('info', `D2 render complete in ${duration.toFixed(0)}ms`, 'D2Strategy', taskId);
        } catch (error: any) {
            const stderr = String(error?.stderr || error?.message || '').trim();
            throw new Error(`D2 render failed: ${stderr || 'unknown error'}`);
        }
    }

    private buildReviewHtml(theme: Theme, width: number, height: number): string {
        const bg = this.normalizeColor(theme.background_main, '#FAF9F6');
        return `<!doctype html><html><head><meta charset="utf-8"/><style>
html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:${bg}}
#stage{width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
#stage img{max-width:100%;max-height:100%;object-fit:contain}
</style></head><body><div id="stage"><img src="./diagram.svg" alt="diagram"/></div></body></html>`;
    }

    private normalizeColor(value: string | undefined, fallback: string): string {
        const raw = String(value || '').trim();
        if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw;
        return fallback;
    }
}

