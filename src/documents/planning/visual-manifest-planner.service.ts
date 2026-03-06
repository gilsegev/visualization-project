import { AnchorCandidate, ParagraphNode, SectionNode } from '../analysis/document-analysis.types';
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
  const nodes = steps.map((step, i) => `S${i + 1}[${step.replace(/[\[\]]/g, '')}]`);
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

export class VisualManifestPlannerService {
  buildManifest(input: {
    jobId: string;
    title: string;
    paragraphs: ParagraphNode[];
    sections: SectionNode[];
    anchors: AnchorCandidate[];
    maxAssets?: number;
  }): DocumentVisualManifest {
    const maxAssets = Math.max(1, Number(input.maxAssets || process.env.DOC_MAX_ASSETS || 20));
    const seen = new Set<string>();
    const visuals: PlannedVisualization[] = [];
    for (const anchor of input.anchors) {
      const p = input.paragraphs[anchor.paragraph_index];
      if (!p) continue;
      const text = norm(p.text);
      const fingerprint = text.toLowerCase().replace(/[^a-z0-9 ]/g, '');
      if (!fingerprint || seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      const type = pickType(text, p);
      const planned: PlannedVisualization = {
        type,
        title: titleFromText(text),
        description: text.slice(0, 600),
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

  validateManifest(manifest: DocumentVisualManifest): ManifestValidationResult {
    return validateDocumentVisualManifest(manifest);
  }
}
