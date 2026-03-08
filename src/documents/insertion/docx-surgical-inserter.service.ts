import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import * as path from 'path';
import JSZip = require('jszip');
import { AnchorCandidate } from '../analysis/document-analysis.types';
import { DocumentVisualManifest, PlannedVisualization } from '../planning/visual-manifest.types';
import { getDocxDisplayPolicy } from './docx-display-policy';

type InsertionPlan = {
  anchor_id: string;
  xml_path_id: string;
  paragraph_hash: string;
  xml_paragraph_index: number;
  requested_scope: string;
  resolved_scope: string;
  visualization: PlannedVisualization;
  asset: {
    anchor_id: string | null;
    visual_type: string;
    object_key: string;
    bytes: Buffer;
    extension: string;
    width_px?: number | null;
    height_px?: number | null;
  };
  display_policy: ReturnType<typeof getDocxDisplayPolicy>;
  caption_text: string;
  caption_mode: 'auto' | 'explicit';
};

@Injectable()
export class DocxSurgicalInserterService {
  async insertVisuals(input: {
    sourceBytes: Buffer;
    manifest: DocumentVisualManifest;
    anchors: AnchorCandidate[];
    assets?: Array<{
      anchor_id: string | null;
      visual_type: string;
      object_key: string;
      bytes: Buffer;
      extension: string;
      width_px?: number | null;
      height_px?: number | null;
    }>;
  }): Promise<{
    outputBytes: Buffer;
    surgicalLog: {
      strategy: 'bottom_up_xml_path_id_desc';
      planned: number;
      resolved: number;
      inserted: number;
      skipped: number;
      collisions: number;
      placement_conflicts: number;
      list_block_adjustments: number;
      heading_avoidance_adjustments: number;
      snap_to_grid_adjustments: number;
      plans: Array<{
        anchor_id: string;
        xml_path_id: string;
        paragraph_hash: string;
        requested_scope: string;
        resolved_scope: string;
        resolved_paragraph_index?: number;
        snap_reason?: string;
        inserted: boolean;
        caption_text?: string;
        caption_inserted?: boolean;
        caption_reason?: string;
        reason?: string;
        object_key?: string;
      }>;
      captions_planned: number;
      captions_inserted: number;
      captions_skipped: number;
      display_policy: {
        strategy: 'fixed_physical_box_preserve_source_resolution';
        defaults: {
          max_width_in: number;
          max_height_in: number;
          wrap_mode: 'inline' | 'square';
        };
      };
    };
  }> {
    const captionsEnabled = String(process.env.DOCX_CAPTIONS_ENABLED || 'true').toLowerCase() === 'true';
    const captionMaxChars = Math.max(80, Math.min(260, Number(process.env.DOCX_CAPTION_MAX_CHARS || 180)));
    const zip = await JSZip.loadAsync(input.sourceBytes);
    const docEntry = zip.file('word/document.xml');
    if (!docEntry) {
      throw new Error('DOCX insertion failed: word/document.xml missing');
    }
    const relsEntry = zip.file('word/_rels/document.xml.rels');
    const contentTypesEntry = zip.file('[Content_Types].xml');
    if (!contentTypesEntry) {
      throw new Error('DOCX insertion failed: [Content_Types].xml missing');
    }
    let docXml = await docEntry.async('string');
    let relsXml = relsEntry
      ? await relsEntry.async('string')
      : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    let contentTypesXml = await contentTypesEntry.async('string');
    docXml = this.ensureDrawingNamespaces(docXml);
    const paragraphs = [...docXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)];
    if (!paragraphs.length) {
      throw new Error('DOCX insertion failed: no paragraphs found in word/document.xml');
    }

    const anchorsById = new Map(input.anchors.map((a) => [String(a.anchor_id || ''), a]));
    const assetsByAnchor = this.indexAssets(input.assets || []);
    const visuals = this.collectVisuals(input.manifest);
    const plans: InsertionPlan[] = [];
    for (const visual of visuals) {
      const anchorId = String(visual?.anchor_id || '').trim() || this.extractAnchorId(visual.context);
      if (!anchorId) continue;
      const anchor = anchorsById.get(anchorId);
      if (!anchor) continue;
      const paragraphIndex = this.xmlPathToParagraphIndex(anchor.xml_path_id);
      if (paragraphIndex < 1 || paragraphIndex > paragraphs.length) continue;
      const paragraphXml = paragraphs[paragraphIndex - 1]?.[0] || '';
      const paragraphText = this.extractParagraphText(paragraphXml);
      const computedHash = this.hashParagraph(anchor.xml_path_id, paragraphText);
      const paragraphHashMismatch = computedHash !== String(anchor.paragraph_hash || '').trim();
      if (!paragraphText) continue;
      const visualType = String(visual?.type || '').trim().toLowerCase();
      const asset = this.pickAssetForPlan(assetsByAnchor, anchorId, visualType);
      if (!asset) continue;
      const basePolicy = getDocxDisplayPolicy(visual.type);
      const displayPolicy = {
        ...basePolicy,
        max_width_in: Number.isFinite(Number(visual?.placement?.max_width_in))
          ? Number(visual?.placement?.max_width_in)
          : basePolicy.max_width_in,
        max_height_in: Number.isFinite(Number(visual?.placement?.max_height_in))
          ? Number(visual?.placement?.max_height_in)
          : basePolicy.max_height_in,
      };
      const requestedScope = String(visual?.placement?.scope || 'after_anchor');
      plans.push({
        anchor_id: anchor.anchor_id,
        xml_path_id: anchor.xml_path_id,
        paragraph_hash: paragraphHashMismatch ? computedHash : anchor.paragraph_hash,
        xml_paragraph_index: paragraphIndex,
        requested_scope: requestedScope,
        resolved_scope: requestedScope,
        visualization: visual,
        asset,
        display_policy: displayPolicy,
        caption_text: this.resolvePlanCaption(visual, visualType, captionMaxChars),
        caption_mode: String(visual?.caption_mode || 'auto').trim().toLowerCase() === 'explicit' ? 'explicit' : 'auto',
      });
    }

    plans.sort((a, b) => {
      if (b.xml_paragraph_index !== a.xml_paragraph_index) return b.xml_paragraph_index - a.xml_paragraph_index;
      return Number(b.visualization?.placement?.priority || 0) - Number(a.visualization?.placement?.priority || 0);
    });
    const usedTargets = new Set<number>();
    const logRows: Array<{
      anchor_id: string;
      xml_path_id: string;
      paragraph_hash: string;
      requested_scope: string;
      resolved_scope: string;
      resolved_paragraph_index?: number;
      snap_reason?: string;
      inserted: boolean;
      caption_text?: string;
      caption_inserted?: boolean;
      caption_reason?: string;
      reason?: string;
      object_key?: string;
    }> = [];
    const placementMetrics = {
      placement_conflicts: 0,
      list_block_adjustments: 0,
      heading_avoidance_adjustments: 0,
      snap_to_grid_adjustments: 0,
    };
    let inserted = 0;
    let skipped = 0;
    let collisions = 0;
    let captionsInserted = 0;
    let captionsSkipped = 0;
    let nextRelId = this.nextRelationshipId(relsXml);
    let nextDocPrId = await this.nextDocPrId(zip, docXml);
    let nextMediaIndex = this.nextMediaIndex(zip);
    const minGap = Math.max(0, Number(process.env.DOC_INSERTION_MIN_PARAGRAPH_GAP || 3));

    for (const plan of plans) {
      const currentMatches = [...docXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)];
      const resolved = this.resolveScopedInsertionParagraphIndex(currentMatches, plan.xml_paragraph_index, plan.visualization.placement);
      let resolvedParagraphIndex = resolved.index;
      plan.resolved_scope = resolved.scope;
      let snapReason: string | undefined;
      placementMetrics.list_block_adjustments += resolved.listAdjusted ? 1 : 0;
      placementMetrics.heading_avoidance_adjustments += resolved.headingAdjusted ? 1 : 0;
      if (resolved.scope !== plan.requested_scope || resolved.listAdjusted || resolved.headingAdjusted) {
        placementMetrics.snap_to_grid_adjustments += 1;
        snapReason = [
          resolved.scope !== plan.requested_scope ? `scope:${plan.requested_scope}->${resolved.scope}` : '',
          resolved.headingAdjusted ? 'heading_avoidance' : '',
          resolved.listAdjusted ? 'list_block_adjustment' : '',
        ].filter(Boolean).join('|');
      }
      if (usedTargets.has(resolvedParagraphIndex)) {
        collisions += 1;
        placementMetrics.placement_conflicts += 1;
        placementMetrics.snap_to_grid_adjustments += 1;
        snapReason = [snapReason, 'collision_next_available'].filter(Boolean).join('|');
        const fallbackIndex = this.findNextAvailableParagraphIndex(currentMatches, resolvedParagraphIndex + 1, usedTargets);
        if (fallbackIndex > 0) {
          resolvedParagraphIndex = fallbackIndex;
        } else {
          skipped += 1;
          logRows.push({
            anchor_id: plan.anchor_id,
            xml_path_id: plan.xml_path_id,
            paragraph_hash: plan.paragraph_hash,
            requested_scope: plan.requested_scope,
            resolved_scope: plan.resolved_scope,
            resolved_paragraph_index: resolvedParagraphIndex,
            snap_reason: snapReason,
            inserted: false,
            caption_text: plan.caption_text || undefined,
            caption_inserted: false,
            caption_reason: captionsEnabled ? 'insertion_skipped' : 'captions_disabled',
            reason: 'anchor_collision_no_fallback_slot',
          });
          continue;
        }
      }
      if (minGap > 0 && this.hasNearbyUsedTarget(usedTargets, resolvedParagraphIndex, minGap)) {
        placementMetrics.snap_to_grid_adjustments += 1;
        snapReason = [snapReason, `min_gap_${minGap}_adjustment`].filter(Boolean).join('|');
        const gapFallback = this.findNextAvailableParagraphIndex(currentMatches, resolvedParagraphIndex + 1, usedTargets, minGap);
        if (gapFallback > 0) {
          resolvedParagraphIndex = gapFallback;
        }
      }
      const target = currentMatches[resolvedParagraphIndex - 1];
      if (!target || typeof target.index !== 'number') {
        skipped += 1;
        logRows.push({
          anchor_id: plan.anchor_id,
          xml_path_id: plan.xml_path_id,
          paragraph_hash: plan.paragraph_hash,
          requested_scope: plan.requested_scope,
          resolved_scope: plan.resolved_scope,
          resolved_paragraph_index: resolvedParagraphIndex,
          snap_reason: snapReason,
          inserted: false,
          caption_text: plan.caption_text || undefined,
          caption_inserted: false,
          caption_reason: captionsEnabled ? 'target_paragraph_not_found' : 'captions_disabled',
          reason: 'target_paragraph_not_found',
        });
        continue;
      }
      const insertionAt = target.index + target[0].length;
      const normalizedExt = this.normalizeImageExtension(plan.asset.extension);
      const mediaFileName = `docasset-${String(nextMediaIndex).padStart(4, '0')}${normalizedExt}`;
      nextMediaIndex += 1;
      const mediaPath = `word/media/${mediaFileName}`;
      zip.file(mediaPath, plan.asset.bytes);
      contentTypesXml = this.ensureContentType(contentTypesXml, normalizedExt);

      const relId = `rId${nextRelId++}`;
      relsXml = this.appendImageRelationship(relsXml, relId, `media/${mediaFileName}`);

      const docPrId = nextDocPrId++;
      const drawingParagraph = this.buildDrawingParagraph({
        relId,
        title: String(plan.visualization?.title || 'Generated visual'),
        desc: String(plan.visualization?.description || '').trim(),
        displayPolicy: plan.display_policy,
        docPrId,
        widthPx: Number(plan.asset?.width_px ?? NaN),
        heightPx: Number(plan.asset?.height_px ?? NaN),
        alignment: String(plan.visualization?.placement?.alignment || 'center'),
      });
      let insertionBlock = drawingParagraph;
      let captionInsertedForPlan = false;
      let captionReason: string | undefined;
      if (captionsEnabled && plan.caption_text) {
        insertionBlock += this.buildCaptionParagraph({
          captionText: plan.caption_text,
          alignment: String(plan.visualization?.placement?.alignment || 'center'),
        });
        captionInsertedForPlan = true;
        captionsInserted += 1;
      } else {
        captionsSkipped += 1;
        captionReason = captionsEnabled ? 'caption_unavailable' : 'captions_disabled';
      }
      docXml = `${docXml.slice(0, insertionAt)}${insertionBlock}${docXml.slice(insertionAt)}`;
      usedTargets.add(resolvedParagraphIndex);
      inserted += 1;
      logRows.push({
        anchor_id: plan.anchor_id,
        xml_path_id: plan.xml_path_id,
        paragraph_hash: plan.paragraph_hash,
        requested_scope: plan.requested_scope,
        resolved_scope: plan.resolved_scope,
        resolved_paragraph_index: resolvedParagraphIndex,
        snap_reason: snapReason,
        inserted: true,
        caption_text: plan.caption_text || undefined,
        caption_inserted: captionInsertedForPlan,
        caption_reason: captionReason,
        object_key: plan.asset.object_key,
      });
    }

    zip.file('word/document.xml', docXml);
    zip.file('word/_rels/document.xml.rels', relsXml);
    zip.file('[Content_Types].xml', contentTypesXml);
    const outputBytes = Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    return {
      outputBytes,
      surgicalLog: {
        strategy: 'bottom_up_xml_path_id_desc',
        planned: plans.length,
        resolved: logRows.length,
        inserted,
        skipped,
        collisions,
        captions_planned: plans.length,
        captions_inserted: captionsInserted,
        captions_skipped: captionsSkipped,
        placement_conflicts: placementMetrics.placement_conflicts,
        list_block_adjustments: placementMetrics.list_block_adjustments,
        heading_avoidance_adjustments: placementMetrics.heading_avoidance_adjustments,
        snap_to_grid_adjustments: placementMetrics.snap_to_grid_adjustments,
        plans: logRows,
        display_policy: {
          strategy: 'fixed_physical_box_preserve_source_resolution',
          defaults: {
            max_width_in: 4.5,
            max_height_in: 4.5,
            wrap_mode: 'square',
          },
        },
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

  private indexAssets(
    assets: Array<{
      anchor_id: string | null;
      visual_type: string;
      object_key: string;
      bytes: Buffer;
      extension: string;
    }>
  ): Map<string, Array<{
    anchor_id: string | null;
    visual_type: string;
    object_key: string;
    bytes: Buffer;
    extension: string;
  }>> {
    const byAnchor = new Map<string, Array<{
      anchor_id: string | null;
      visual_type: string;
      object_key: string;
      bytes: Buffer;
      extension: string;
    }>>();
    for (const asset of assets || []) {
      const anchorId = String(asset?.anchor_id || '').trim();
      if (!anchorId || !asset?.bytes?.byteLength) continue;
      if (!byAnchor.has(anchorId)) byAnchor.set(anchorId, []);
      byAnchor.get(anchorId)!.push(asset);
    }
    return byAnchor;
  }

  private pickAssetForPlan(
    assetsByAnchor: Map<string, Array<{
      anchor_id: string | null;
      visual_type: string;
      object_key: string;
      bytes: Buffer;
      extension: string;
      width_px?: number | null;
      height_px?: number | null;
    }>>,
    anchorId: string,
    visualType: string,
  ): {
    anchor_id: string | null;
    visual_type: string;
    object_key: string;
    bytes: Buffer;
    extension: string;
    width_px?: number | null;
    height_px?: number | null;
  } | null {
    const list = assetsByAnchor.get(anchorId);
    if (list?.length) {
      const preferredIdx = list.findIndex((asset) => String(asset?.visual_type || '').trim().toLowerCase() === visualType);
      const idx = preferredIdx >= 0 ? preferredIdx : 0;
      const [picked] = list.splice(idx, 1);
      if (picked) return picked;
    }
    for (const candidateList of assetsByAnchor.values()) {
      if (!candidateList?.length) continue;
      const preferredIdx = candidateList.findIndex((asset) => String(asset?.visual_type || '').trim().toLowerCase() === visualType);
      if (preferredIdx < 0) continue;
      const [picked] = candidateList.splice(preferredIdx, 1);
      if (picked) return picked;
    }
    for (const candidateList of assetsByAnchor.values()) {
      if (!candidateList?.length) continue;
      const [picked] = candidateList.splice(0, 1);
      if (picked) return picked;
    }
    return null;
  }

  private xmlPathToParagraphIndex(xmlPathId: string): number {
    const text = String(xmlPathId || '');
    const m = text.match(/\/w:p\[(\d+)\]/i);
    return m ? Number(m[1]) : NaN;
  }

  private resolveScopedInsertionParagraphIndex(
    paragraphs: RegExpMatchArray[],
    baseIndex: number,
    placement?: PlannedVisualization['placement'],
  ): { index: number; scope: string; listAdjusted: boolean; headingAdjusted: boolean } {
    if (!Array.isArray(paragraphs) || !paragraphs.length) {
      return { index: baseIndex, scope: 'after_anchor', listAdjusted: false, headingAdjusted: false };
    }
    let idx = Math.max(1, Math.min(paragraphs.length, Number(baseIndex) || 1));
    const scope = String(placement?.scope || 'after_anchor');
    let listAdjusted = false;
    let headingAdjusted = false;

    const currentAt = (i: number) => String(paragraphs[Math.max(0, Math.min(paragraphs.length - 1, i - 1))]?.[0] || '');
    const movePastHeadingChain = (start: number, maxDelta = 12): number => {
      const max = Math.min(paragraphs.length, start + maxDelta);
      for (let i = start; i <= max; i += 1) {
        const probe = currentAt(i);
        const probeText = this.extractParagraphText(probe);
        if (!probeText) continue;
        if (!this.isHeadingParagraph(probe)) return i;
      }
      return start;
    };

    if (scope === 'section_intro_body') {
      const shifted = movePastHeadingChain(idx + 1);
      if (shifted !== idx) headingAdjusted = true;
      idx = shifted;
    } else if (scope === 'section_end') {
      let nextHeading = -1;
      for (let i = idx + 1; i <= paragraphs.length; i += 1) {
        if (this.isHeadingParagraph(currentAt(i))) {
          nextHeading = i;
          break;
        }
      }
      idx = nextHeading > 1 ? nextHeading - 1 : paragraphs.length;
    }

    const current = currentAt(idx);
    const avoidHeadings = placement?.avoid_headings !== false;
    if (avoidHeadings && (this.isHeadingParagraph(current) || idx <= 2)) {
      const shifted = movePastHeadingChain(idx + 1);
      if (shifted !== idx) headingAdjusted = true;
      idx = shifted;
    }

    const avoidListSplit = placement?.avoid_list_split !== false || scope === 'after_list_block';
    if (avoidListSplit) {
      if (this.isListParagraph(currentAt(idx))) {
        while (idx < paragraphs.length && this.isListParagraph(currentAt(idx + 1))) {
          idx += 1;
        }
        listAdjusted = true;
      } else if (this.isListParagraph(currentAt(idx + 1))) {
        // If the anchor sits right before a contiguous list block, avoid inserting
        // between the intro sentence and its list; push after the block.
        while (idx < paragraphs.length && this.isListParagraph(currentAt(idx + 1))) {
          idx += 1;
        }
        listAdjusted = true;
      }
    }

    idx = Math.max(1, Math.min(paragraphs.length, idx));
    return { index: idx, scope, listAdjusted, headingAdjusted };
  }

  private findNextAvailableParagraphIndex(
    paragraphs: RegExpMatchArray[],
    startIndex: number,
    usedTargets: Set<number>,
    minGap = 0,
  ): number {
    const start = Math.max(1, Number(startIndex || 1));
    for (let i = start; i <= paragraphs.length; i += 1) {
      if (usedTargets.has(i)) continue;
      if (minGap > 0 && this.hasNearbyUsedTarget(usedTargets, i, minGap)) continue;
      const xml = String(paragraphs[i - 1]?.[0] || '');
      if (!xml || this.isHeadingParagraph(xml)) continue;
      return i;
    }
    return -1;
  }

  private hasNearbyUsedTarget(usedTargets: Set<number>, candidate: number, minGap: number): boolean {
    for (const taken of usedTargets) {
      if (Math.abs(Number(taken) - Number(candidate)) < minGap) return true;
    }
    return false;
  }

  private isListParagraph(paragraphXml: string): boolean {
    const xml = String(paragraphXml || '');
    if (!xml) return false;
    return /<w:numPr\b/i.test(xml) || /<w:pStyle\b[^>]*w:val="List/i.test(xml);
  }

  private isHeadingParagraph(paragraphXml: string): boolean {
    const xml = String(paragraphXml || '');
    if (!xml) return false;
    if (/<w:pStyle\b[^>]*w:val="Heading[0-9]+"/i.test(xml)) return true;
    if (/<w:pStyle\b[^>]*w:val="Title"/i.test(xml)) return true;
    if (/<w:outlineLvl\b/i.test(xml)) return true;
    return false;
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
    return this.stripInvalidXmlChars(String(text || ''))
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private stripInvalidXmlChars(text: string): string {
    // XML 1.0 legal chars: #x9 | #xA | #xD | #x20-#xD7FF | #xE000-#xFFFD | #x10000-#x10FFFF
    return String(text || '').replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD]/g, '');
  }

  private normalizeImageExtension(inputExt: string): string {
    const ext = String(inputExt || '').trim().toLowerCase();
    if (!ext) return '.png';
    if (ext === '.jpeg') return '.jpg';
    if (ext === '.jpe') return '.jpg';
    if (ext.startsWith('.')) return ext;
    return `.${ext}`;
  }

  private ensureContentType(contentTypesXml: string, extension: string): string {
    let xml = String(contentTypesXml || '');
    const ext = this.normalizeImageExtension(extension).replace(/^\./, '').toLowerCase();
    const contentType = this.mimeTypeFromExtension(ext);
    if (!contentType) return xml;

    // Defensive dedupe: keep only one <Default> per extension (case-insensitive).
    const seen = new Set<string>();
    xml = xml.replace(/<Default\b[^>]*\/>/gi, (tag) => {
      const extMatch = tag.match(/\bExtension="([^"]+)"/i);
      const rawExt = String(extMatch?.[1] || '').trim().toLowerCase();
      if (!rawExt) return tag;
      if (seen.has(rawExt)) return '';
      seen.add(rawExt);
      // Normalize the requested extension to the expected MIME type.
      if (rawExt === ext) {
        return `<Default Extension="${ext}" ContentType="${contentType}"/>`;
      }
      return tag;
    });

    if (!seen.has(ext)) {
      const insert = `<Default Extension="${ext}" ContentType="${contentType}"/>`;
      if (/<\/Types>/i.test(xml)) return xml.replace(/<\/Types>/i, `${insert}</Types>`);
      return `${xml}${insert}`;
    }
    return xml;
  }

  private mimeTypeFromExtension(ext: string): string | null {
    switch (ext) {
      case 'png':
        return 'image/png';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'gif':
        return 'image/gif';
      case 'bmp':
        return 'image/bmp';
      case 'tif':
      case 'tiff':
        return 'image/tiff';
      case 'webp':
        return 'image/webp';
      default:
        return null;
    }
  }

  private appendImageRelationship(relsXml: string, relId: string, target: string): string {
    const escapedTarget = this.escapeXml(target);
    const relationship = `<Relationship Id="${this.escapeXml(relId)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${escapedTarget}"/>`;
    if (/<\/Relationships>/i.test(relsXml)) {
      return relsXml.replace(/<\/Relationships>/i, `${relationship}</Relationships>`);
    }
    return relsXml;
  }

  private nextRelationshipId(relsXml: string): number {
    const matches = [...String(relsXml || '').matchAll(/Id="rId(\d+)"/g)];
    const max = matches.reduce((acc, m) => Math.max(acc, Number(m?.[1] || 0)), 0);
    return max + 1;
  }

  private async nextDocPrId(zip: JSZip, docXml: string): Promise<number> {
    let max = 0;
    const scan = (xml: string) => {
      const matches = [...String(xml || '').matchAll(/<wp:docPr\b[^>]*\bid="(\d+)"/g)];
      for (const m of matches) {
        const n = Number(m?.[1] || 0);
        if (Number.isFinite(n)) max = Math.max(max, n);
      }
    };
    scan(docXml);
    const fileNames = Object.keys(zip.files || {}).filter((name) => {
      if (!name.startsWith('word/')) return false;
      if (!name.endsWith('.xml')) return false;
      return name !== 'word/document.xml';
    });
    for (const name of fileNames) {
      const entry = zip.file(name);
      if (!entry) continue;
      try {
        const content = await entry.async('string');
        if (typeof content === 'string' && content.includes('<wp:docPr')) scan(content);
      } catch {
        // Ignore non-text or unreadable parts; document.xml scan is primary.
      }
    }
    return max + 1;
  }

  private nextMediaIndex(zip: JSZip): number {
    const files = Object.keys(zip.files || {});
    let max = 0;
    for (const file of files) {
      const base = path.basename(file);
      const m = base.match(/^docasset-(\d{4,})\.[a-z0-9]+$/i);
      if (!m?.[1]) continue;
      max = Math.max(max, Number(m[1]));
    }
    return max + 1;
  }

  private buildDrawingParagraph(input: {
    relId: string;
    title: string;
    desc: string;
    displayPolicy: ReturnType<typeof getDocxDisplayPolicy>;
    docPrId: number;
    widthPx?: number;
    heightPx?: number;
    alignment?: string;
  }): string {
    let widthIn = Math.max(1.2, Number(input.displayPolicy.preferred_width_in || 4.2));
    const maxWidthIn = Math.max(widthIn, Number(input.displayPolicy.max_width_in || widthIn));
    const maxHeightIn = Math.max(1.2, Number(input.displayPolicy.max_height_in || 4.2));
    const widthPx = Number(input.widthPx || NaN);
    const heightPx = Number(input.heightPx || NaN);
    const aspect = Number.isFinite(widthPx) && Number.isFinite(heightPx) && heightPx > 0
      ? Math.max(0.2, Math.min(5, widthPx / heightPx))
      : 1.4;
    let heightIn = widthIn / aspect;
    if (heightIn > maxHeightIn) {
      heightIn = maxHeightIn;
      widthIn = heightIn * aspect;
    }
    if (widthIn > maxWidthIn) {
      widthIn = maxWidthIn;
      heightIn = widthIn / aspect;
    }
    const finalWidthIn = Math.max(1.2, Math.min(maxWidthIn, widthIn));
    const finalHeightIn = Math.max(1.2, Math.min(maxHeightIn, heightIn));
    const cx = Math.round(finalWidthIn * 914400);
    const cy = Math.round(finalHeightIn * 914400);
    // Keep non-visual metadata simple and ASCII-safe for maximum Word compatibility.
    const rawName = String(input.title || 'Generated visual').replace(/\s+/g, ' ').trim();
    const rawDescr = String(input.desc || input.title || 'Generated visual').replace(/\s+/g, ' ').trim();
    const name = this.escapeXml(this.stripInvalidXmlChars(rawName).slice(0, 80) || 'Generated visual');
    const descr = this.escapeXml(this.stripInvalidXmlChars(rawDescr).slice(0, 160) || 'Generated visual');
    const relId = this.escapeXml(input.relId);
    const docPrId = Math.max(1, Number(input.docPrId || 1));
    const align = String(input.alignment || 'center').toLowerCase() === 'left' ? 'left' : 'center';
    // Follow the canonical WordprocessingML DrawingML picture shape expected by Word.
    return `<w:p><w:pPr><w:spacing w:before="120" w:after="120"/><w:jc w:val="${align}"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docPrId}" name="${name}" descr="${descr}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${name}" descr="${descr}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  }

  private buildCaptionParagraph(input: { captionText: string; alignment?: string }): string {
    const text = this.escapeXml(this.stripInvalidXmlChars(String(input.captionText || '').trim()));
    const align = String(input.alignment || 'center').toLowerCase() === 'left' ? 'left' : 'center';
    return `<w:p><w:pPr><w:spacing w:before="20" w:after="120"/><w:jc w:val="${align}"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/><w:color w:val="666666"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  }

  private resolvePlanCaption(visual: any, visualType: string, maxChars: number): string {
    const sanitize = (value: any) => String(value || '')
      .replace(/`{1,3}/g, '')
      .replace(/\*\*/g, '')
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/\r?\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const truncate = (value: string) => {
      const text = sanitize(value);
      if (!text) return '';
      if (text.length <= maxChars) return text;
      const slice = text.slice(0, maxChars + 1);
      const cut = slice.lastIndexOf(' ');
      const out = cut > 48 ? slice.slice(0, cut) : text.slice(0, maxChars);
      return `${out.trim()}...`;
    };
    const typeLabel = (() => {
      const t = String(visualType || '').toLowerCase();
      if (t === 'flowchart') return 'Flowchart';
      if (t === 'data_viz') return 'Data view';
      if (t === 'sourced_image') return 'Illustration';
      if (t === 'aesthetic_anchor') return 'Visual context';
      return 'Figure';
    })();
    const explicit = truncate(visual?.caption_text);
    if (explicit) return explicit;
    const title = sanitize(visual?.title || 'Document concept');
    const purpose = sanitize(visual?.purpose || '');
    const sectionMatch = sanitize(visual?.context || '').match(/section\s+"([^"]+)"/i);
    const section = sanitize(sectionMatch?.[1] || '');
    return truncate([`${typeLabel}:`, title, purpose ? `- ${purpose}` : '', section ? `(section: ${section})` : ''].filter(Boolean).join(' '));
  }

  private ensureDrawingNamespaces(docXml: string): string {
    const namespaces: Array<{ prefix: string; uri: string }> = [
      { prefix: 'r', uri: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships' },
      { prefix: 'wp', uri: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing' },
      { prefix: 'a', uri: 'http://schemas.openxmlformats.org/drawingml/2006/main' },
      { prefix: 'pic', uri: 'http://schemas.openxmlformats.org/drawingml/2006/picture' },
    ];
    const openTagMatch = String(docXml || '').match(/<w:document\b[^>]*>/);
    if (!openTagMatch?.[0]) return docXml;
    let openTag = openTagMatch[0];
    for (const ns of namespaces) {
      const attr = `xmlns:${ns.prefix}=`;
      if (openTag.includes(attr)) continue;
      openTag = openTag.replace(/>$/, ` xmlns:${ns.prefix}="${ns.uri}">`);
    }
    return docXml.replace(openTagMatch[0], openTag);
  }
}
