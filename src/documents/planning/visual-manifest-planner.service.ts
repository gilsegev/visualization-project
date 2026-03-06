import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { AnchorCandidate, ContextWindow, ParagraphNode, SectionNode } from '../analysis/document-analysis.types';
import { validateDocumentVisualManifest } from './visual-manifest.schema';
import { DocumentVisualManifest, ManifestValidationResult, PlannedVisualization } from './visual-manifest.types';

function norm(v: string): string {
  return String(v || '').replace(/\s+/g, ' ').trim();
}

function titleFromText(text: string): string {
  return norm(text).split(' ').slice(0, 8).join(' ') || 'Key Concept';
}

function pickType(text: string, p?: ParagraphNode): PlannedVisualization['type'] {
  const t = norm(text).toLowerCase();
  if (p?.has_sequence || /\b(step\s+\d+|first|second|third|then|next|workflow|process)\b/.test(t)) return 'flowchart';
  if (/\b(percent|trend|rate|distribution|chart|count)\b/.test(t)) return 'data_viz';
  if (/\b(scene|photo|realistic|image)\b/.test(t)) return 'sourced_image';
  return 'infographic';
}

function proceduralScore(text: string): number {
  const t = norm(text).toLowerCase();
  const stepHits = (t.match(/\bstep\s+\d+\b/g) || []).length;
  const keywordHits = (t.match(/\b(process|workflow|procedure|sequence|then|next|first|second|third)\b/g) || []).length;
  return stepHits * 2 + keywordHits;
}

function dataScore(text: string): number {
  const t = norm(text).toLowerCase();
  const numericHits = (t.match(/(\d+(\.\d+)?\s?%|\$[\d,.]+|\bq[1-4]\b|\b\d+\s+(units|users|items|hours|days|weeks)\b)/g) || []).length;
  const keywordHits = (t.match(/\b(trend|rate|distribution|count|ratio|increase|decrease|growth|decline|kpi|metric)\b/g) || []).length;
  return numericHits * 2 + keywordHits;
}

function atmosphericScore(text: string): number {
  const t = norm(text).toLowerCase();
  const sensoryHits = (t.match(/\b(glow|sun|dust|smoke|scent|aroma|ambient|warm|cold|shadow|light|texture|scene|atmosphere|visual|color|forest|ocean|workshop)\b/g) || []).length;
  const imageryHits = (t.match(/\b(photo|image|realistic|cinematic|moody|wide shot|portrait)\b/g) || []).length;
  return sensoryHits + imageryHits * 2;
}

function sectionForIndex(sections: SectionNode[], index: number): string {
  const found = sections.find((s) => index >= s.paragraph_start && index <= s.paragraph_end);
  return found?.heading || 'Document Context';
}

function promptTemplateFor(type: PlannedVisualization['type'], text: string): string {
  if (type === 'data_viz') return `Create a chart-ready visualization from quantitative content: ${text}`;
  if (type === 'sourced_image') return `Find a realistic scene image matching this context: ${text}`;
  if (type === 'flowchart') return `Create a flowchart from ordered steps in this text: ${text}`;
  if (type === 'aesthetic_anchor') return `Create a non-literal atmospheric visual anchor for this concept: ${text}`;
  return `Create an instructional infographic from this concept: ${text}`;
}

function mermaidHeader(code: string): string {
  return /^\s*flowchart\s+(TB|TD|LR|RL|BT)\b/m.test(code) ? code : `flowchart TD\n${code}`;
}

function extractSteps(text: string): string[] {
  const normalized = norm(text);
  const explicitSteps = normalized.match(/step\s*\d+\s*[:.)-]?\s*[^.?!]+[.?!]?/gi) || [];
  if (explicitSteps.length >= 2) {
    return explicitSteps.map((s) => norm(s)).slice(0, 8);
  }
  const parts = text
    .split(/(?=(?:^|\s)(?:step\s*\d+[.)]?|[0-9]+[.)])\s+)/i)
    .map((s) => norm(s))
    .filter(Boolean);
  if (parts.length >= 2) return parts;
  return text
    .split(/[.;]\s+/)
    .map((s) => norm(s))
    .filter((s) => s.length >= 12)
    .slice(0, 6);
}

function toMermaidFlowchart(text: string): string {
  const steps = extractSteps(text);
  if (steps.length < 2) return '';
  const nodes = steps.map((step, i) => {
    const clean = step.replace(/[\[\]]/g, '');
    const clipped = clean.length > 120 ? `${clean.slice(0, 117)}...` : clean;
    return `S${i + 1}[${clipped}]`;
  });
  const edges = steps.slice(0, -1).map((_, i) => `S${i + 1} --> S${i + 2}`);
  return ['flowchart TD', ...nodes, ...edges].join('\n');
}

function isMermaidValid(code: string): boolean {
  const lines = String(code || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return false;
  if (!/^flowchart\s+(TB|TD|LR|RL|BT)\b/i.test(lines[0])) return false;
  const hasEdge = lines.some((l) => /-->\s*/.test(l));
  if (!hasEdge) return false;
  return !lines.some((l) => /-->\s*$/.test(l));
}

function selfCorrectMermaid(code: string): string {
  if (!code) return '';
  return mermaidHeader(code).replace(/\s*-\s*>\s*/g, ' --> ');
}

function chooseType(paragraphText: string, windowText: string, p?: ParagraphNode): PlannedVisualization['type'] {
  if (p?.has_sequence) return 'flowchart';
  if (p?.has_data) return 'data_viz';
  const paraProc = proceduralScore(paragraphText);
  const paraData = dataScore(paragraphText);
  const paraAtmos = atmosphericScore(paragraphText);
  if (paraProc >= 3 && paraProc >= paraData) return 'flowchart';
  if (paraData >= 2 && paraData > paraProc) return 'data_viz';
  if (paraAtmos >= 2) return 'sourced_image';
  const paraType = pickType(paragraphText, p);
  if (paraType !== 'infographic') return paraType;
  const proc = proceduralScore(windowText);
  const data = dataScore(windowText);
  const atmos = atmosphericScore(windowText);
  if (proc >= 4 && proc >= data) return 'flowchart';
  if (data >= 3 && data > proc) return 'data_viz';
  if (atmos >= 3) return 'sourced_image';
  return pickType(windowText, p);
}

function splitSentences(text: string): string[] {
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => norm(s))
    .filter(Boolean);
}

function buildFlowchartText(paragraphText: string, windowText: string): string {
  const candidate = norm(windowText || paragraphText);
  const steps = extractSteps(candidate).slice(0, 8);
  const text = steps.length >= 2 ? steps.join(' ') : norm(paragraphText || candidate);
  return text.length > 900 ? `${text.slice(0, 900)}...` : text;
}

function buildDataVizText(paragraphText: string, windowText: string): string {
  const sentences = splitSentences(windowText);
  const kept = sentences.filter((s) =>
    /(\d|\bq[1-4]\b|%|\$|\b(trend|rate|distribution|count|ratio|increase|decrease|growth|decline|metric|kpi)\b)/i.test(s)
  );
  const picked = (kept.length ? kept : splitSentences(paragraphText)).slice(0, 6).join(' ');
  const out = norm(picked || paragraphText || windowText);
  return out.length > 900 ? `${out.slice(0, 900)}...` : out;
}

function buildSourcedImageText(paragraphText: string, windowText: string): string {
  const sentences = splitSentences(windowText);
  const kept = sentences.filter((s) =>
    /\b(glow|sun|dust|smoke|scent|aroma|ambient|warm|cold|shadow|light|texture|scene|atmosphere|forest|ocean|workshop|photo|image)\b/i.test(s)
  );
  const picked = (kept.length ? kept : splitSentences(paragraphText)).slice(0, 4).join(' ');
  const out = norm(picked || paragraphText || windowText);
  return out.length > 700 ? `${out.slice(0, 700)}...` : out;
}

function buildTextForType(type: PlannedVisualization['type'], paragraphText: string, windowText: string): string {
  if (type === 'flowchart') return buildFlowchartText(paragraphText, windowText);
  if (type === 'data_viz') return buildDataVizText(paragraphText, windowText);
  if (type === 'sourced_image' || type === 'aesthetic_anchor') return buildSourcedImageText(paragraphText, windowText);
  const out = norm(paragraphText || windowText);
  return out.length > 700 ? `${out.slice(0, 700)}...` : out;
}

type AnchorRange = { start: number; end: number };
function rangeOverlapRatio(a: AnchorRange, b: AnchorRange): number {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  if (end < start) return 0;
  const intersect = end - start + 1;
  const minSpan = Math.min(a.end - a.start + 1, b.end - b.start + 1);
  return minSpan > 0 ? intersect / minSpan : 0;
}

@Injectable()
export class VisualManifestPlannerService {
  private readonly logger = new Logger(VisualManifestPlannerService.name);
  private readonly openai: OpenAI | null;

  constructor() {
    const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
    this.openai = apiKey ? new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
      defaultHeaders: {
        'HTTP-Referer': 'https://visualization-project.local',
        'X-Title': 'Visualization Project'
      }
    }) : null;
  }

  async buildManifest(input: {
    jobId: string;
    title: string;
    paragraphs: ParagraphNode[];
    sections: SectionNode[];
    anchors: AnchorCandidate[];
    contextWindows?: ContextWindow[];
    maxAssets?: number;
  }): Promise<DocumentVisualManifest> {
    const maxAssets = Math.max(1, Number(input.maxAssets || process.env.DOC_MAX_ASSETS || 20));
    const deterministic = this.buildManifestDeterministic(input, maxAssets);
    const useLlm = String(process.env.DOC_PLANNING_USE_LLM || 'true').toLowerCase() === 'true';
    if (!useLlm || !this.openai) return deterministic;

    try {
      const llmVisuals = await this.planVisualsWithLlm(input, maxAssets);
      if (!llmVisuals.length) return deterministic;
      const manifest: DocumentVisualManifest = {
        ...deterministic,
        lessons: [{
          ...deterministic.lessons[0],
          visualizations: llmVisuals
        }]
      };
      return manifest;
    } catch (error: any) {
      this.logger.warn(`LLM doc planning failed, using deterministic fallback: ${error?.message || error}`);
      return deterministic;
    }
  }

  private buildManifestDeterministic(input: {
    jobId: string;
    title: string;
    paragraphs: ParagraphNode[];
    sections: SectionNode[];
    anchors: AnchorCandidate[];
    contextWindows?: ContextWindow[];
  }, maxAssets: number): DocumentVisualManifest {
    const seen = new Set<string>();
    const usedRangesByType = new Map<PlannedVisualization['type'], AnchorRange[]>();
    const visuals: PlannedVisualization[] = [];
    const windowsByAnchor = new Map(
      (input.contextWindows || []).map((w) => [String(w.anchor_id || ''), w])
    );
    for (const anchor of input.anchors) {
      const p = input.paragraphs[anchor.paragraph_index];
      if (!p) continue;
      const window = windowsByAnchor.get(anchor.anchor_id);
      const paragraphText = norm(p.text);
      const windowText = norm(window?.content || paragraphText);
      const type = chooseType(paragraphText, windowText, p);
      const text = buildTextForType(type, paragraphText, windowText);
      const fingerprint = text.toLowerCase().replace(/[^a-z0-9 ]/g, '');
      if (!fingerprint || seen.has(fingerprint)) continue;
      const range: AnchorRange = {
        start: Number(window?.paragraph_start_index ?? anchor.paragraph_index),
        end: Number(window?.paragraph_end_index ?? anchor.paragraph_index),
      };
      const usedRanges = usedRangesByType.get(type) || [];
      if (usedRanges.some((r) => rangeOverlapRatio(r, range) >= 0.6)) continue;
      seen.add(fingerprint);
      usedRanges.push(range);
      usedRangesByType.set(type, usedRanges);
      const planned: PlannedVisualization = {
        type,
        title: titleFromText(text),
        description: text.slice(0, 500),
        context: `Anchor ${anchor.anchor_id} in section "${sectionForIndex(input.sections, anchor.paragraph_index)}"`,
        purpose: 'Visually reinforce the surrounding document concept.',
        prompt_template: promptTemplateFor(type, text),
      };
      if (type === 'flowchart') {
        let mermaid = toMermaidFlowchart(text);
        let valid = isMermaidValid(mermaid);
        if (!valid) {
          mermaid = selfCorrectMermaid(mermaid);
          valid = isMermaidValid(mermaid);
        }
        if (valid) {
          planned.mermaid_code = mermaid;
          planned.mermaid_valid = true;
        } else {
          planned.type = 'aesthetic_anchor';
          planned.prompt_template = promptTemplateFor('aesthetic_anchor', text);
          planned.fallback_reason = 'mermaid_validation_failed_after_single_retry';
          planned.mermaid_valid = false;
        }
      }
      visuals.push(planned);
      if (visuals.length >= maxAssets) break;
    }

    const manifest: DocumentVisualManifest = {
      course: {
        title: norm(input.title) || 'Document Visualization Plan',
        targetAudience: 'Document readers'
      },
      lessons: [
        {
          lessonId: `doc-${input.jobId}`,
          title: 'Document Visual Plan',
          visualizations: visuals.length ? visuals : [{
            type: 'infographic',
            title: 'Overview',
            description: 'Visual summary of the document.',
            context: 'Fallback planning mode',
            purpose: 'Provide at least one visual anchor.'
          }]
        }
      ],
      metadata: {
        manifest_version: 1,
        job_id: input.jobId,
        generated_at: new Date().toISOString()
      }
    };
    return manifest;
  }

  private async planVisualsWithLlm(input: {
    jobId: string;
    title: string;
    paragraphs: ParagraphNode[];
    sections: SectionNode[];
    anchors: AnchorCandidate[];
    contextWindows?: ContextWindow[];
  }, maxAssets: number): Promise<PlannedVisualization[]> {
    if (!this.openai) return [];
    const windowsByAnchor = new Map((input.contextWindows || []).map((w) => [String(w.anchor_id || ''), w]));
    const candidates = input.anchors.slice(0, Math.max(maxAssets * 3, 12)).map((a) => {
      const p = input.paragraphs[a.paragraph_index];
      const w = windowsByAnchor.get(a.anchor_id);
      const text = norm((w?.content || p?.text || '').slice(0, 1800));
      return {
        anchor_id: a.anchor_id,
        section: sectionForIndex(input.sections, a.paragraph_index),
        paragraph_index: a.paragraph_index,
        confidence: a.confidence,
        reason: a.reason,
        text
      };
    }).filter((c) => c.text.length > 0);

    const systemPrompt = [
      'You are a document visualization planner.',
      'Return JSON only (no markdown).',
      `Plan up to ${maxAssets} visuals from anchor candidates.`,
      'Use types: infographic | sourced_image | data_viz | flowchart | aesthetic_anchor.',
      'Prefer data_viz for numeric/trend content; flowchart for procedural steps; sourced_image for scene context.',
      'Output shape: {"visualizations":[{"type":"...","title":"...","description":"...","context":"...","purpose":"..."}]}'
    ].join('\n');

    const userPrompt = JSON.stringify({
      doc_title: input.title,
      job_id: input.jobId,
      max_assets: maxAssets,
      anchors: candidates,
    });

    const model = String(process.env.DOC_PLANNING_MODEL || process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001').trim();
    const completion = await this.openai.chat.completions.create({
      model,
      response_format: { type: 'text' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 2400,
      temperature: 0.2
    });
    const raw = String(completion?.choices?.[0]?.message?.content || '').trim();
    const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const inVisuals = Array.isArray(parsed?.visualizations) ? parsed.visualizations : [];

    const seen = new Set<string>();
    const visuals: PlannedVisualization[] = [];
    for (const v of inVisuals) {
      if (visuals.length >= maxAssets) break;
      const text = norm(String(v?.description || v?.title || '').slice(0, 2000));
      const fingerprint = text.toLowerCase().replace(/[^a-z0-9 ]/g, '');
      if (!fingerprint || seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      const typeCandidate = String(v?.type || '').trim() as PlannedVisualization['type'];
      const mappedType = ['infographic', 'sourced_image', 'data_viz', 'flowchart', 'aesthetic_anchor'].includes(typeCandidate)
        ? typeCandidate
        : pickType(text);
      const planned: PlannedVisualization = {
        type: mappedType,
        title: titleFromText(norm(v?.title || text)),
        description: text || 'Contextual visual planned from document anchors.',
        context: norm(v?.context || `Anchor-derived context in section "${norm(v?.section || 'Document Context')}"`),
        purpose: norm(v?.purpose || 'Visually reinforce the surrounding document concept.'),
        prompt_template: promptTemplateFor(mappedType, text)
      };
      if (planned.type === 'flowchart') {
        let mermaid = toMermaidFlowchart(text);
        let valid = isMermaidValid(mermaid);
        if (!valid) {
          mermaid = selfCorrectMermaid(mermaid);
          valid = isMermaidValid(mermaid);
        }
        if (valid) {
          planned.mermaid_code = mermaid;
          planned.mermaid_valid = true;
        } else {
          planned.type = 'aesthetic_anchor';
          planned.prompt_template = promptTemplateFor('aesthetic_anchor', text);
          planned.fallback_reason = 'mermaid_validation_failed_after_single_retry';
          planned.mermaid_valid = false;
        }
      }
      visuals.push(planned);
    }
    return visuals;
  }

  validateManifest(manifest: DocumentVisualManifest): ManifestValidationResult {
    return validateDocumentVisualManifest(manifest);
  }
}
