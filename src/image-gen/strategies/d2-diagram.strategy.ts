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
import { resolveWithinGeneratedImages, sanitizeRelativePath } from '../../common/path-safety.util';

const execFileAsync = promisify(execFile);

@Injectable()
export class D2DiagramStrategy extends BaseImageStrategy {
    private readonly openai: OpenAI;
    private readonly d2Bin: string;
    private readonly renderTimeoutMs: number;
    private readonly d2ConfiguredBin: string;

    constructor(
        private readonly configService: ConfigService,
        private readonly localStorage: LocalStorageService,
        private readonly browserService: BrowserService,
        private readonly observability: ObservabilityGateway,
    ) {
        super();
        this.d2ConfiguredBin = this.configService.get<string>('D2_BIN') || 'd2';
        this.d2Bin = this.resolveD2Bin(this.d2ConfiguredBin);
        this.renderTimeoutMs = Math.max(1000, Number(this.configService.get<string>('D2_RENDER_TIMEOUT_MS') || 5000));
        const apiKey = this.configService.get<string>('OPENROUTER_API_KEY');
        this.openai = new OpenAI({
            apiKey,
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
        const relativeOutputDir = sanitizeRelativePath(path.join(dateStr, String(courseId), String(lessonId), String(taskId)), 'output dir');
        const absoluteOutputDir = resolveWithinGeneratedImages(relativeOutputDir);
        await fs.promises.mkdir(absoluteOutputDir, { recursive: true });

        const theme = this.resolveTheme(taskAny);
        this.observability.emitLog('info', `D2 strategy selected for template_type=${taskAny.metadata?.template_type || taskAny.payload?.type || 'unknown'}`, 'D2Strategy', task.id);

        const d2Start = performance.now();
        const d2ScriptRaw = await this.generateD2Script(task, theme);
        const d2Script = this.sanitizeGeneratedD2Script(d2ScriptRaw, task.id);
        const scriptPath = path.join(absoluteOutputDir, 'diagram.d2');
        const svgPath = path.join(absoluteOutputDir, 'diagram.svg');
        await fs.promises.writeFile(scriptPath, d2Script, 'utf8');
        const d2Used = await this.runD2(scriptPath, svgPath, task.id);

        if (!d2Used) {
            const fallbackSvg = this.buildFallbackSvg(task.payload || {}, theme);
            await fs.promises.writeFile(svgPath, fallbackSvg, 'utf8');
            this.observability.emitLog('warn', 'D2 CLI unavailable; rendered styled fallback flowchart SVG', 'D2Strategy', task.id);
        }
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
                    d2_cli_used: d2Used,
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
        const fontFamily = String(theme.font_name || 'Source Sans Pro').replace(/"/g, '');
        const fill = this.normalizeColor(theme.background_main, '#FAF9F6');
        const stroke = this.normalizeColor(theme.primary_accent, '#5B9A8B');
        const text = this.normalizeColor(theme.text_main, '#1A365D');
        const muted = this.normalizeColor(theme.text_secondary || theme.text_main, '#4A5568');
        const c2 = this.mixHex(stroke, '#FFFFFF', 0.75);
        const c3 = this.mixHex(stroke, '#A78BFA', 0.25);
        const c4 = this.mixHex(fill, '#DEE1EB', 0.55);
        const c5 = this.mixHex(stroke, '#88DCF7', 0.35);
        const c6 = this.mixHex(stroke, '#E4DBFE', 0.45);

        const header = [
            'vars: {',
            '  d2-config: {',
            '    theme-id: 3',
            '    sketch: true',
            '    layout-engine: dagre',
            '  }',
            '  colors: {',
            `    c2: "${c2}"`,
            `    c3: "${c3}"`,
            `    c4: "${c4}"`,
            `    c5: "${c5}"`,
            `    c6: "${c6}"`,
            '  }',
            '}',
            '',
            'direction: down',
            '',
            'classes: {',
            '  primary: {',
            '    shape: rectangle',
            '    style: {',
            '      fill: ${colors.c6}',
            `      stroke: "${stroke}"`,
            '      stroke-width: 2',
            '      stroke-dash: 4',
            '      border-radius: 14',
            `      font-family: "${fontFamily}"`,
            '      font-size: 17',
            `      font-color: "${text}"`,
            '    }',
            '  }',
            '}',
            ''
        ].join('\n');
        return `${header}\n${script}`;
    }

    private sanitizeGeneratedD2Script(script: string, taskId: string): string {
        const lines = String(script || '').split(/\r?\n/);
        const kept: string[] = [];
        let strippedCliDirectiveCount = 0;
        let strippedMalformedEdgeCount = 0;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
                kept.push(line);
                continue;
            }

            // Guard against LLMs emitting CLI flags inside the script body, e.g. "--layout: dagre".
            if (/^--[a-z0-9_-]+\s*:/.test(trimmed) || /^--[a-z0-9_-]+(\s|=|$)/.test(trimmed)) {
                strippedCliDirectiveCount += 1;
                continue;
            }

            // Drop obviously malformed edge declarations (missing source or target).
            if (trimmed.includes('->')) {
                const edgeMatch = trimmed.match(/^(.+?)\s*->\s*(.+)$/);
                if (!edgeMatch || !edgeMatch[1]?.trim() || !edgeMatch[2]?.trim()) {
                    strippedMalformedEdgeCount += 1;
                    continue;
                }
            }

            kept.push(line);
        }

        if (strippedCliDirectiveCount > 0 || strippedMalformedEdgeCount > 0) {
            this.observability.emitLog(
                'warn',
                `Sanitized generated D2 script: removed cli_directives=${strippedCliDirectiveCount}, malformed_edges=${strippedMalformedEdgeCount}`,
                'D2Strategy',
                taskId,
            );
        }

        return kept.join('\n').trim() + '\n';
    }

    private buildDeterministicD2(payload: any, theme: Theme): string {
        const branchModel = this.extractBranchModel(payload);
        if (branchModel) {
            const lines: string[] = [];
            lines.push(`top: "${this.escapeD2(branchModel.topTitle)}\\n${this.escapeD2(branchModel.topDesc)}" { shape: rectangle class: primary }`);
            lines.push(`split: "${this.escapeD2(branchModel.splitTitle)}" { shape: rectangle class: primary }`);
            lines.push('top -> split');

            branchModel.branches.forEach((b, bi) => {
                const headId = `b${bi + 1}_h`;
                lines.push(`${headId}: "${this.escapeD2(b.name)}\\n${this.escapeD2(b.timeframe)}" { shape: rectangle class: primary }`);
                lines.push(`split -> ${headId}`);
                let prev = headId;
                b.steps.forEach((s, si) => {
                    const id = `b${bi + 1}_s${si + 1}`;
                    lines.push(`${id}: "${this.escapeD2(s)}" { shape: rectangle class: primary }`);
                    lines.push(`${prev} -> ${id}`);
                    prev = id;
                });
                lines.push(`${prev} -> merge`);
            });

            lines.push(`merge: "${this.escapeD2(branchModel.mergeTitle)}\\n${this.escapeD2(branchModel.mergeDesc)}" { shape: rectangle class: primary }`);
            if (branchModel.footer) {
                lines.push(`footer: "${this.escapeD2(branchModel.footer)}" { shape: rectangle class: primary }`);
                lines.push('merge -> footer');
            }
            return this.injectBranding(lines.join('\n'), theme);
        }

        const items = Array.isArray(payload?.items)
            ? payload.items
            : (Array.isArray(payload?.structure?.milestones)
                ? payload.structure.milestones.map((m: any) => ({
                    title: `${m?.year ? `${m.year}: ` : ''}${m?.title || 'Milestone'}`,
                    description: m?.detail || ''
                }))
                : []);
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

    private async runD2(inputPath: string, outputSvgPath: string, taskId: string): Promise<boolean> {
        const args = [inputPath, outputSvgPath, '--layout=dagre', '--theme=200'];
        const started = performance.now();
        try {
            await execFileAsync(this.d2Bin, args, { timeout: this.renderTimeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
            const duration = performance.now() - started;
            this.observability.emitLog('info', `D2 render complete in ${duration.toFixed(0)}ms`, 'D2Strategy', taskId);
            return true;
        } catch (error: any) {
            const code = String(error?.code || '').toUpperCase();
            if (code === 'ENOENT') {
                this.observability.emitLog(
                    'warn',
                    `D2 executable not found (configured=${this.d2ConfiguredBin}, resolved=${this.d2Bin}). Install D2 or set D2_BIN to d2.exe path. Using fallback renderer.`,
                    'D2Strategy',
                    taskId
                );
                return false;
            }
            const stderr = String(error?.stderr || error?.message || '').trim();
            throw new Error(`D2 render failed: ${stderr || 'unknown error'}`);
        }
    }

    private resolveD2Bin(configured: string): string {
        const raw = String(configured || 'd2').trim() || 'd2';
        const candidates = [
            raw,
            path.join(process.cwd(), 'tools', 'd2', 'd2.exe'),
            path.join(process.cwd(), 'bin', 'd2.exe'),
            path.join(process.cwd(), 'd2.exe'),
        ];
        if (process.platform === 'win32') {
            const pathDirs = String(process.env.PATH || '').split(';').filter(Boolean);
            for (const d of pathDirs) candidates.push(path.join(d, 'd2.exe'));
        }
        for (const c of candidates) {
            try {
                if (!c) continue;
                if (!c.includes(path.sep)) return c; // command form ("d2")
                if (fs.existsSync(c)) return c;
            } catch { /* ignore */ }
        }
        return raw;
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
        const embedded = raw.match(/#[0-9a-f]{3,8}/i)?.[0];
        if (embedded) return embedded;
        return fallback;
    }

    private extractFlowNodes(payload: any): Array<{ title: string; description: string }> {
        if (Array.isArray(payload?.items) && payload.items.length) {
            return payload.items.map((it: any, i: number) => ({
                title: String(it?.title || `Step ${i + 1}`),
                description: String(it?.description || '')
            }));
        }
        const structure = payload?.structure || {};
        const nodes: Array<{ title: string; description: string }> = [];
        if (Array.isArray(structure?.milestones) && structure.milestones.length) {
            for (const m of structure.milestones) {
                const year = String(m?.year || '').trim();
                const title = String(m?.title || 'Milestone').trim();
                const detail = String(m?.detail || '').trim();
                nodes.push({
                    title: year ? `${year}: ${title}` : title,
                    description: detail
                });
            }
        }
        if (structure?.start) {
            nodes.push({ title: 'Start', description: String(structure.start) });
        }
        if (structure?.topSection && typeof structure.topSection === 'object') {
            const label = String(structure.topSection?.label || 'Start').trim();
            const nextNode = String(structure.topSection?.nextNode || '').trim();
            nodes.push({
                title: label,
                description: nextNode ? `Next: ${nextNode}` : ''
            });
            if (nextNode) {
                nodes.push({
                    title: nextNode,
                    description: 'Pathway split point'
                });
            }
        }
        if (Array.isArray(structure?.branches) && structure.branches.length) {
            for (const branch of structure.branches) {
                const name = String(branch?.name || 'Branch').trim();
                const timeframe = String(branch?.timeframe || '').trim();
                nodes.push({
                    title: name,
                    description: timeframe || 'Pathway branch'
                });
                if (Array.isArray(branch?.sequence)) {
                    for (const step of branch.sequence) {
                        nodes.push({
                            title: `${name}: Sequence`,
                            description: String(step || '')
                        });
                    }
                }
                if (Array.isArray(branch?.effects)) {
                    for (const effect of branch.effects) {
                        nodes.push({
                            title: `${name}: Effect`,
                            description: String(effect || '')
                        });
                    }
                }
            }
        }
        if (structure?.convergenceNote) {
            nodes.push({ title: 'Convergence', description: String(structure.convergenceNote) });
        }
        if (Array.isArray(structure?.decisionNodes)) {
            for (const d of structure.decisionNodes) {
                nodes.push({ title: String(d?.question || d?.id || 'Decision'), description: `Yes -> ${d?.yes || ''} | No -> ${d?.no || ''}` });
            }
        }
        if (structure?.outputs && typeof structure.outputs === 'object') {
            for (const [k, v] of Object.entries(structure.outputs)) {
                nodes.push({ title: `Output: ${k}`, description: String(v || '') });
            }
        }
        if (structure?.footerNote) {
            nodes.push({ title: 'Footer Note', description: String(structure.footerNote) });
        }
        if (nodes.length) return nodes;
        return [{ title: String(payload?.title || 'Process Flow'), description: String(payload?.description || '') }];
    }

    private buildFallbackSvg(payload: any, theme: Theme): string {
        const branchModel = this.extractBranchModel(payload);
        if (branchModel) {
            return this.buildBranchFallbackSvg(branchModel, payload, theme);
        }
        const nodes = this.extractFlowNodes(payload);
        const width = 1400;
        const minCardW = 520;
        const maxCardW = 1080;
        const cardH = 90;
        const gap = 22;
        const margin = 56;
        const headerHeight = 86;
        const height = Math.max(900, margin * 2 + headerHeight + nodes.length * cardH + Math.max(0, nodes.length - 1) * gap);
        const bg = this.normalizeColor(theme.background_main, '#FAF9F6');
        const stroke = this.normalizeColor(theme.primary_accent, '#5B9A8B');
        const text = this.normalizeColor(theme.text_main, '#1A365D');
        const muted = this.normalizeColor(theme.text_secondary || theme.text_main, '#4A5568');
        const c4 = this.mixHex(bg, '#DEE1EB', 0.55);
        const c6 = this.mixHex(stroke, '#E4DBFE', 0.45);
        const sketchStack = `Patrick Hand, Virgil, Comic Sans MS, Segoe Print, Bradley Hand, Chalkboard SE, cursive`;
        const bodyStack = `${this.escapeXml(String(theme.font_name || 'Source Sans Pro'))}, Source Sans Pro, Segoe UI, sans-serif`;
        const fontFamily = `${sketchStack}, ${bodyStack}`;
        const centerX = width / 2;
        const flowTitleRaw = String(payload?.center_topic?.title || payload?.center?.title || payload?.title || 'Flowchart');
        const flowSubtitleRaw = String(payload?.center_topic?.description || payload?.center?.description || payload?.description || '');
        const titleLines = this.wrapTextLines(flowTitleRaw, 42, 3);
        const subtitleLines = this.wrapTextLines(flowSubtitleRaw, 70, 2);
        const titleBlock = titleLines.map((line, idx) => `<text x="${centerX}" y="${margin - 8 + idx * 42}" text-anchor="middle" font-family="${fontFamily}" font-size="38" font-weight="800" fill="${text}" letter-spacing="1.0">${this.escapeXml(line)}</text>`).join('\n');
        const subtitleStartY = margin - 8 + titleLines.length * 42;
        const subtitleBlock = subtitleLines.map((line, idx) => `<text x="${centerX}" y="${subtitleStartY + 14 + idx * 24}" text-anchor="middle" font-family="${bodyStack}" font-size="18" font-weight="600" fill="${muted}" opacity="0.92">${this.escapeXml(line)}</text>`).join('\n');
        const dynamicHeaderHeight = Math.max(headerHeight, (titleLines.length * 42) + (subtitleLines.length ? (14 + subtitleLines.length * 24) : 0) + 22);

        const cards = nodes.map((n, i) => {
            const title = this.escapeXml(this.truncate(n.title, 92));
            const desc = this.escapeXml(this.truncate(n.description, 128));
            const approxWidth = Math.max(title.length * 10.5, desc.length * 8.2) + 90;
            const cardW = Math.max(minCardW, Math.min(maxCardW, Math.floor(approxWidth)));
            const x = Math.floor((width - cardW) / 2);
            const y = margin + dynamicHeaderHeight + i * (cardH + gap);
            const ty = y + 34;
            const dy = y + 62;
            const midX = x + cardW / 2;
            const fillColor = i % 2 === 0 ? c6 : c4;
            const cardTitle = this.pickReadableTextColor(fillColor, text);
            const cardBody = this.mixHex(cardTitle, fillColor, 0.30);
            const arrow = i < nodes.length - 1
                ? `<line x1="${centerX}" y1="${y + cardH}" x2="${centerX}" y2="${y + cardH + gap - 8}" stroke="${stroke}" stroke-width="2.5"/><polygon points="${centerX - 6},${y + cardH + gap - 14} ${centerX + 6},${y + cardH + gap - 14} ${centerX},${y + cardH + gap - 4}" fill="${stroke}"/>`
                : '';
            return `
<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="14" fill="${fillColor}" stroke="${stroke}" stroke-width="2.2" stroke-dasharray="4 2"/>
<text x="${midX}" y="${ty}" text-anchor="middle" font-family="${fontFamily}" font-size="19" font-weight="700" fill="${cardTitle}">${title}</text>
<text x="${midX}" y="${dy}" text-anchor="middle" font-family="${fontFamily}" font-size="15" font-weight="500" fill="${cardBody}" opacity="0.98">${desc}</text>
${arrow}`;
        }).join('\n');

        const dynamicHeight = Math.max(900, margin * 2 + dynamicHeaderHeight + nodes.length * cardH + Math.max(0, nodes.length - 1) * gap);
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${dynamicHeight}" viewBox="0 0 ${width} ${dynamicHeight}">
<defs>
  <style type="text/css"><![CDATA[
    @import url('https://fonts.googleapis.com/css2?family=Source+Sans+Pro:wght@400;600;700;800&display=swap');
    @import url('https://fonts.googleapis.com/css2?family=Patrick+Hand&display=swap');
  ]]></style>
</defs>
<rect x="0" y="0" width="${width}" height="${dynamicHeight}" fill="${bg}"/>
${titleBlock}
${subtitleBlock}
${cards}
</svg>`;
    }

    private buildBranchFallbackSvg(branchModel: {
        topTitle: string;
        topDesc: string;
        splitTitle: string;
        branches: Array<{ name: string; timeframe: string; steps: string[] }>;
        mergeTitle: string;
        mergeDesc: string;
        footer?: string;
    }, payload: any, theme: Theme): string {
        const width = 1400;
        const bg = this.normalizeColor(theme.background_main, '#FAF9F6');
        const stroke = this.normalizeColor(theme.primary_accent, '#5B9A8B');
        const text = this.normalizeColor(theme.text_main, '#1A365D');
        const muted = this.normalizeColor(theme.text_secondary || theme.text_main, '#4A5568');
        const c4 = this.mixHex(bg, '#DEE1EB', 0.55);
        const c6 = this.mixHex(stroke, '#E4DBFE', 0.45);
        const sketchStack = `Patrick Hand, Virgil, Comic Sans MS, Segoe Print, Bradley Hand, Chalkboard SE, cursive`;
        const bodyStack = `${this.escapeXml(String(theme.font_name || 'Source Sans Pro'))}, Source Sans Pro, Segoe UI, sans-serif`;
        const fontFamily = `${sketchStack}, ${bodyStack}`;
        const centerX = width / 2;
        const margin = 56;
        const cardH = 86;
        const gapY = 18;
        const colGap = 70;
        const colCount = Math.max(2, branchModel.branches.length);
        const colW = Math.floor((width - margin * 2 - colGap * (colCount - 1)) / colCount);
        const cardW = Math.max(300, Math.min(380, colW));

        const flowTitleRaw = String(payload?.center_topic?.title || payload?.center?.title || payload?.title || 'Flowchart');
        const flowSubtitleRaw = String(payload?.center_topic?.description || payload?.center?.description || payload?.description || '');
        const titleLines = this.wrapTextLines(flowTitleRaw, 42, 3);
        const subtitleLines = this.wrapTextLines(flowSubtitleRaw, 70, 2);
        const titleBlock = titleLines.map((line, idx) => `<text x="${centerX}" y="${margin - 8 + idx * 42}" text-anchor="middle" font-family="${fontFamily}" font-size="38" font-weight="800" fill="${text}" letter-spacing="1.0">${this.escapeXml(line)}</text>`).join('\n');
        const subtitleStartY = margin - 8 + titleLines.length * 42;
        const subtitleBlock = subtitleLines.map((line, idx) => `<text x="${centerX}" y="${subtitleStartY + 14 + idx * 24}" text-anchor="middle" font-family="${bodyStack}" font-size="18" font-weight="600" fill="${muted}" opacity="0.92">${this.escapeXml(line)}</text>`).join('\n');
        const dynamicHeaderHeight = Math.max(86, (titleLines.length * 42) + (subtitleLines.length ? (14 + subtitleLines.length * 24) : 0) + 22);

        const topY = margin + dynamicHeaderHeight + 8;
        const splitY = topY + cardH + 40;
        const branchStartY = splitY + cardH + 46;
        const branchRowCount = Math.max(...branchModel.branches.map(b => 1 + Math.max(1, b.steps.length)));
        const mergeY = branchStartY + branchRowCount * (cardH + gapY) + 24;
        const footerY = mergeY + cardH + 32;
        const dynamicHeight = Math.max(950, footerY + (branchModel.footer ? cardH + 56 : 56));

        const rect = (x: number, y: number, w: number, h: number, fill: string, title: string, desc: string) => {
            const midX = x + w / 2;
            const titleText = this.escapeXml(this.truncate(title, 48));
            const descText = this.escapeXml(this.truncate(desc, 62));
            const cardTitle = this.pickReadableTextColor(fill, text);
            const cardBody = this.mixHex(cardTitle, fill, 0.30);
            return `
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${fill}" stroke="${stroke}" stroke-width="2.2" stroke-dasharray="4 2"/>
<text x="${midX}" y="${y + 34}" text-anchor="middle" font-family="${fontFamily}" font-size="19" font-weight="700" fill="${cardTitle}">${titleText}</text>
<text x="${midX}" y="${y + 60}" text-anchor="middle" font-family="${fontFamily}" font-size="15" font-weight="500" fill="${cardBody}" opacity="0.98">${descText}</text>`;
        };

        const arrows: string[] = [];
        const cards: string[] = [];
        const centerCardX = Math.floor((width - 520) / 2);
        const centerCardW = 520;
        cards.push(rect(centerCardX, topY, centerCardW, cardH, c6, branchModel.topTitle, branchModel.topDesc));
        cards.push(rect(centerCardX, splitY, centerCardW, cardH, c4, branchModel.splitTitle, 'Branch into parallel pathways'));
        arrows.push(`<line x1="${centerX}" y1="${topY + cardH}" x2="${centerX}" y2="${splitY}" stroke="${stroke}" stroke-width="2.4"/>`);

        const branchTails: Array<{ x: number; y: number }> = [];
        branchModel.branches.forEach((b, bi) => {
            const colX = margin + bi * (cardW + colGap);
            const colCenterX = colX + cardW / 2;
            const headY = branchStartY;
            cards.push(rect(colX, headY, cardW, cardH, c6, b.name, b.timeframe || 'Pathway'));
            arrows.push(`<polyline points="${centerX},${splitY + cardH} ${centerX},${splitY + cardH + 12} ${colCenterX},${splitY + cardH + 12} ${colCenterX},${headY}" fill="none" stroke="${stroke}" stroke-width="2.2"/>`);

            let currentY = headY;
            const steps = b.steps.length ? b.steps : ['(no steps provided)'];
            steps.forEach((step, si) => {
                const y = headY + (si + 1) * (cardH + gapY);
                cards.push(rect(colX, y, cardW, cardH, c4, `${b.name} Step ${si + 1}`, step));
                arrows.push(`<line x1="${colCenterX}" y1="${currentY + cardH}" x2="${colCenterX}" y2="${y}" stroke="${stroke}" stroke-width="2.2"/>`);
                currentY = y;
            });
            branchTails.push({ x: colCenterX, y: currentY + cardH });
        });

        cards.push(rect(centerCardX, mergeY, centerCardW, cardH, c6, branchModel.mergeTitle, branchModel.mergeDesc));
        branchTails.forEach((tail) => {
            arrows.push(`<polyline points="${tail.x},${tail.y} ${tail.x},${mergeY - 10} ${centerX},${mergeY - 10} ${centerX},${mergeY}" fill="none" stroke="${stroke}" stroke-width="2.2"/>`);
        });

        if (branchModel.footer) {
            cards.push(rect(centerCardX, footerY, centerCardW, cardH, c4, 'Footer Note', branchModel.footer));
            arrows.push(`<line x1="${centerX}" y1="${mergeY + cardH}" x2="${centerX}" y2="${footerY}" stroke="${stroke}" stroke-width="2.2"/>`);
        }

        return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${dynamicHeight}" viewBox="0 0 ${width} ${dynamicHeight}">
<defs>
  <style type="text/css"><![CDATA[
    @import url('https://fonts.googleapis.com/css2?family=Source+Sans+Pro:wght@400;600;700;800&display=swap');
    @import url('https://fonts.googleapis.com/css2?family=Patrick+Hand&display=swap');
  ]]></style>
</defs>
<rect x="0" y="0" width="${width}" height="${dynamicHeight}" fill="${bg}"/>
${titleBlock}
${subtitleBlock}
${arrows.join('\n')}
${cards.join('\n')}
</svg>`;
    }

    private extractBranchModel(payload: any): {
        topTitle: string;
        topDesc: string;
        splitTitle: string;
        branches: Array<{ name: string; timeframe: string; steps: string[] }>;
        mergeTitle: string;
        mergeDesc: string;
        footer?: string;
    } | null {
        const structure = payload?.structure || {};
        const branches = Array.isArray(structure?.branches) ? structure.branches : [];
        if (!branches.length) return null;

        const topLabel = String(structure?.topSection?.label || payload?.title || 'Start').trim();
        const nextNode = String(structure?.topSection?.nextNode || 'Pathway Split').trim();
        const mappedBranches = branches.map((b: any) => ({
            name: String(b?.name || 'Branch').trim(),
            timeframe: String(b?.timeframe || '').trim(),
            steps: [
                ...(Array.isArray(b?.sequence) ? b.sequence.map((x: any) => String(x || '').trim()).filter(Boolean) : []),
                ...(Array.isArray(b?.effects) ? b.effects.map((x: any) => String(x || '').trim()).filter(Boolean) : []),
            ]
        }));

        return {
            topTitle: topLabel,
            topDesc: `Next: ${nextNode}`,
            splitTitle: nextNode,
            branches: mappedBranches,
            mergeTitle: 'Convergence',
            mergeDesc: String(structure?.convergenceNote || 'Pathways converge into a shared outcome.'),
            footer: structure?.footerNote ? String(structure.footerNote) : undefined
        };
    }

    private escapeD2(input: string): string {
        return String(input || '').replace(/"/g, '\'').replace(/\n+/g, ' ').trim();
    }

    private truncate(input: string, max: number): string {
        const raw = String(input || '').replace(/\s+/g, ' ').trim();
        if (raw.length <= max) return raw;
        return `${raw.slice(0, Math.max(0, max - 3)).trim()}...`;
    }

    private wrapTextLines(input: string, maxCharsPerLine: number, maxLines: number): string[] {
        const words = String(input || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
        if (!words.length) return [];
        const lines: string[] = [];
        let current = '';
        for (const word of words) {
            const next = current ? `${current} ${word}` : word;
            if (next.length <= maxCharsPerLine) {
                current = next;
                continue;
            }
            if (current) lines.push(current);
            current = word;
            if (lines.length >= maxLines) break;
        }
        if (lines.length < maxLines && current) lines.push(current);
        if (lines.length > maxLines) lines.length = maxLines;
        if (lines.length && words.join(' ').length > lines.join(' ').length) {
            const last = lines[lines.length - 1];
            lines[lines.length - 1] = this.truncate(last, Math.max(8, maxCharsPerLine - 3));
        }
        return lines;
    }

    private hexToRgba(hex: string, alpha: number): string {
        const normalized = this.normalizeColor(hex, '#FAF9F6').replace('#', '');
        const full = normalized.length === 3
            ? normalized.split('').map(ch => ch + ch).join('')
            : normalized.slice(0, 6);
        const value = parseInt(full, 16);
        const r = (value >> 16) & 255;
        const g = (value >> 8) & 255;
        const b = value & 255;
        const a = Math.max(0, Math.min(1, alpha));
        return `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    private mixHex(base: string, mix: string, mixRatio: number): string {
        const a = this.hexToRgb(this.normalizeColor(base, '#000000'));
        const b = this.hexToRgb(this.normalizeColor(mix, '#ffffff'));
        const t = Math.max(0, Math.min(1, mixRatio));
        const r = Math.round(a.r * (1 - t) + b.r * t);
        const g = Math.round(a.g * (1 - t) + b.g * t);
        const bl = Math.round(a.b * (1 - t) + b.b * t);
        return `#${[r, g, bl].map(v => v.toString(16).padStart(2, '0')).join('')}`;
    }

    private hexToRgb(hex: string): { r: number; g: number; b: number } {
        const normalized = this.normalizeColor(hex, '#000000').replace('#', '');
        const full = normalized.length === 3
            ? normalized.split('').map(ch => ch + ch).join('')
            : normalized.slice(0, 6);
        const value = parseInt(full, 16);
        return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
    }

    private pickReadableTextColor(backgroundHex: string, preferred: string): string {
        const light = '#EAF2FF';
        const dark = '#12233D';
        const preferredRatio = this.contrastRatio(backgroundHex, preferred);
        if (preferredRatio >= 4.5) return preferred;
        const lightRatio = this.contrastRatio(backgroundHex, light);
        const darkRatio = this.contrastRatio(backgroundHex, dark);
        return lightRatio >= darkRatio ? light : dark;
    }

    private contrastRatio(a: string, b: string): number {
        const la = this.relativeLuminance(a);
        const lb = this.relativeLuminance(b);
        const [L1, L2] = la > lb ? [la, lb] : [lb, la];
        return (L1 + 0.05) / (L2 + 0.05);
    }

    private relativeLuminance(hex: string): number {
        const { r, g, b } = this.hexToRgb(hex);
        const norm = [r, g, b].map((v) => v / 255).map((v) => (
            v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
        ));
        return (0.2126 * norm[0]) + (0.7152 * norm[1]) + (0.0722 * norm[2]);
    }

    private escapeXml(input: string): string {
        return String(input || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
}
