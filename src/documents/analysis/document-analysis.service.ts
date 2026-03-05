import { createHash } from 'crypto';
import { AnchorCandidate, ContextWindow, DocumentAnalysisResult, ParagraphNode, SectionNode } from './document-analysis.types';

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function normalizeText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export class DocumentAnalysisService {
  extractParagraphsFromPlainText(text: string): ParagraphNode[] {
    const chunks = String(text || '').split(/\r?\n\r?\n+/).map(normalizeText).filter(Boolean);
    return chunks.map((chunk, i) => {
      const xmlPath = `/w:document/w:body/w:p[${i + 1}]`;
      return {
        xml_path_id: xmlPath,
        paragraph_hash: hashText(`${xmlPath}|${chunk}`),
        text: chunk,
        index: i
      };
    });
  }

  buildSections(paragraphs: ParagraphNode[]): SectionNode[] {
    if (!paragraphs.length) return [];
    const sections: SectionNode[] = [];
    let start = 0;
    let current = 'Introduction';
    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i];
      const isHeading = p.text.length <= 80 && /^[A-Z0-9\s:,\-()]+$/.test(p.text);
      if (isHeading && i > start) {
        sections.push({
          section_id: `section-${sections.length + 1}`,
          heading: current,
          paragraph_start: start,
          paragraph_end: i - 1
        });
        current = p.text;
        start = i;
      }
    }
    sections.push({
      section_id: `section-${sections.length + 1}`,
      heading: current,
      paragraph_start: start,
      paragraph_end: paragraphs.length - 1
    });
    return sections;
  }

  buildStaticAnchorMap(paragraphs: ParagraphNode[]): AnchorCandidate[] {
    const anchors = paragraphs
      .filter((p) => p.text.length >= 30)
      .map((p) => {
        const confidence = Math.min(1, Math.max(0.2, Math.min(0.95, p.text.length / 400)));
        return {
          anchor_id: `anchor-${p.index + 1}-${p.paragraph_hash.slice(0, 10)}`,
          xml_path_id: p.xml_path_id,
          paragraph_hash: p.paragraph_hash,
          paragraph_index: p.index,
          confidence,
          reason: 'paragraph_length_signal'
        } as AnchorCandidate;
      });
    if (anchors.length) return anchors;
    return this.buildFallbackAnchors(paragraphs);
  }

  buildFallbackAnchors(paragraphs: ParagraphNode[]): AnchorCandidate[] {
    if (!paragraphs.length) return [];
    const mid = Math.floor((paragraphs.length - 1) / 2);
    const picks = [0, mid, paragraphs.length - 1].filter((v, i, arr) => arr.indexOf(v) === i);
    return picks.map((idx) => {
      const p = paragraphs[idx];
      return {
        anchor_id: `fallback-${idx + 1}-${p.paragraph_hash.slice(0, 10)}`,
        xml_path_id: p.xml_path_id,
        paragraph_hash: p.paragraph_hash,
        paragraph_index: p.index,
        confidence: 0.15,
        reason: 'fallback_position'
      };
    });
  }

  buildContextWindows(paragraphs: ParagraphNode[], anchors: AnchorCandidate[], radiusChars = 2048): ContextWindow[] {
    const merged = paragraphs.map((p) => p.text).join('\n\n');
    return anchors.map((a) => {
      const text = paragraphs[a.paragraph_index]?.text || '';
      const pos = Math.max(0, merged.indexOf(text));
      const start = Math.max(0, pos - radiusChars);
      const end = Math.min(merged.length, pos + text.length + radiusChars);
      return {
        anchor_id: a.anchor_id,
        before_chars: pos - start,
        after_chars: end - (pos + text.length),
        content: merged.slice(start, end)
      };
    });
  }

  analyzeFromPlainText(text: string): DocumentAnalysisResult {
    const paragraphs = this.extractParagraphsFromPlainText(text);
    const sections = this.buildSections(paragraphs);
    const anchors = this.buildStaticAnchorMap(paragraphs);
    const usedFallback = anchors.some((a) => a.reason === 'fallback_position');
    return { paragraphs, sections, anchors, used_fallback_anchor_mode: usedFallback };
  }
}
