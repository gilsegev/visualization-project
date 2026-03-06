import { createHash } from 'crypto';
import { AnchorCandidate, ContextWindow, DocumentAnalysisResult, ParagraphNode, SectionNode } from './document-analysis.types';

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function normalizeText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sequenceSignal(text: string): boolean {
  return /^\s*(step\s+\d+[.)]?|[0-9]+[.)])\s+/i.test(text) || /\b(next|then|first|second|third)\b/i.test(text);
}

function dataSignal(text: string): boolean {
  return /(\d+(\.\d+)?\s?%|\$[\d,.]+|\b(increase|decrease|growth|decline|rate|ratio)\b)/i.test(text);
}

function entitySignal(text: string): boolean {
  return /(\b[A-Z]{2,}\b|\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b|\b(API|OAuth|PostgreSQL|Mermaid|Kafka|Kubernetes)\b)/.test(text);
}

function textDensity(text: string): number {
  return Math.max(0, Math.min(1, normalizeText(text).length / 320));
}

export class DocumentAnalysisService {
  extractParagraphsFromPlainText(text: string): ParagraphNode[] {
    const chunks = String(text || '').split(/\r?\n\r?\n+/).map(normalizeText).filter(Boolean);
    const paragraphs = chunks.map((chunk, i) => {
      const xmlPath = `/w:document/w:body/w:p[${i + 1}]`;
      return {
        xml_path_id: xmlPath,
        paragraph_hash: hashText(`${xmlPath}|${chunk}`),
        text: chunk,
        index: i,
        has_sequence: sequenceSignal(chunk),
        has_data: dataSignal(chunk),
        has_entity: entitySignal(chunk),
        text_density: textDensity(chunk),
        sequence_group_id: null
      };
    });
    this.assignSequenceGroups(paragraphs);
    return paragraphs;
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
      .filter((p) => p.text.length >= 30 || p.has_sequence || p.has_data || p.has_entity)
      .map((p) => {
        const confidence = Math.min(
          0.99,
          Math.max(
            0.2,
            (p.text_density * 0.55)
              + (p.has_sequence ? 0.15 : 0)
              + (p.has_data ? 0.15 : 0)
              + (p.has_entity ? 0.15 : 0)
          )
        );
        return {
          anchor_id: `anchor-${p.index + 1}-${p.paragraph_hash.slice(0, 10)}`,
          xml_path_id: p.xml_path_id,
          paragraph_hash: p.paragraph_hash,
          paragraph_index: p.index,
          confidence,
          reason: p.has_sequence
            ? 'sequence_signal'
            : p.has_data
              ? 'data_signal'
              : p.has_entity
                ? 'entity_signal'
                : 'paragraph_length_signal'
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
    const ranges = this.sequenceRanges(paragraphs);
    return anchors.map((a) => {
      const p = paragraphs[a.paragraph_index];
      if (!p) {
        return {
          anchor_id: a.anchor_id,
          before_chars: 0,
          after_chars: 0,
          content: '',
          paragraph_start_index: a.paragraph_index,
          paragraph_end_index: a.paragraph_index,
          window_mode: 'bounded'
        };
      }
      const seq = p.sequence_group_id ? ranges.get(p.sequence_group_id) : undefined;
      if (seq) {
        const content = this.joinRange(paragraphs, seq.start, seq.end);
        return {
          anchor_id: a.anchor_id,
          before_chars: this.rangeCharCount(paragraphs, seq.start, a.paragraph_index - 1),
          after_chars: this.rangeCharCount(paragraphs, a.paragraph_index + 1, seq.end),
          content,
          paragraph_start_index: seq.start,
          paragraph_end_index: seq.end,
          window_mode: 'sequence_expanded'
        };
      }
      let start = a.paragraph_index;
      let end = a.paragraph_index;
      let before = 0;
      let after = 0;
      const sep = 2;
      while (true) {
        const canLeft = start > 0 && (before + paragraphs[start - 1].text.length + sep) <= radiusChars;
        const canRight = end < (paragraphs.length - 1) && (after + paragraphs[end + 1].text.length + sep) <= radiusChars;
        if (!canLeft && !canRight) break;
        if (canLeft && (!canRight || before <= after)) {
          start -= 1;
          before += paragraphs[start].text.length + sep;
        } else {
          end += 1;
          after += paragraphs[end].text.length + sep;
        }
      }
      return {
        anchor_id: a.anchor_id,
        before_chars: before,
        after_chars: after,
        content: this.joinRange(paragraphs, start, end),
        paragraph_start_index: start,
        paragraph_end_index: end,
        window_mode: 'bounded'
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

  private assignSequenceGroups(paragraphs: ParagraphNode[]): void {
    let group = 0;
    for (let i = 0; i < paragraphs.length; i++) {
      if (!paragraphs[i].has_sequence || paragraphs[i].sequence_group_id) continue;
      const start = i;
      let end = i;
      while ((end + 1) < paragraphs.length && paragraphs[end + 1].has_sequence) end += 1;
      if ((end - start + 1) >= 2) {
        group += 1;
        const groupId = `seq-${group}`;
        for (let j = start; j <= end; j++) paragraphs[j].sequence_group_id = groupId;
      }
      i = end;
    }
  }

  private sequenceRanges(paragraphs: ParagraphNode[]): Map<string, { start: number; end: number }> {
    const out = new Map<string, { start: number; end: number }>();
    for (const p of paragraphs) {
      const gid = p.sequence_group_id;
      if (!gid) continue;
      const prev = out.get(gid);
      if (!prev) out.set(gid, { start: p.index, end: p.index });
      else out.set(gid, { start: Math.min(prev.start, p.index), end: Math.max(prev.end, p.index) });
    }
    return out;
  }

  private joinRange(paragraphs: ParagraphNode[], start: number, end: number): string {
    return paragraphs.slice(start, end + 1).map((p) => p.text).join('\n\n');
  }

  private rangeCharCount(paragraphs: ParagraphNode[], start: number, end: number): number {
    if (start > end) return 0;
    let total = 0;
    for (let i = start; i <= end; i++) total += paragraphs[i].text.length + (i < end ? 2 : 0);
    return total;
  }
}
