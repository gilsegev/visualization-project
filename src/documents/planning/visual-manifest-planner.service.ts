import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { AnchorCandidate, ContextWindow, ParagraphNode, SectionNode } from '../analysis/document-analysis.types';
import { validateDocumentVisualManifest } from './visual-manifest.schema';
import {
  DocumentVisualManifest,
  ManifestValidationResult,
  PlannedVisualization,
  PlannedVisualizationPlacement,
  PlacementScope
} from './visual-manifest.types';

type PlannerTelemetryEvent =
  | {
      type: 'planner_mode';
      mode: 'deterministic' | 'llm';
      reason?: string;
    }
  | {
      type: 'llm_request';
      model: string;
      system_prompt: string;
      user_prompt: string;
      candidate_count: number;
      max_assets: number;
    }
  | {
      type: 'llm_response';
      model: string;
      raw_response: string;
      cleaned_response: string;
      usage: {
        prompt_tokens: number | null;
        completion_tokens: number | null;
        total_tokens: number | null;
      };
      duration_ms: number;
      parsed_visual_count: number;
      normalized_visual_count: number;
      placement_normalization: Array<{
        index: number;
        requested_anchor_id: string | null;
        resolved_anchor_id: string;
        requested_scope: string | null;
        resolved_scope: PlacementScope;
        reasons: string[];
      }>;
    }
  | {
      type: 'llm_error';
      model: string;
      error_message: string;
    };

function norm(v: string): string {
  return String(v || '').replace(/\s+/g, ' ').trim();
}

function stripCodeFences(text: string): string {
  return String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
}

function trimToFirstJsonObject(text: string): string {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  return start >= 0 ? raw.slice(start) : raw;
}

function repairPossiblyTruncatedJson(text: string): string {
  const src = trimToFirstJsonObject(stripCodeFences(text))
    .replace(/,\s*([}\]])/g, '$1');
  if (!src) return src;

  let out = '';
  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    out += ch;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') {
      stack.push(ch);
      continue;
    }
    if (ch === '}' || ch === ']') {
      const top = stack[stack.length - 1];
      if ((top === '{' && ch === '}') || (top === '[' && ch === ']')) {
        stack.pop();
      }
    }
  }

  if (inString) out += '"';
  while (stack.length) {
    const top = stack.pop();
    out += top === '{' ? '}' : ']';
  }
  return out.replace(/,\s*([}\]])/g, '$1').trim();
}

function extractFirstBalancedJsonObject(text: string): string {
  const src = trimToFirstJsonObject(stripCodeFences(text));
  if (!src || src[0] !== '{') return '';
  let inString = false;
  let escaped = false;
  let depth = 0;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(0, i + 1);
    }
  }
  return '';
}

function titleFromText(text: string): string {
  return norm(text).split(' ').slice(0, 8).join(' ') || 'Key Concept';
}

function isWeakConceptText(text: string): boolean {
  const t = norm(text);
  if (!t) return true;
  if (t.length < 28) return true;
  return /^(highlights?|overview|summary|key points?|insights?|snapshot|introduction)$/i.test(t);
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

function defaultPlacementForType(type: PlannedVisualization['type']): PlannedVisualizationPlacement {
  if (type === 'flowchart') {
    return {
      scope: 'after_list_block',
      priority: 85,
      avoid_headings: true,
      avoid_list_split: true,
      max_width_in: 5.4,
      max_height_in: 4.8,
      alignment: 'center',
    };
  }
  if (type === 'data_viz') {
    return {
      scope: 'after_anchor',
      priority: 80,
      avoid_headings: true,
      avoid_list_split: true,
      max_width_in: 5.4,
      max_height_in: 4.4,
      alignment: 'center',
    };
  }
  if (type === 'infographic') {
    return {
      scope: 'section_intro_body',
      priority: 75,
      avoid_headings: true,
      avoid_list_split: true,
      max_width_in: 5.6,
      max_height_in: 5.6,
      alignment: 'center',
    };
  }
  return {
    scope: 'after_anchor',
    priority: 70,
    avoid_headings: true,
    avoid_list_split: true,
    max_width_in: 4.8,
    max_height_in: 4.8,
    alignment: 'center',
  };
}

function clampPriority(value: any, fallback = 70): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(100, Math.round(n)));
}

function promptTemplateFor(type: PlannedVisualization['type'], text: string): string {
  if (type === 'data_viz') return `Create a chart-ready visualization from quantitative content: ${text}`;
  if (type === 'sourced_image') return `Find a realistic scene image matching this context: ${text}`;
  if (type === 'flowchart') return `Create a flowchart from ordered steps in this text: ${text}`;
  if (type === 'aesthetic_anchor') return `Create a non-literal atmospheric visual anchor for this concept: ${text}`;
  return `Create an instructional infographic from this concept: ${text}`;
}

function captionTypePrefix(type: PlannedVisualization['type']): string {
  if (type === 'flowchart') return 'Flowchart';
  if (type === 'data_viz') return 'Data view';
  if (type === 'sourced_image') return 'Illustration';
  if (type === 'aesthetic_anchor') return 'Visual context';
  return 'Figure';
}

function sanitizeCaptionText(raw: any): string {
  return String(raw || '')
    .replace(/`{1,3}/g, '')
    .replace(/\*\*/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateCaption(text: string, maxChars: number): string {
  const clean = sanitizeCaptionText(text);
  if (!clean) return '';
  if (clean.length <= maxChars) return clean;
  const sliced = clean.slice(0, maxChars + 1);
  const cut = sliced.lastIndexOf(' ');
  const out = cut > 60 ? sliced.slice(0, cut) : clean.slice(0, maxChars);
  return `${out.trim()}...`;
}

function buildAutoCaption(input: {
  type: PlannedVisualization['type'];
  title?: string;
  purpose?: string;
  context?: string;
  maxChars: number;
}): string {
  const prefix = captionTypePrefix(input.type);
  const title = sanitizeCaptionText(input.title || '');
  const purpose = sanitizeCaptionText(input.purpose || '').replace(/\.+$/, '');
  const sectionMatch = String(input.context || '').match(/section\s+"([^"]+)"/i);
  const section = sanitizeCaptionText(sectionMatch?.[1] || '');
  const pieces = [
    `${prefix}:`,
    title || 'Document concept',
    purpose ? `- ${purpose}` : '',
    section ? `(section: ${section})` : '',
  ].filter(Boolean);
  return truncateCaption(pieces.join(' '), input.maxChars);
}

function resolveCaption(input: {
  type: PlannedVisualization['type'];
  title?: string;
  purpose?: string;
  context?: string;
  explicitCaption?: any;
  maxChars: number;
}): { caption_text: string; caption_mode: 'auto' | 'explicit' } {
  const explicit = truncateCaption(String(input.explicitCaption || ''), input.maxChars);
  if (explicit) return { caption_text: explicit, caption_mode: 'explicit' };
  const auto = buildAutoCaption({
    type: input.type,
    title: input.title,
    purpose: input.purpose,
    context: input.context,
    maxChars: input.maxChars,
  });
  return { caption_text: auto || 'Figure: Visual summary of the surrounding content.', caption_mode: 'auto' };
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

function getMermaidValidationError(code: string): string {
  const lines = String(code || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return 'empty_mermaid_output';
  if (!/^flowchart\s+(TB|TD|LR|RL|BT)\b/i.test(lines[0])) return 'missing_or_invalid_flowchart_header';
  const hasEdge = lines.some((l) => /-->\s*/.test(l));
  if (!hasEdge) return 'missing_edges_between_nodes';
  if (lines.some((l) => /-->\s*$/.test(l))) return 'dangling_edge_without_target_node';
  return 'unknown_mermaid_validation_error';
}

function selfCorrectMermaid(code: string): string {
  if (!code) return '';
  return mermaidHeader(code)
    .replace(/\s*-\s*>\s*/g, ' --> ')
    .replace(/\s*-->\s*$/gm, '')
    .replace(/[^\S\r\n]+$/gm, '')
    .trim();
}

function dataVizLooksValid(text: string): boolean {
  const t = norm(text).toLowerCase();
  return /(\d|%|\$|\bq[1-4]\b|\b(trend|rate|distribution|count|ratio|increase|decrease|growth|decline|metric|kpi)\b)/i.test(t);
}

function parsePlacementDslToken(input: any): PlacementScope | null {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return null;
  const token = raw.replace(/[\[\]\s-]+/g, '_');
  if (token === 'after_anchor' || token === 'after') return 'after_anchor';
  if (token === 'after_list_block' || token === 'after_list') return 'after_list_block';
  if (token === 'section_intro_body' || token === 'intro_body') return 'section_intro_body';
  if (token === 'section_end' || token === 'end_of_section') return 'section_end';
  return null;
}

function validateTypeEligibility(type: PlannedVisualization['type'], paragraphText: string, windowText: string): { valid: boolean; reason: string } {
  const text = norm(`${paragraphText} ${windowText}`);
  if (type === 'flowchart') {
    const steps = extractSteps(text);
    if (steps.length < 2) return { valid: false, reason: 'flowchart_requires_two_or_more_ordered_steps' };
    return { valid: true, reason: 'flowchart_evidence_present' };
  }
  if (type === 'data_viz') {
    if (!dataVizLooksValid(text)) return { valid: false, reason: 'data_viz_requires_numeric_or_metric_evidence' };
    return { valid: true, reason: 'data_viz_evidence_present' };
  }
  if (type === 'sourced_image') {
    if (/\b(visual representation|diagram|compare|comparison|examples? of|types? of|different kinds?|labeled|labelled)\b/i.test(text)) {
      return { valid: false, reason: 'sourced_image_requires_scene_not_instructional_visual' };
    }
    if (/\b(knot|loop|tie)\b/i.test(text) && /,\s*[A-Z][A-Za-z' -]+/.test(text)) {
      return { valid: false, reason: 'sourced_image_requires_scene_not_named_technique_list' };
    }
  }
  return { valid: true, reason: 'type_eligible' };
}

function remapIneligibleType(type: PlannedVisualization['type'], paragraphText: string, windowText: string): PlannedVisualization['type'] {
  const text = norm(`${paragraphText} ${windowText}`);
  if (type === 'flowchart' || type === 'data_viz') {
    if (atmosphericScore(text) >= 2) return 'sourced_image';
    return 'infographic';
  }
  if (type === 'sourced_image') {
    return 'infographic';
  }
  return type;
}

function rewriteConceptForAtmosphericFallback(text: string): string {
  const bannedPatterns: RegExp[] = [
    /\bstep-by-step\b/gi,
    /\bsteps?\b/gi,
    /\bstep\s*\d+\b/gi,
    /\bflowcharts?\b/gi,
    /\bdiagrams?\b/gi,
    /\bcharts?\b/gi,
    /\bbar\s*graphs?\b/gi,
    /\bline\s*graphs?\b/gi,
    /\bpie\s*charts?\b/gi,
    /\btables?\b/gi,
    /\baxes\b/gi,
    /\bx-axis\b/gi,
    /\by-axis\b/gi,
    /\blabels?\b/gi,
    /\blabeled\b/gi,
    /\blegend\b/gi,
    /\bannotat(?:e|ed|ion|ions)\b/gi,
  ];
  let cleaned = norm(text);
  for (const pattern of bannedPatterns) cleaned = cleaned.replace(pattern, ' ');
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
  const words = cleaned.split(' ').filter(Boolean);
  return words.slice(0, 32).join(' ') || 'the central concept from this section';
}

function atmosphericPromptForFallback(text: string): string {
  let concept = rewriteConceptForAtmosphericFallback(text);
  // Final safety pass to ensure disallowed literal-instruction terms never leak into fallback prompts.
  concept = concept
    .replace(/\b(step|flowchart|diagram|chart|table|label|labeled|legend|annotat(?:e|ed|ion|ions))\w*\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!concept) concept = 'the central concept from this section';
  return `Create a non-literal, high-aesthetic photograph that symbolizes this concept with no charts, text, labels, or diagrams: ${concept}`;
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
  const localSentences = splitSentences(paragraphText);
  const localKept = localSentences.filter((s) =>
    /(\d|\bq[1-4]\b|%|\$|\b(trend|rate|distribution|count|ratio|increase|decrease|growth|decline|metric|kpi)\b)/i.test(s)
  );
  const windowSentences = splitSentences(windowText);
  const windowKept = windowSentences.filter((s) =>
    /(\d|\bq[1-4]\b|%|\$|\b(trend|rate|distribution|count|ratio|increase|decrease|growth|decline|metric|kpi)\b)/i.test(s)
  );
  const picked = (localKept.length >= 2 ? localKept : (windowKept.length ? windowKept : localSentences)).slice(0, 6).join(' ');
  const out = norm(picked || paragraphText || windowText);
  return out.length > 900 ? `${out.slice(0, 900)}...` : out;
}

type GroundedMetricFamilyKind = 'currency' | 'percent' | 'count' | 'quarter' | 'generic';
type GroundedMetricFamily = {
  key: string;
  kind: GroundedMetricFamilyKind;
  points: Array<{ label: string; value: number }>;
};

type GroundedDataSeries = {
  kind: GroundedMetricFamilyKind;
  points: Array<{ label: string; value: number }>;
};

function normalizeLabelStem(label: string): string {
  return norm(label)
    .toLowerCase()
    .replace(/\((m|b|k|%|\$b)\)/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function seriesQualityScore(series: GroundedDataSeries): number {
  const points = Array.isArray(series?.points) ? series.points : [];
  if (points.length < 2) return 0;
  let score = 0;
  if (points.length >= 3) score += 6;
  const stems = points.map((p) => normalizeLabelStem(String(p?.label || '')));
  const uniqueStems = new Set(stems.filter(Boolean));
  score += uniqueStems.size >= points.length ? 3 : -4;
  const values = points.map((p) => Number(p?.value)).filter((v) => Number.isFinite(v));
  if (values.length >= 2) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max === min) score -= 5;
    else if (Math.abs(max - min) >= Math.max(0.25, min * 0.05)) score += 2;
  }
  if (points.length === 2) {
    const [a, b] = stems;
    if (a && b) {
      if (a === b) score -= 6;
      if (a.includes(b) || b.includes(a)) score -= 3;
    }
  }
  if (series.kind === 'quarter') score += 2;
  return score;
}

function isSeriesAcceptable(series: GroundedDataSeries): boolean {
  const points = Array.isArray(series?.points) ? series.points : [];
  if (points.length < 2) return false;
  if (points.length >= 3) return seriesQualityScore(series) >= 5;
  return seriesQualityScore(series) >= 7;
}

const METRIC_STOPWORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'is', 'it', 'of', 'on', 'or', 'per', 'the', 'to', 'was',
  'were', 'with', 'this', 'that', 'these', 'those', 'approximately', 'about', 'around', 'nearly', 'roughly', 'latest',
  'current', 'total', 'overall', 'calendar', 'year', 'last', 'next'
]);

function titleCaseLabel(value: string): string {
  return norm(value)
    .split(' ')
    .filter(Boolean)
    .map((token) => {
      if (/^[A-Z0-9&/%()-]+$/.test(token)) return token;
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join(' ');
}

function localMetricPhrase(text: string, index: number, direction: 'before' | 'after'): string {
  const raw = direction === 'before'
    ? text.slice(Math.max(0, index - 96), index)
    : text.slice(index, Math.min(text.length, index + 96));
  const cleaned = norm(raw.replace(/[|]/g, ' '));
  if (!cleaned) return '';
  const clauses = cleaned.split(/[.;!?]/).map((part) => norm(part)).filter(Boolean);
  const candidate = direction === 'before'
    ? (clauses[clauses.length - 1] || '')
    : (clauses[0] || '');
  return candidate;
}

function inferMetricStem(prefix: string, suffix = ''): string {
  const combined = norm(`${prefix} ${suffix}`.replace(/[$%]/g, ' '));
  if (!combined) return '';
  const words = combined.match(/[A-Za-z][A-Za-z0-9/&()-]*/g) || [];
  const kept = words.filter((word) => !METRIC_STOPWORDS.has(word.toLowerCase()));
  if (!kept.length) return '';
  const tail = kept.slice(Math.max(0, kept.length - 4));
  return titleCaseLabel(tail.join(' '));
}

function inferPercentLabel(prefix: string, suffix = ''): string {
  const stem = inferMetricStem(prefix, suffix);
  if (!stem) return 'Percentage (%)';
  if (/\b(rate|share|ratio|mix|portion|growth|decline|change|conversion|retention)\b/i.test(stem)) {
    return `${stem} (%)`;
  }
  return `${stem} Share (%)`;
}

function inferCurrencyLabel(prefix: string, suffix = ''): string {
  const stem = inferMetricStem(prefix, suffix);
  if (!stem) return 'Amount ($B)';
  if (/\b(cost|expense|revenue|sales|income|profit|loss|budget|spend|spending|impact|value|price|gdp|funding)\b/i.test(stem)) {
    return `${stem} ($B)`;
  }
  return `${stem} Value ($B)`;
}

function hasCurrencySignal(prefix: string, suffix = ''): boolean {
  const context = norm(`${prefix} ${suffix}`).toLowerCase();
  return /\b(cost|expense|revenue|sales|income|profit|loss|budget|spend|spending|impact|value|price|gdp|funding|market|valuation|economic)\b/.test(context);
}

function inferCountLabel(prefix: string, noun: string): string {
  const stem = inferMetricStem(prefix, noun);
  const nounLabel = titleCaseLabel(String(noun || '').replace(/s$/i, ''));
  if (!stem) return `${nounLabel || 'Count'} (M)`;
  if (new RegExp(`\\b${String(nounLabel || '').toLowerCase()}\\b`, 'i').test(stem)) return `${stem} (M)`;
  return `${stem} ${nounLabel}`.trim() + ' (M)';
}

function normalizeMetricLabel(raw: string, fallback: string): string {
  const clean = norm(raw).replace(/[:=,-]+$/g, '').slice(0, 64);
  return clean || fallback;
}

function normalizeAgeGroupLabel(raw: string): string {
  const value = norm(String(raw || ''))
    .replace(/\bamong\b/gi, '')
    .replace(/\bages?\b/gi, 'Age ')
    .replace(/\bseniors?\b/gi, 'Age ')
    .replace(/\s+and older\b/gi, '+')
    .replace(/\s*\+\s*/g, '+')
    .replace(/\s*to\s*/gi, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) return '';
  const compact = value
    .replace(/^Age\s+/i, 'Age ')
    .replace(/^(\d{2})-(\d{2})$/i, 'Age $1-$2')
    .replace(/^(\d{2}\+)$/i, 'Age $1');
  return compact;
}

function extractAgeGroupCountSeries(text: string): Array<{ label: string; value: number }> {
  const sentences = splitSentences(text);
  const orderedLabels: string[] = [];
  const latestByLabel = new Map<string, number>();

  for (const sentence of sentences) {
    const explicit = Array.from(sentence.matchAll(/(\d+(?:\.\d+)?)\s*(million|billion|thousand)\s+(?:among\s+)?((?:ages?\s+\d+\s*(?:to|-)\s*\d+)|(?:ages?\s+\d+\+)|(?:\d+\s+and older)|(?:seniors?\s+\d+\+))/gi));
    if (explicit.length >= 2) {
      for (const match of explicit) {
        const label = normalizeAgeGroupLabel(String(match[3] || ''));
        const base = Number(match[1]);
        const scale = String(match[2] || '').toLowerCase();
        const scaled =
          scale === 'million' ? base
          : scale === 'billion' ? base * 1000
          : base / 1000;
        if (!label || !Number.isFinite(scaled)) continue;
        if (!orderedLabels.includes(label)) orderedLabels.push(label);
        latestByLabel.set(label, scaled);
      }
      continue;
    }

    if (!orderedLabels.length) continue;
    if (!/\b(20\d{2}|by\s+20\d{2}|season)\b/i.test(sentence)) continue;
    const values = Array.from(sentence.matchAll(/(\d+(?:\.\d+)?)\s*(million|billion|thousand)\b/gi))
      .map((match) => {
        const base = Number(match[1]);
        const scale = String(match[2] || '').toLowerCase();
        return scale === 'million' ? base : scale === 'billion' ? base * 1000 : base / 1000;
      })
      .filter((value) => Number.isFinite(value));
    if (values.length !== orderedLabels.length) continue;
    orderedLabels.forEach((label, idx) => {
      latestByLabel.set(label, Number(values[idx]));
    });
  }

  return orderedLabels
    .map((label) => ({ label, value: Number(latestByLabel.get(label)) }))
    .filter((point) => point.label && Number.isFinite(point.value));
}

function isMetricLabelUsable(raw: string): boolean {
  const label = norm(raw).toLowerCase();
  if (!label) return false;
  if (label.length < 4 || label.length > 64) return false;
  if (/\b(respectively|million|billion|thousand|compared|continued|reaching|totals)\b/.test(label)) return false;
  const words = label.split(/\s+/).filter(Boolean);
  const nonStop = words.filter((word) => !METRIC_STOPWORDS.has(word));
  if (!nonStop.length) return false;
  if (nonStop.length === 1 && /^(metric|value|number|amount|figure|age)$/i.test(nonStop[0])) return false;
  return /[a-z]/i.test(label);
}

function buildGroundedMetricFamilies(paragraphText: string, windowText: string): GroundedMetricFamily[] {
  const text = norm(`${windowText} ${paragraphText}`);
  const families = new Map<string, GroundedMetricFamily>();
  const seen = new Set<string>();
  const push = (
    familyKey: string,
    kind: GroundedMetricFamilyKind,
    labelRaw: string,
    valueRaw: any,
    opts?: { replaceByLabel?: boolean }
  ) => {
    const label = normalizeMetricLabel(labelRaw, 'Metric');
    const value = Number(valueRaw);
    if (!label || !Number.isFinite(value)) return;
    if (!isMetricLabelUsable(label) && !/^Q[1-4]$/i.test(label)) return;
    const dedupe = `${familyKey}|${label.toLowerCase()}|${value}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    const family = families.get(familyKey) || { key: familyKey, kind, points: [] };
    if (opts?.replaceByLabel) {
      const existingIndex = family.points.findIndex((point) => point.label.toLowerCase() === label.toLowerCase());
      if (existingIndex >= 0) {
        family.points[existingIndex] = { label, value };
        families.set(familyKey, family);
        return;
      }
    }
    family.points.push({ label, value });
    families.set(familyKey, family);
  };

  for (const m of Array.from(text.matchAll(/\b(Q[1-4])\b[^0-9-]{0,20}(-?\d+(?:\.\d+)?)/gi))) {
    push('quarter', 'quarter', String(m[1] || '').toUpperCase(), m[2]);
  }

  for (const m of Array.from(text.matchAll(/\$([\d,.]+)\s*(billion|million|thousand)?/gi))) {
    const base = Number(String(m[1] || '').replace(/,/g, ''));
    const scale = String(m[2] || '').toLowerCase();
    const scaled =
      scale === 'billion' ? base
      : scale === 'million' ? base / 1000
      : scale === 'thousand' ? base / 1000000
      : base;
    const prefix = localMetricPhrase(text, m.index || 0, 'before');
    const suffix = localMetricPhrase(text, (m.index || 0) + String(m[0] || '').length, 'after');
    const hint = inferCurrencyLabel(prefix, suffix);
    push('currency_b', 'currency', hint, scaled);
  }

  for (const m of Array.from(text.matchAll(/\b(\d+(?:\.\d+)?)\s*(billion|million|thousand)\b/gi))) {
    const prefix = localMetricPhrase(text, m.index || 0, 'before');
    const suffix = localMetricPhrase(text, (m.index || 0) + String(m[0] || '').length, 'after');
    if (!hasCurrencySignal(prefix, suffix)) continue;
    const hint = inferCurrencyLabel(prefix, suffix);
    const base = Number(m[1]);
    const scale = String(m[2] || '').toLowerCase();
    const scaled =
      scale === 'billion' ? base
      : scale === 'million' ? base / 1000
      : base / 1000000;
    push('currency_b', 'currency', hint, scaled);
  }

  for (const m of Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s?%/g))) {
    const prefix = localMetricPhrase(text, m.index || 0, 'before');
    const suffix = localMetricPhrase(text, (m.index || 0) + String(m[0] || '').length, 'after');
    const hint = inferPercentLabel(prefix, suffix);
    push('percent', 'percent', hint, m[1]);
  }

  for (const point of extractAgeGroupCountSeries(text)) {
    push('age_group_count_m', 'count', point.label, point.value, { replaceByLabel: true });
  }

  for (const m of Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*(million|billion|thousand)\s+(?:among\s+)?((?:ages?\s+\d+\s*(?:to|-)\s*\d+)|(?:ages?\s+\d+\+)|(?:\d+\s+and older)|(?:seniors?\s+\d+\+))/gi))) {
    const base = Number(m[1]);
    const scale = String(m[2] || '').toLowerCase();
    const scaled =
      scale === 'million' ? base
      : scale === 'billion' ? base * 1000
      : base / 1000;
    const label = normalizeAgeGroupLabel(String(m[3] || ''));
    if (!label) continue;
    push('age_group_count_m', 'count', label, scaled, { replaceByLabel: true });
  }

  for (const m of Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*(million|billion|thousand)\s+([A-Za-z][A-Za-z0-9-]{2,})\b/gi))) {
    const base = Number(m[1]);
    const scale = String(m[2] || '').toLowerCase();
    const scaled =
      scale === 'million' ? base
      : scale === 'billion' ? base * 1000
      : base / 1000;
    const noun = String(m[3] || 'Items').replace(/s$/i, '');
    const prefix = localMetricPhrase(text, m.index || 0, 'before');
    const suffix = localMetricPhrase(text, (m.index || 0) + String(m[0] || '').length, 'after');
    if (hasCurrencySignal(prefix, suffix) || /\b(cost|expense|revenue|sales|income|profit|loss|budget|spend|spending|impact|value|price|gdp|funding|market|valuation|annual)\b/i.test(noun)) {
      continue;
    }
    const hint = inferCountLabel(prefix, noun);
    push('count_m', 'count', hint, scaled);
  }

  for (const m of Array.from(text.matchAll(/\b([A-Za-z][A-Za-z0-9/&()' -]{1,32})\s*[:=-]\s*(-?\d+(?:\.\d+)?)\b/g))) {
    const label = normalizeMetricLabel(String(m[1] || ''), 'Metric');
    if (/^(figure|value|metric|number)$/i.test(label)) continue;
    push('generic_pairs', 'generic', label, m[2]);
  }

  return Array.from(families.values()).map((family) => ({
    ...family,
    points: family.points.slice(0, 8),
  }));
}

function preferredMetricKinds(intentText: string): GroundedMetricFamilyKind[] {
  const intent = norm(intentText).toLowerCase();
  const kinds: GroundedMetricFamilyKind[] = [];
  if (/\b(economic|financial|spend|spending|impact|revenue|sales|cost)\b/.test(intent)) kinds.push('currency');
  if (/\b(participation|participants?|anglers?|americans?|people|users|population|audience|count|volume)\b/.test(intent)) {
    kinds.push('count', 'percent');
  }
  if (/\b(percent|percentage|share|rate|ratio|growth|decline|increase|decrease|conversion|retention)\b/.test(intent)) {
    kinds.push('percent');
  }
  if (/\b(q[1-4]|quarter|quarterly|trend|timeline|over time)\b/.test(intent)) kinds.push('quarter');
  return Array.from(new Set(kinds));
}

function familyQualityScore(family: GroundedMetricFamily): number {
  let score = family.points.length * 3;
  const labels = family.points.map((point) => norm(point.label).toLowerCase());
  const uniqueLabels = new Set(labels);
  if (uniqueLabels.size < family.points.length) score -= (family.points.length - uniqueLabels.size) * 2;
  for (const point of family.points) {
    const label = norm(point.label).toLowerCase();
    if (/^(metric|value|number)$/.test(label)) score -= 2;
    if (/(^|\s)percentage(\s|$)/.test(label) && !/\bshare|rate|participation|growth|conversion\b/.test(label)) score -= 2;
    if (!isMetricLabelUsable(label) && !/^q[1-4]$/.test(label)) score -= 4;
  }
  if (family.key === 'age_group_count_m' && family.points.length >= 3) score += 5;
  return score;
}

function selectGroundedDataPoints(
  paragraphText: string,
  windowText: string,
  intent: { title?: string; purpose?: string; description?: string }
): GroundedDataSeries | null {
  const localFamilies = buildGroundedMetricFamilies(paragraphText, paragraphText).filter((family) => family.points.length >= 2);
  const contextualFamilies = buildGroundedMetricFamilies(paragraphText, windowText).filter((family) => family.points.length >= 2);
  const families = localFamilies.length ? localFamilies : contextualFamilies;
  if (!families.length) return null;

  const intentText = norm(`${intent.title || ''} ${intent.purpose || ''} ${intent.description || ''}`);
  const preferredKinds = preferredMetricKinds(intentText);
  const pool = preferredKinds.length
    ? families.filter((family) => preferredKinds.includes(family.kind))
    : families;
  if (!pool.length) return null;

  const ranked = pool
    .map((family) => {
      let score = familyQualityScore(family);
      if (preferredKinds.includes(family.kind)) score += 6;
      if (family.kind === 'currency' && /\bimpact\b/i.test(intentText)) {
        score += family.points.some((point) => /\bimpact\b/i.test(point.label)) ? 3 : 0;
      }
      if (family.kind === 'count' && /\bparticipation|participants?|anglers?|americans?\b/i.test(intentText)) {
        score += family.points.some((point) => /\b(angler|participant|american|people|user)\b/i.test(point.label)) ? 3 : 0;
      }
      const series: GroundedDataSeries = { kind: family.kind, points: family.points.slice(0, 8) };
      score += seriesQualityScore(series);
      return { family, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best || best.score < 6) return null;
  const selected: GroundedDataSeries = {
    kind: best.family.kind,
    points: best.family.points.slice(0, 8),
  };
  if (!isSeriesAcceptable(selected)) return null;
  return selected;
}

function hasLocalChartSeries(
  anchor: AnchorStructuralInfo,
  intent: { title?: string; purpose?: string; description?: string }
): boolean {
  return Boolean(selectGroundedDataPoints(anchor.paragraph_text, anchor.paragraph_text, intent));
}

function hasLocalFlowchartEvidence(anchor: AnchorStructuralInfo): boolean {
  return extractSteps(anchor.paragraph_text).length >= 2 || validateTypeEligibility('flowchart', anchor.paragraph_text, anchor.paragraph_text).valid;
}

function describeGroundedDataSeries(series: GroundedDataSeries): { title: string; purpose: string } {
  const labels = series.points.map((point) => norm(point.label).toLowerCase());
  if (labels.every((label) => /^age \d{2}-\d{2}$/.test(label) || /^age \d{2}\+$/.test(label))) {
    return {
      title: 'Participation by Age Group',
      purpose: 'Compare participation counts across age groups extracted from the surrounding document text.',
    };
  }
  if (series.kind === 'currency') {
    return {
      title: 'Economic Impact Overview',
      purpose: 'Compare economic figures extracted from the surrounding document text.',
    };
  }
  if (series.kind === 'count') {
    return {
      title: 'Participation Overview',
      purpose: 'Compare participation-related counts extracted from the surrounding document text.',
    };
  }
  if (series.kind === 'percent') {
    return {
      title: 'Percentage Comparison',
      purpose: 'Compare percentage-based metrics extracted from the surrounding document text.',
    };
  }
  if (series.kind === 'quarter' || labels.every((label) => /^q[1-4]$/.test(label))) {
    return {
      title: 'Quarterly Trend',
      purpose: 'Show the quarter-by-quarter trend extracted from the surrounding document text.',
    };
  }
  return {
    title: 'Quantitative Comparison',
    purpose: 'Compare related quantitative values extracted from the surrounding document text.',
  };
}

function inferChartRole(series: GroundedDataSeries): PlannedVisualization['chart_role'] {
  const labels = series.points.map((point) => norm(point.label).toLowerCase());
  if (series.kind === 'quarter' || labels.every((label) => /^q[1-4]$/.test(label))) return 'trend';
  if (series.kind === 'percent') return 'composition';
  return 'comparison';
}

function applyChartRendererHints(planned: PlannedVisualization): void {
  const count = Array.isArray(planned.data_points) ? planned.data_points.length : 0;
  if (planned.type !== 'data_viz') return;
  planned.chart_family = 'default';
  planned.renderer_hint = 'echarts';
  if (planned.chart_role === 'comparison' && count >= 3 && count <= 7) {
    planned.chart_family = 'editorial_spotlight_bar';
    planned.renderer_hint = 'd3';
  }
}

function summarizeGroundedDataSeries(series: GroundedDataSeries): string {
  if (!series.points.length) return '';
  if (series.points.every((point) => /^Age /i.test(point.label))) {
    return series.points
      .map((point) => `${point.label}: ${point.value} million`)
      .join('; ');
  }
  return series.points
    .map((point) => `${point.label}: ${point.value}`)
    .join('; ');
}

function inferCountMeasureLabel(text: string): string {
  const t = norm(text).toLowerCase();
  if (!t) return 'Value';
  if (/\banglers?\b/.test(t)) return 'Anglers';
  if (/\bparticipants?\b/.test(t)) return 'Participants';
  if (/\bamericans?\b/.test(t)) return 'Americans';
  if (/\bpeople\b/.test(t)) return 'People';
  if (/\busers?\b/.test(t)) return 'Users';
  if (/\bpopulation\b/.test(t)) return 'Population';
  return 'Value';
}

function inferValueSuffix(series: GroundedDataSeries): '' | 'K' | 'M' | 'B' {
  // Root-cause fix: bind chart units to grounded series semantics, not broad prose windows.
  if (series.kind === 'currency') return 'B';
  if (series.kind === 'count') return 'M';
  return '';
}

function extractGroundedDataPoints(
  paragraphText: string,
  windowText: string,
  intent: { title?: string; purpose?: string; description?: string }
): Array<{ label: string; value: number }> {
  return selectGroundedDataPoints(paragraphText, windowText, intent)?.points || [];
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

function evidenceTextFromVisual(input: any): string {
  const spans = Array.isArray(input?.evidence_spans)
    ? input.evidence_spans
        .map((span: any) => norm(String(span || '')))
        .filter(Boolean)
    : [];
  return Array.from(new Set(spans)).join(' ');
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

type AnchorStructuralInfo = {
  anchor_id: string;
  paragraph_index: number;
  section: string;
  confidence: number;
  reason: string;
  is_heading: boolean;
  is_list: boolean;
  list_span_start: number;
  list_span_end: number;
  paragraph_length: number;
  signal_summary: string;
  is_scaffold: boolean;
  paragraph_text: string;
  window_text: string;
};

function isScaffoldText(text: string): boolean {
  const t = norm(text).toLowerCase();
  if (!t) return false;
  if (/\btpm\s*note\b/.test(t)) return true;
  if (/\b(aesthetic_anchor|sourced_image|data_viz|flowchart|infographic)\b/.test(t) && /\b(asset|trigger|mapping logic|primary target)\b/.test(t)) return true;
  return false;
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

  private buildAnchorStructuralInfo(input: {
    paragraphs: ParagraphNode[];
    sections: SectionNode[];
    anchors: AnchorCandidate[];
    contextWindows?: ContextWindow[];
  }): AnchorStructuralInfo[] {
    const infos: AnchorStructuralInfo[] = [];
    const windowByAnchor = new Map((input.contextWindows || []).map((w) => [String(w.anchor_id || ''), w]));
    for (const anchor of input.anchors || []) {
      const p = input.paragraphs[anchor.paragraph_index];
      if (!p) continue;
      const w = windowByAnchor.get(anchor.anchor_id);
      const text = norm(p.text || '');
      const heading = /^(introduction|overview|summary|section\b|chapter\b|part\b)/i.test(text) && text.length <= 140;
      const listLike = Boolean(p.has_sequence) || /\b(step\s+\d+|\d+\.\s+[A-Z]|^\-\s+)/i.test(text);
      // Evaluate scaffold-ness from the anchor paragraph itself. Using the full
      // context window can incorrectly mark nearby real anchors as scaffold.
      const scaffold = isScaffoldText(text);
      infos.push({
        anchor_id: String(anchor.anchor_id || ''),
        paragraph_index: Number(anchor.paragraph_index || 0),
        section: sectionForIndex(input.sections, anchor.paragraph_index),
        confidence: Number(anchor.confidence || 0),
        reason: String(anchor.reason || ''),
        is_heading: heading,
        is_list: listLike,
        list_span_start: Number(w?.paragraph_start_index ?? anchor.paragraph_index),
        list_span_end: Number(w?.paragraph_end_index ?? anchor.paragraph_index),
        paragraph_length: text.length,
        signal_summary: [p.has_sequence ? 'sequence' : '', p.has_data ? 'data' : '', p.has_entity ? 'entity' : '', scaffold ? 'scaffold' : '']
          .filter(Boolean)
          .join(',') || 'text',
        is_scaffold: scaffold,
        paragraph_text: text,
        window_text: norm(w?.content || text),
      });
    }
    return infos;
  }

  private scoreAnchorForType(type: PlannedVisualization['type'], info: AnchorStructuralInfo): number {
    const text = norm(`${info.paragraph_text || ''} ${info.window_text || ''}`);
    const sig = String(info.signal_summary || '').toLowerCase();
    const seq = proceduralScore(text);
    const dat = dataScore(text);
    const atm = atmosphericScore(text);
    let score = Number(info.confidence || 0);
    if (info.is_scaffold) score -= 8;
    if (type === 'flowchart') {
      score += seq * 2;
      if (sig.includes('sequence')) score += 2;
      if (info.is_list) score += 1;
      return score;
    }
    if (type === 'data_viz') {
      score += dat * 2;
      if (sig.includes('data')) score += 3;
      if (/\b(q[1-4]|units per hour|percent|ratio|trend|kpi|metric)\b/i.test(text)) score += 4;
      if (seq > 0) score -= 1;
      return score;
    }
    if (type === 'sourced_image' || type === 'aesthetic_anchor') {
      score += atm * 2;
      if (sig.includes('sequence')) score -= 2;
      if (/\b(step\s+\d+|process|workflow|procedure)\b/i.test(text)) score -= 2;
      if (/\b(atmospheric|scene|workshop|glow|light|smoke|sawdust|forest|mood)\b/i.test(text)) score += 3;
      return score;
    }
    return score + Math.max(seq, dat, atm) * 0.25;
  }

  private findBestAnchorForType(
    type: PlannedVisualization['type'],
    current: AnchorStructuralInfo,
    all: AnchorStructuralInfo[],
  ): AnchorStructuralInfo {
    if (!Array.isArray(all) || !all.length) return current;
    const sameSection = all.filter((a) => a.section === current.section);
    const pool = sameSection.length ? sameSection : all;
    const ranked = pool
      .map((a) => {
        const distancePenalty = Math.min(2.5, Math.abs(Number(a.paragraph_index || 0) - Number(current.paragraph_index || 0)) * 0.08);
        return { a, s: this.scoreAnchorForType(type, a) - distancePenalty };
      })
      .sort((x, y) => y.s - x.s);
    // Keep local context stable for overview-style visuals unless there is a clear better anchor.
    if (type === 'infographic') {
      const currentScore = this.scoreAnchorForType(type, current);
      const bestScore = Number(ranked[0]?.s || currentScore);
      if (bestScore - currentScore < 0.4) return current;
    }
    if (type === 'data_viz' || type === 'flowchart') {
      const currentScore = this.scoreAnchorForType(type, current);
      const bestScore = Number(ranked[0]?.s || currentScore);
      if (bestScore - currentScore < 1.25) return current;
    }
    return ranked[0]?.a || current;
  }

  private normalizePlacementScope(
    requested: any,
    anchorInfo: AnchorStructuralInfo,
  ): { scope: PlacementScope; reasons: string[] } {
    const reasons: string[] = [];
    const allowed: PlacementScope[] = ['after_anchor', 'after_list_block', 'section_intro_body', 'section_end'];
    const dslScope = parsePlacementDslToken(requested);
    if (dslScope && dslScope !== String(requested).trim().toLowerCase()) {
      reasons.push('placement_dsl_token_normalized');
    }
    let scope = dslScope && allowed.includes(dslScope) ? dslScope : 'after_anchor';
    if (!dslScope || !allowed.includes(dslScope)) {
      reasons.push('invalid_scope_defaulted_after_anchor');
    }
    if (scope === 'after_anchor' && anchorInfo.is_heading) {
      scope = 'section_intro_body';
      reasons.push('after_anchor_on_heading_rewritten');
    }
    if (scope === 'after_anchor' && anchorInfo.is_list) {
      scope = 'after_list_block';
      reasons.push('after_anchor_on_list_rewritten');
    }
    return { scope, reasons };
  }

  async buildManifest(input: {
    jobId: string;
    title: string;
    paragraphs: ParagraphNode[];
    sections: SectionNode[];
    anchors: AnchorCandidate[];
    contextWindows?: ContextWindow[];
    maxAssets?: number;
    onTelemetry?: (event: PlannerTelemetryEvent) => void;
  }): Promise<DocumentVisualManifest> {
    const captionMaxChars = Math.max(100, Math.min(260, Number(process.env.DOCX_CAPTION_MAX_CHARS || 180)));
    const maxAssets = Math.max(1, Number(input.maxAssets || process.env.DOC_MAX_ASSETS || 20));
    const deterministic = await this.buildManifestDeterministic(input, maxAssets, captionMaxChars);
    const useLlm = String(process.env.DOC_PLANNING_USE_LLM || 'true').toLowerCase() === 'true';
    if (!useLlm || !this.openai) {
      input.onTelemetry?.({
        type: 'planner_mode',
        mode: 'deterministic',
        reason: !useLlm ? 'DOC_PLANNING_USE_LLM=false' : 'OPENROUTER_API_KEY missing'
      });
      return deterministic;
    }
    input.onTelemetry?.({ type: 'planner_mode', mode: 'llm' });

    try {
      const llmVisuals = await this.planVisualsWithLlm(input, maxAssets, captionMaxChars, input.onTelemetry);
      if (!llmVisuals.length) return deterministic;
      const deterministicVisuals = deterministic.lessons[0]?.visualizations || [];
      const llmHasFlowchart = llmVisuals.some((v) => v.type === 'flowchart');
      const supplementalVisuals = !llmHasFlowchart
        ? deterministicVisuals.filter((v) => v.type === 'flowchart').slice(0, 1)
        : [];
      const mergedVisuals = [...llmVisuals];
      for (const candidate of supplementalVisuals) {
        const alreadyPresent = mergedVisuals.some((v) =>
          v.type === candidate.type
          && String(v.anchor_id || '') === String(candidate.anchor_id || '')
        );
        if (!alreadyPresent) mergedVisuals.push(candidate);
      }
      const cappedVisuals = this.applyAnchorDensityCap(llmVisuals, input.anchors, input.sections);
      const manifest: DocumentVisualManifest = {
        ...deterministic,
        lessons: [{
          ...deterministic.lessons[0],
          visualizations: this.applyAnchorDensityCap(mergedVisuals.slice(0, maxAssets), input.anchors, input.sections)
        }]
      };
      return manifest;
    } catch (error: any) {
      this.logger.warn(`LLM doc planning failed, using deterministic fallback: ${error?.message || error}`);
      return deterministic;
    }
  }

  private async buildManifestDeterministic(input: {
    jobId: string;
    title: string;
    paragraphs: ParagraphNode[];
    sections: SectionNode[];
    anchors: AnchorCandidate[];
    contextWindows?: ContextWindow[];
  }, maxAssets: number, captionMaxChars: number): Promise<DocumentVisualManifest> {
    const seen = new Set<string>();
    const seenDataSeries = new Set<string>();
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
      const requestedType = chooseType(paragraphText, windowText, p);
      const eligibility = validateTypeEligibility(requestedType, paragraphText, windowText);
      const type = eligibility.valid ? requestedType : remapIneligibleType(requestedType, paragraphText, windowText);
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
      const planned: PlannedVisualization = {
        type,
        anchor_id: anchor.anchor_id,
        placement: defaultPlacementForType(type),
        title: titleFromText(text),
        description: text.slice(0, 500),
        context: `Anchor ${anchor.anchor_id} in section "${sectionForIndex(input.sections, anchor.paragraph_index)}"`,
        purpose: 'Visually reinforce the surrounding document concept.',
        prompt_template: promptTemplateFor(type, text),
      };
      if (planned.type === 'data_viz') {
        const series = selectGroundedDataPoints(paragraphText, windowText, {
          title: planned.title,
          purpose: planned.purpose,
          description: planned.description,
        });
        if (series && series.points.length >= 2) {
          planned.data_points = series.points;
          const seriesSummary = describeGroundedDataSeries(series);
          planned.title = seriesSummary.title;
          planned.purpose = seriesSummary.purpose;
          planned.value_format = series.kind === 'percent' ? 'percent' : 'count';
          planned.value_suffix = inferValueSuffix(series);
          if (planned.value_format === 'percent') {
            planned.y_axis_label = 'Percent (%)';
          } else {
            const measure = inferCountMeasureLabel(`${paragraphText} ${windowText}`);
            planned.y_axis_label = planned.value_suffix ? `${measure} (${planned.value_suffix})` : measure;
          }
          planned.chart_role = inferChartRole(series);
          const summaryText = summarizeGroundedDataSeries(series);
          if (summaryText) {
            planned.description = summaryText;
            planned.prompt_template = promptTemplateFor('data_viz', summaryText);
          }
          applyChartRendererHints(planned);
        } else {
          planned.type = 'infographic';
          planned.placement = defaultPlacementForType('infographic');
          planned.prompt_template = promptTemplateFor('infographic', text);
          planned.fallback_reason = 'data_viz_requires_two_comparable_points';
        }
      }
      if (!eligibility.valid && type !== requestedType) {
        planned.fallback_reason = `eligibility_remap:${requestedType}->${type}:${eligibility.reason}`;
      }
      if (type === 'flowchart') {
        const mermaidResult = await this.resolveMermaidWithRetries(text);
        if (mermaidResult.valid && mermaidResult.code) {
          planned.mermaid_code = mermaidResult.code;
          planned.mermaid_valid = true;
        } else {
          planned.type = 'aesthetic_anchor';
          planned.placement = defaultPlacementForType('aesthetic_anchor');
          planned.prompt_template = atmosphericPromptForFallback(text);
          planned.fallback_reason = 'mermaid_validation_failed_after_double_retry';
          planned.mermaid_valid = false;
        }
      } else if (type === 'data_viz' && !dataVizLooksValid(text)) {
        planned.type = 'aesthetic_anchor';
        planned.placement = defaultPlacementForType('aesthetic_anchor');
        planned.prompt_template = atmosphericPromptForFallback(text);
        planned.fallback_reason = 'data_viz_validation_failed';
      }
      const caption = resolveCaption({
        type: planned.type,
        title: planned.title,
        purpose: planned.purpose,
        context: planned.context,
        maxChars: captionMaxChars,
      });
      planned.caption_text = caption.caption_text;
      planned.caption_mode = caption.caption_mode;
      if (planned.type === 'data_viz' && Array.isArray(planned.data_points) && planned.data_points.length >= 2) {
        const seriesFingerprint = planned.data_points
          .map((point) => `${norm(point.label).toLowerCase()}:${Number(point.value)}`)
          .join('|');
        if (seriesFingerprint && seenDataSeries.has(seriesFingerprint)) {
          continue;
        }
        if (seriesFingerprint) seenDataSeries.add(seriesFingerprint);
      }
      const finalType = planned.type;
      const finalRanges = usedRangesByType.get(finalType) || [];
      if (finalRanges.some((r) => rangeOverlapRatio(r, range) >= 0.6)) continue;
      finalRanges.push(range);
      usedRangesByType.set(finalType, finalRanges);
      visuals.push(planned);
      if (visuals.length >= maxAssets) break;
    }

    const cappedVisuals = this.applyAnchorDensityCap(visuals, input.anchors, input.sections);

    const manifest: DocumentVisualManifest = {
      course: {
        title: norm(input.title) || 'Document Visualization Plan',
        targetAudience: 'Document readers'
      },
      lessons: [
        {
          lessonId: `doc-${input.jobId}`,
          title: 'Document Visual Plan',
          visualizations: cappedVisuals.length ? cappedVisuals : [{
            type: 'infographic',
            anchor_id: input.anchors[0]?.anchor_id || 'fallback-anchor',
            placement: defaultPlacementForType('infographic'),
            title: 'Overview',
            description: 'Visual summary of the document.',
            context: 'Fallback planning mode',
            purpose: 'Provide at least one visual anchor.',
            caption_text: 'Figure: Overview visual for the surrounding section context.',
            caption_mode: 'auto'
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
  }, maxAssets: number, captionMaxChars: number, onTelemetry?: (event: PlannerTelemetryEvent) => void): Promise<PlannedVisualization[]> {
    if (!this.openai) return [];
    const windowsByAnchor = new Map((input.contextWindows || []).map((w) => [String(w.anchor_id || ''), w]));
    const structural = this.buildAnchorStructuralInfo(input);
    const structuralById = new Map(structural.map((s) => [s.anchor_id, s]));
    const candidates = input.anchors.slice(0, Math.max(maxAssets * 3, 12)).map((a) => {
      const p = input.paragraphs[a.paragraph_index];
      const w = windowsByAnchor.get(a.anchor_id);
      const text = norm((w?.content || p?.text || '').slice(0, 1200));
      const meta = structuralById.get(a.anchor_id);
      return {
        anchor_id: a.anchor_id,
        section: sectionForIndex(input.sections, a.paragraph_index),
        paragraph_index: a.paragraph_index,
        confidence: a.confidence,
        reason: a.reason,
        text,
        is_heading: Boolean(meta?.is_heading),
        is_list: Boolean(meta?.is_list),
        list_span_start: Number(meta?.list_span_start ?? a.paragraph_index),
        list_span_end: Number(meta?.list_span_end ?? a.paragraph_index),
        paragraph_length: Number(meta?.paragraph_length ?? text.length),
        signal_summary: String(meta?.signal_summary || ''),
        is_scaffold: Boolean(meta?.is_scaffold),
      };
    }).filter((c) => c.text.length > 0 && !c.is_scaffold);

    const systemPrompt = [
      'You are a document visualization planner.',
      'Return JSON only (no markdown).',
      `Plan up to ${maxAssets} visuals from anchor candidates.`,
      'Use types: infographic | sourced_image | data_viz | flowchart | aesthetic_anchor.',
      'Each visualization must include an evidence_spans array with short quoted phrases from the candidate text that justify the chosen type.',
      'Prefer data_viz for numeric/trend content; flowchart for procedural steps; sourced_image for scene context.',
      'Choose data_viz only when the source supports at least two comparable values for one chart.',
      'Never combine mixed units in one chart. Do not mix dollars, percentages, counts, or unrelated metrics in a single data_viz.',
      'If the text has isolated numbers but no coherent chart series, choose infographic instead of data_viz.',
      'For data_viz, make the title and purpose match exactly one metric family.',
      'For data_viz, include chart_role using one of: comparison | trend | composition | spotlight | distribution.',
      'Placement scope must use one of: [AFTER_ANCHOR] | [AFTER_LIST_BLOCK] | [SECTION_INTRO_BODY] | [SECTION_END].',
      'Output shape: {"visualizations":[{"type":"...","anchor_id":"...","placement":{"scope":"[AFTER_ANCHOR]|[AFTER_LIST_BLOCK]|[SECTION_INTRO_BODY]|[SECTION_END]","priority":1-100,"avoid_headings":true|false,"avoid_list_split":true|false,"max_width_in":number,"max_height_in":number,"alignment":"center|left"},"title":"...","description":"...","context":"...","purpose":"...","caption_text":"optional short caption","evidence_spans":["..."],"chart_role":"comparison|trend|composition|spotlight|distribution"}]}',
      'Use anchor_id values from the provided candidates when possible.'
    ].join('\n');

    const userPrompt = JSON.stringify({
      doc_title: input.title,
      job_id: input.jobId,
      max_assets: maxAssets,
      anchors: candidates,
    });

    const model = String(process.env.DOC_PLANNING_MODEL || process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001').trim();
    onTelemetry?.({
      type: 'llm_request',
      model,
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
      candidate_count: candidates.length,
      max_assets: maxAssets,
    });

    const startedAt = Date.now();
    let completion: any;
    let raw = '';
    let cleaned = '';
    let parsed: any = {};
    try {
      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: userPrompt }
      ];
      try {
        completion = await this.openai.chat.completions.create({
          model,
          response_format: { type: 'json_object' as const },
          messages,
          max_tokens: 1800,
          temperature: 0.1
        });
      } catch (jsonModeError: any) {
        const msg = String(jsonModeError?.message || '').toLowerCase();
        const jsonModeUnsupported =
          msg.includes('response_format') ||
          msg.includes('json_object') ||
          msg.includes('unsupported') ||
          msg.includes('invalid parameter');
        if (!jsonModeUnsupported) throw jsonModeError;
        completion = await this.openai.chat.completions.create({
          model,
          response_format: { type: 'text' },
          messages,
          max_tokens: 1800,
          temperature: 0.1
        });
      }
      raw = String(completion?.choices?.[0]?.message?.content || '').trim();
      cleaned = stripCodeFences(raw);
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const balanced = extractFirstBalancedJsonObject(cleaned);
        const repaired = repairPossiblyTruncatedJson(balanced || cleaned);
        cleaned = repaired || cleaned;
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          const llmRepaired = await this.repairPlanningJsonWithLlm(cleaned, model);
          if (!llmRepaired) throw new Error('LLM planning JSON repair failed');
          cleaned = llmRepaired;
          parsed = JSON.parse(cleaned);
        }
      }
    } catch (error: any) {
      onTelemetry?.({
        type: 'llm_error',
        model,
        error_message: String(error?.message || error || 'Unknown LLM planning error')
      });
      throw error;
    }
    const inVisuals = Array.isArray(parsed?.visualizations) ? parsed.visualizations : [];
    const seen = new Set<string>();
    const seenDataSeries = new Set<string>();
    const visuals: PlannedVisualization[] = [];
    const placementNormalization: Array<{
      index: number;
      requested_anchor_id: string | null;
      resolved_anchor_id: string;
      requested_scope: string | null;
      resolved_scope: PlacementScope;
      reasons: string[];
    }> = [];
    const sectionCounts = new Map<string, number>();
    for (const v of inVisuals) {
      if (visuals.length >= maxAssets) break;
      let text = norm(String(v?.description || v?.title || '').slice(0, 2000));
      const fingerprint = text.toLowerCase().replace(/[^a-z0-9 ]/g, '');
      if (!fingerprint || seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      const typeCandidate = String(v?.type || '').trim() as PlannedVisualization['type'];
      const mappedType = ['infographic', 'sourced_image', 'data_viz', 'flowchart', 'aesthetic_anchor'].includes(typeCandidate)
        ? typeCandidate
        : pickType(text);
      const requestedAnchorId = norm(String((v as any)?.anchor_id || ''));
      const baseAnchorId = requestedAnchorId && structuralById.has(requestedAnchorId)
        ? requestedAnchorId
        : (input.anchors[0]?.anchor_id || '');
      const baseAnchorInfo = structuralById.get(baseAnchorId) || structural[0];
      if (!baseAnchorInfo) continue;
      const keepBaseAnchor =
        (mappedType === 'data_viz' && hasLocalChartSeries(baseAnchorInfo, {
          title: String(v?.title || ''),
          purpose: String(v?.purpose || ''),
          description: text,
        }))
        || (mappedType === 'flowchart' && hasLocalFlowchartEvidence(baseAnchorInfo));
      const typeAlignedAnchor = keepBaseAnchor
        ? baseAnchorInfo
        : this.findBestAnchorForType(mappedType, baseAnchorInfo, structural);
      const fallbackText = buildTextForType(mappedType, typeAlignedAnchor.paragraph_text, typeAlignedAnchor.window_text);
      if (isWeakConceptText(text)) {
        text = fallbackText;
      }
      const eligibility = validateTypeEligibility(mappedType, typeAlignedAnchor.paragraph_text, typeAlignedAnchor.window_text);
      const resolvedType = eligibility.valid
        ? mappedType
        : remapIneligibleType(mappedType, typeAlignedAnchor.paragraph_text, typeAlignedAnchor.window_text);
      if (isWeakConceptText(text)) {
        text = buildTextForType(resolvedType, typeAlignedAnchor.paragraph_text, typeAlignedAnchor.window_text);
      }
      const requestedScope = norm(String((v as any)?.placement?.scope || ''));
      const scopeNormalized = this.normalizePlacementScope(requestedScope, typeAlignedAnchor);
      const defaultPlacement = defaultPlacementForType(resolvedType);
      const placement: PlannedVisualizationPlacement = {
        scope: scopeNormalized.scope,
        priority: clampPriority((v as any)?.placement?.priority, defaultPlacement.priority),
        avoid_headings: typeof (v as any)?.placement?.avoid_headings === 'boolean'
          ? Boolean((v as any)?.placement?.avoid_headings)
          : defaultPlacement.avoid_headings,
        avoid_list_split: typeof (v as any)?.placement?.avoid_list_split === 'boolean'
          ? Boolean((v as any)?.placement?.avoid_list_split)
          : defaultPlacement.avoid_list_split,
        max_width_in: Number.isFinite(Number((v as any)?.placement?.max_width_in))
          ? Number((v as any)?.placement?.max_width_in)
          : defaultPlacement.max_width_in,
        max_height_in: Number.isFinite(Number((v as any)?.placement?.max_height_in))
          ? Number((v as any)?.placement?.max_height_in)
          : defaultPlacement.max_height_in,
        alignment: ['left', 'center'].includes(String((v as any)?.placement?.alignment || '').toLowerCase())
          ? (String((v as any)?.placement?.alignment || '').toLowerCase() as 'left' | 'center')
          : (defaultPlacement.alignment || 'center'),
      };
      if (resolvedType === 'sourced_image' && /\b(step\s+\d+|process|workflow|procedure)\b/i.test(typeAlignedAnchor.window_text || '')) {
        placement.scope = 'section_end';
      }
      const sectionCount = sectionCounts.get(typeAlignedAnchor.section) || 0;
      if (sectionCount >= 3) {
        continue;
      }
      const planned: PlannedVisualization = {
        type: resolvedType,
        anchor_id: typeAlignedAnchor.anchor_id,
        placement,
        title: titleFromText(norm(v?.title || text)),
        description: text || 'Contextual visual planned from document anchors.',
        context: `Anchor ${typeAlignedAnchor.anchor_id} in section "${typeAlignedAnchor.section}"`,
        purpose: norm(v?.purpose || 'Visually reinforce the surrounding document concept.'),
        prompt_template: promptTemplateFor(resolvedType, text),
        evidence_spans: Array.isArray((v as any)?.evidence_spans)
          ? (v as any).evidence_spans.map((span: any) => norm(String(span || ''))).filter(Boolean).slice(0, 8)
          : undefined,
        chart_role: ['comparison', 'trend', 'composition', 'spotlight', 'distribution'].includes(String((v as any)?.chart_role || ''))
          ? (String((v as any).chart_role) as any)
          : undefined,
      };
      if (resolvedType === 'data_viz') {
        const evidenceText = evidenceTextFromVisual(v);
        const dataParagraph = typeAlignedAnchor.paragraph_text;
        const dataWindow = typeAlignedAnchor.window_text;
        const quantitativeText = buildDataVizText(dataParagraph, dataWindow);
        const series = selectGroundedDataPoints(dataParagraph, dataWindow, {
          title: planned.title,
          purpose: planned.purpose,
          description: planned.description,
        });
        if (quantitativeText) {
          text = quantitativeText;
          planned.description = quantitativeText.slice(0, 500);
          planned.prompt_template = promptTemplateFor('data_viz', quantitativeText);
        }
        if (series && series.points.length >= 2) {
          planned.data_points = series.points;
          const seriesSummary = describeGroundedDataSeries(series);
          planned.title = seriesSummary.title;
          planned.purpose = seriesSummary.purpose;
          planned.value_format = series.kind === 'percent' ? 'percent' : 'count';
          planned.value_suffix = inferValueSuffix(series);
          if (planned.value_format === 'percent') {
            planned.y_axis_label = 'Percent (%)';
          } else {
            const measure = inferCountMeasureLabel(`${dataParagraph} ${dataWindow}`);
            planned.y_axis_label = planned.value_suffix ? `${measure} (${planned.value_suffix})` : measure;
          }
          planned.chart_role = planned.chart_role || inferChartRole(series);
          const summaryText = summarizeGroundedDataSeries(series);
          if (summaryText) {
            planned.description = summaryText;
            planned.prompt_template = promptTemplateFor('data_viz', summaryText);
          }
          if (evidenceText) {
            const excerpt = evidenceText.split(/\s+/).slice(0, 24).join(' ');
            if (excerpt) planned.context = `${planned.context}; evidence: ${excerpt}`;
          }
          applyChartRendererHints(planned);
        } else {
          planned.type = 'infographic';
          planned.placement = defaultPlacementForType('infographic');
          planned.prompt_template = promptTemplateFor('infographic', text);
          planned.fallback_reason = 'data_viz_requires_two_comparable_points';
        }
      }
      if (!eligibility.valid && resolvedType !== mappedType) {
        planned.fallback_reason = `eligibility_remap:${mappedType}->${resolvedType}:${eligibility.reason}`;
      }
      if (planned.type === 'flowchart') {
        const mermaidResult = await this.resolveMermaidWithRetries(text);
        if (mermaidResult.valid && mermaidResult.code) {
          planned.mermaid_code = mermaidResult.code;
          planned.mermaid_valid = true;
        } else {
          planned.type = 'aesthetic_anchor';
          planned.placement = defaultPlacementForType('aesthetic_anchor');
          planned.prompt_template = atmosphericPromptForFallback(text);
          planned.fallback_reason = 'mermaid_validation_failed_after_double_retry';
          planned.mermaid_valid = false;
        }
      } else if (planned.type === 'data_viz' && !dataVizLooksValid(text)) {
        planned.type = 'aesthetic_anchor';
        planned.placement = defaultPlacementForType('aesthetic_anchor');
        planned.prompt_template = atmosphericPromptForFallback(text);
        planned.fallback_reason = 'data_viz_validation_failed';
      }
      const caption = resolveCaption({
        type: planned.type,
        title: planned.title,
        purpose: planned.purpose,
        context: planned.context,
        explicitCaption: (v as any)?.caption_text,
        maxChars: captionMaxChars,
      });
      planned.caption_text = caption.caption_text;
      planned.caption_mode = caption.caption_mode;
      if (planned.type === 'data_viz' && Array.isArray(planned.data_points) && planned.data_points.length >= 2) {
        const seriesFingerprint = [
          planned.anchor_id,
          planned.data_points.map((point) => `${norm(point.label).toLowerCase()}:${Number(point.value)}`).join('|'),
        ].join('::');
        if (seenDataSeries.has(seriesFingerprint)) {
          continue;
        }
        seenDataSeries.add(seriesFingerprint);
      }
      sectionCounts.set(typeAlignedAnchor.section, sectionCount + 1);
      const reasons = [...scopeNormalized.reasons];
      if (typeAlignedAnchor.anchor_id !== baseAnchorInfo.anchor_id) {
        reasons.push('type_anchor_realigned');
      }
      if (!eligibility.valid && resolvedType !== mappedType) {
        reasons.push(`type_remap:${mappedType}->${resolvedType}`);
      }
      placementNormalization.push({
        index: visuals.length,
        requested_anchor_id: requestedAnchorId || null,
        resolved_anchor_id: planned.anchor_id,
        requested_scope: requestedScope || null,
        resolved_scope: planned.placement.scope,
        reasons,
      });
      visuals.push(planned);
    }
    const normalizedVisuals = this.applyAnchorDensityCap(visuals, input.anchors, input.sections);
    onTelemetry?.({
      type: 'llm_response',
      model,
      raw_response: raw,
      cleaned_response: cleaned,
      usage: {
        prompt_tokens: Number.isFinite(Number(completion?.usage?.prompt_tokens)) ? Number(completion?.usage?.prompt_tokens) : null,
        completion_tokens: Number.isFinite(Number(completion?.usage?.completion_tokens)) ? Number(completion?.usage?.completion_tokens) : null,
        total_tokens: Number.isFinite(Number(completion?.usage?.total_tokens)) ? Number(completion?.usage?.total_tokens) : null,
      },
      duration_ms: Date.now() - startedAt,
      parsed_visual_count: inVisuals.length,
      normalized_visual_count: normalizedVisuals.length,
      placement_normalization: placementNormalization,
    });
    return normalizedVisuals;
  }

  private async repairPlanningJsonWithLlm(rawJsonLike: string, model: string): Promise<string | null> {
    if (!this.openai) return null;
    const repairPrompt = [
      'You repair malformed JSON into valid strict JSON.',
      'Return only one JSON object.',
      'Required top-level shape: {"visualizations":[...]}',
      'If content is unusable, return {"visualizations":[]}.',
      '',
      'Malformed input:',
      String(rawJsonLike || '').slice(0, 12000),
    ].join('\n');
    try {
      const completion = await this.openai.chat.completions.create({
        model,
        response_format: { type: 'json_object' as const },
        messages: [
          { role: 'system', content: 'Return strict JSON only.' },
          { role: 'user', content: repairPrompt },
        ],
        temperature: 0,
        max_tokens: 1800,
      });
      const raw = String(completion?.choices?.[0]?.message?.content || '').trim();
      const cleaned = stripCodeFences(raw);
      JSON.parse(cleaned);
      return cleaned;
    } catch (error) {
      this.logger.warn(`Planning JSON repair call failed: ${String((error as any)?.message || error)}`);
      return null;
    }
  }

  private async resolveMermaidWithRetries(text: string): Promise<{ code: string | null; valid: boolean }> {
    let candidate = toMermaidFlowchart(text);
    let lastError = getMermaidValidationError(candidate);
    if (isMermaidValid(candidate)) return { code: candidate, valid: true };

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const ruleBased = selfCorrectMermaid(candidate);
      if (isMermaidValid(ruleBased)) return { code: ruleBased, valid: true };
      const ruleErr = getMermaidValidationError(ruleBased);
      candidate = ruleBased;
      lastError = ruleErr;
      const llmFixed = await this.repairMermaidWithLlm(candidate, text, ruleErr, attempt);
      if (llmFixed) {
        const normalized = selfCorrectMermaid(llmFixed);
        if (isMermaidValid(normalized)) return { code: normalized, valid: true };
        candidate = normalized;
        lastError = getMermaidValidationError(normalized);
      }
    }

    this.logger.warn(`Mermaid validation failed after 2 retries: ${lastError}`);
    return { code: null, valid: false };
  }

  private async repairMermaidWithLlm(code: string, sourceText: string, validationError: string, attempt: number): Promise<string | null> {
    if (!this.openai) return null;
    const model = String(process.env.DOC_PLANNING_MODEL || process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001').trim();
    const systemPrompt = [
      'You are a Mermaid flowchart syntax repair assistant.',
      'Return Mermaid code only. No markdown fences.',
      'Preserve flowchart semantics and keep all labels concise.',
      `Validation error to fix: ${validationError}`,
      `Retry pass: ${attempt} of 2`,
    ].join('\n');
    const userPrompt = [
      'Source procedural text:',
      sourceText,
      '',
      'Invalid Mermaid code:',
      code,
      '',
      'Return corrected Mermaid flowchart code only.'
    ].join('\n');
    try {
      const completion = await this.openai.chat.completions.create({
        model,
        response_format: { type: 'text' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0,
        max_tokens: 800,
      });
      const raw = String(completion?.choices?.[0]?.message?.content || '').trim();
      return raw.replace(/```mermaid/gi, '').replace(/```/g, '').trim();
    } catch (error: any) {
      this.logger.warn(`Mermaid repair LLM call failed: ${error?.message || error}`);
      return null;
    }
  }

  private applyAnchorDensityCap(
    visuals: PlannedVisualization[],
    anchors: AnchorCandidate[],
    sections: SectionNode[]
  ): PlannedVisualization[] {
    if (!visuals.length || !anchors.length) return visuals;
    const capPerAnchor = 2;
    const emergencySectionCap = 3;
    const anchorMeta = anchors.map((a) => ({
      anchor_id: String(a.anchor_id || ''),
      paragraph_index: Number(a.paragraph_index || 0),
      confidence: Number(a.confidence || 0),
      section: sectionForIndex(sections, Number(a.paragraph_index || 0)),
    })).filter((a) => a.anchor_id);
    const byId = new Map(anchorMeta.map((a) => [a.anchor_id, a]));
    const counts = new Map<string, number>();
    const sectionCounts = new Map<string, number>();

    const pickAnchor = (seedId: string | null, sectionHint: string | null): string => {
      const seed = seedId && byId.has(seedId) ? byId.get(seedId)! : null;
      const targetPool = anchorMeta.filter((a) => {
        const anchorCount = counts.get(a.anchor_id) || 0;
        const sectionCount = sectionCounts.get(a.section) || 0;
        return anchorCount < capPerAnchor && sectionCount < emergencySectionCap;
      });
      const pool = targetPool.length ? targetPool : anchorMeta;
      const scored = pool
        .filter((a) => !sectionHint || norm(a.section).toLowerCase() === sectionHint.toLowerCase())
        .sort((a, b) => {
          const da = seed ? Math.abs(a.paragraph_index - seed.paragraph_index) : 0;
          const db = seed ? Math.abs(b.paragraph_index - seed.paragraph_index) : 0;
          if (da !== db) return da - db;
          if (b.confidence !== a.confidence) return b.confidence - a.confidence;
          return (counts.get(a.anchor_id) || 0) - (counts.get(b.anchor_id) || 0);
        });
      const chosen = (scored[0] || pool[0] || anchorMeta[0]).anchor_id;
      counts.set(chosen, (counts.get(chosen) || 0) + 1);
      const chosenSection = byId.get(chosen)?.section || 'Document Context';
      sectionCounts.set(chosenSection, (sectionCounts.get(chosenSection) || 0) + 1);
      return chosen;
    };

    return visuals.map((v) => {
      const sectionHint = byId.get(String(v.anchor_id || ''))?.section || null;
      const proposedId = byId.has(String(v.anchor_id || '')) ? String(v.anchor_id) : null;
      const assigned = pickAnchor(proposedId, sectionHint);
      const resolvedSection = byId.get(assigned)?.section || sectionHint || 'Document Context';
      return {
        ...v,
        anchor_id: assigned,
        context: `Anchor ${assigned} in section "${resolvedSection}"`,
      };
    });
  }

  validateManifest(manifest: DocumentVisualManifest, opts?: { anchors?: AnchorCandidate[] }): ManifestValidationResult {
    return validateDocumentVisualManifest(manifest, {
      anchorIds: (opts?.anchors || []).map((a) => String(a?.anchor_id || '')).filter(Boolean),
    });
  }
}
