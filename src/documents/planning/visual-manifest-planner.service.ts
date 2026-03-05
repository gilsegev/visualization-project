import { AnchorCandidate, ParagraphNode, SectionNode } from '../analysis/document-analysis.types';
import { validateDocumentVisualManifest } from './visual-manifest.schema';
import { DocumentVisualManifest, ManifestValidationResult, PlannedVisualization } from './visual-manifest.types';

function norm(v: string): string {
  return String(v || '').replace(/\s+/g, ' ').trim();
}

function titleFromText(text: string): string {
  return norm(text).split(' ').slice(0, 8).join(' ') || 'Key Concept';
}

function pickType(text: string): 'infographic' | 'sourced_image' | 'data_viz' {
  const t = norm(text).toLowerCase();
  if (/\b(percent|trend|rate|distribution|chart|count)\b/.test(t)) return 'data_viz';
  if (/\b(scene|photo|realistic|image)\b/.test(t)) return 'sourced_image';
  return 'infographic';
}

function sectionForIndex(sections: SectionNode[], index: number): string {
  const found = sections.find((s) => index >= s.paragraph_start && index <= s.paragraph_end);
  return found?.heading || 'Document Context';
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
      visuals.push({
        type: pickType(text),
        title: titleFromText(text),
        description: text.slice(0, 600),
        context: `Anchor ${anchor.anchor_id} in section "${sectionForIndex(input.sections, anchor.paragraph_index)}"`,
        purpose: 'Visually reinforce the surrounding document concept.'
      });
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
