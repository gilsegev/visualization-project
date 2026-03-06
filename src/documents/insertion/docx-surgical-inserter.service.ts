import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import JSZip from 'jszip';
import { AnchorCandidate } from '../analysis/document-analysis.types';
import { DocumentVisualManifest, PlannedVisualization } from '../planning/visual-manifest.types';

type InsertionPlan = {
  anchor_id: string;
  xml_path_id: string;
  paragraph_hash: string;
  xml_paragraph_index: number;
  visualization: PlannedVisualization;
};

@Injectable()
export class DocxSurgicalInserterService {
  async insertVisuals(input: {
    sourceBytes: Buffer;
    manifest: DocumentVisualManifest;
    anchors: AnchorCandidate[];
  }): Promise<{
    outputBytes: Buffer;
    surgicalLog: {
      strategy: 'bottom_up_xml_path_id_desc';
      planned: number;
      inserted: number;
      skipped: number;
      collisions: number;
      plans: Array<{ anchor_id: string; xml_path_id: string; paragraph_hash: string; inserted: boolean; reason?: string }>;
    };
  }> {
    const zip = await JSZip.loadAsync(input.sourceBytes);
    const docEntry = zip.file('word/document.xml');
    if (!docEntry) {
      throw new Error('DOCX insertion failed: word/document.xml missing');
    }
    let docXml = await docEntry.async('string');
    const paragraphs = [...docXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)];
    if (!paragraphs.length) {
      throw new Error('DOCX insertion failed: no paragraphs found in word/document.xml');
    }

    const anchorsById = new Map(input.anchors.map((a) => [String(a.anchor_id || ''), a]));
    const visuals = this.collectVisuals(input.manifest);
    const plans: InsertionPlan[] = [];
    for (const visual of visuals) {
      const anchorId = this.extractAnchorId(visual.context);
      if (!anchorId) continue;
      const anchor = anchorsById.get(anchorId);
      if (!anchor) continue;
      const paragraphIndex = this.xmlPathToParagraphIndex(anchor.xml_path_id);
      if (paragraphIndex < 1 || paragraphIndex > paragraphs.length) continue;
      const paragraphXml = paragraphs[paragraphIndex - 1]?.[0] || '';
      const paragraphText = this.extractParagraphText(paragraphXml);
      const computedHash = this.hashParagraph(anchor.xml_path_id, paragraphText);
      if (computedHash !== String(anchor.paragraph_hash || '').trim()) continue;
      plans.push({
        anchor_id: anchor.anchor_id,
        xml_path_id: anchor.xml_path_id,
        paragraph_hash: anchor.paragraph_hash,
        xml_paragraph_index: paragraphIndex,
        visualization: visual,
      });
    }

    plans.sort((a, b) => b.xml_paragraph_index - a.xml_paragraph_index);
    const usedTargets = new Set<number>();
    const logRows: Array<{ anchor_id: string; xml_path_id: string; paragraph_hash: string; inserted: boolean; reason?: string }> = [];
    let inserted = 0;
    let skipped = 0;
    let collisions = 0;

    for (const plan of plans) {
      if (usedTargets.has(plan.xml_paragraph_index)) {
        skipped += 1;
        collisions += 1;
        logRows.push({
          anchor_id: plan.anchor_id,
          xml_path_id: plan.xml_path_id,
          paragraph_hash: plan.paragraph_hash,
          inserted: false,
          reason: 'anchor_collision_same_xml_path_id',
        });
        continue;
      }
      const currentMatches = [...docXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)];
      const target = currentMatches[plan.xml_paragraph_index - 1];
      if (!target || typeof target.index !== 'number') {
        skipped += 1;
        logRows.push({
          anchor_id: plan.anchor_id,
          xml_path_id: plan.xml_path_id,
          paragraph_hash: plan.paragraph_hash,
          inserted: false,
          reason: 'target_paragraph_not_found',
        });
        continue;
      }
      const insertionAt = target.index + target[0].length;
      const markerParagraph = this.buildMarkerParagraph(plan.visualization);
      docXml = `${docXml.slice(0, insertionAt)}${markerParagraph}${docXml.slice(insertionAt)}`;
      usedTargets.add(plan.xml_paragraph_index);
      inserted += 1;
      logRows.push({
        anchor_id: plan.anchor_id,
        xml_path_id: plan.xml_path_id,
        paragraph_hash: plan.paragraph_hash,
        inserted: true,
      });
    }

    zip.file('word/document.xml', docXml);
    const outputBytes = Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    return {
      outputBytes,
      surgicalLog: {
        strategy: 'bottom_up_xml_path_id_desc',
        planned: plans.length,
        inserted,
        skipped,
        collisions,
        plans: logRows,
      },
    };
  }

  private collectVisuals(manifest: DocumentVisualManifest): PlannedVisualization[] {
    if (!manifest || !Array.isArray(manifest.lessons)) return [];
    const visuals: PlannedVisualization[] = [];
    for (const lesson of manifest.lessons) {
      if (Array.isArray(lesson?.visualizations)) visuals.push(...lesson.visualizations);
    }
    return visuals;
  }

  private extractAnchorId(context: string): string | null {
    const text = String(context || '');
    const m = text.match(/Anchor\s+([a-z0-9-]+)/i);
    return m?.[1] ? m[1] : null;
  }

  private xmlPathToParagraphIndex(xmlPathId: string): number {
    const text = String(xmlPathId || '');
    const m = text.match(/\/w:p\[(\d+)\]/i);
    return m ? Number(m[1]) : NaN;
  }

  private extractParagraphText(paragraphXml: string): string {
    const text = String(paragraphXml || '')
      .replace(/<w:tab\/>/g, ' ')
      .replace(/<w:br\/>/g, ' ')
      .replace(/<w:.*?>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    return text.replace(/\s+/g, ' ').trim();
  }

  private hashParagraph(xmlPathId: string, paragraphText: string): string {
    return createHash('sha256')
      .update(`${String(xmlPathId || '')}|${String(paragraphText || '').trim()}`)
      .digest('hex');
  }

  private escapeXml(text: string): string {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private buildMarkerParagraph(visual: PlannedVisualization): string {
    const type = String(visual?.type || 'visual').toUpperCase();
    const title = this.escapeXml(String(visual?.title || 'Generated visual'));
    const desc = this.escapeXml(String(visual?.description || '').slice(0, 220));
    const marker = `[VISUAL:${type}] ${title}${desc ? ` - ${desc}` : ''}`;
    return `<w:p><w:r><w:t xml:space="preserve">${marker}</w:t></w:r></w:p>`;
  }
}
