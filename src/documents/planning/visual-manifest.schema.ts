import { DocumentVisualManifest, ManifestValidationResult, PlannedVisualization } from './visual-manifest.types';

function isNonEmpty(v: any, max = 4000): boolean {
  const s = String(v || '').trim();
  return s.length > 0 && s.length <= max;
}

function validateVisualization(
  v: PlannedVisualization,
  path: string,
  errors: string[],
  anchorIds?: Set<string>
): void {
  if (!['infographic', 'sourced_image', 'data_viz', 'flowchart', 'aesthetic_anchor'].includes(String(v?.type || ''))) {
    errors.push(`${path}.type is invalid`);
  }
  if (!isNonEmpty(v?.anchor_id, 120)) errors.push(`${path}.anchor_id is invalid`);
  if (anchorIds && isNonEmpty(v?.anchor_id, 120) && !anchorIds.has(String(v.anchor_id))) {
    errors.push(`${path}.anchor_id not found in analysis anchors`);
  }
  const scope = String(v?.placement?.scope || '');
  if (!['after_anchor', 'after_list_block', 'section_intro_body', 'section_end'].includes(scope)) {
    errors.push(`${path}.placement.scope is invalid`);
  }
  const priority = Number(v?.placement?.priority);
  if (!Number.isFinite(priority) || priority < 1 || priority > 100) {
    errors.push(`${path}.placement.priority must be 1..100`);
  }
  if (typeof v?.placement?.avoid_headings !== 'boolean') {
    errors.push(`${path}.placement.avoid_headings must be boolean`);
  }
  if (typeof v?.placement?.avoid_list_split !== 'boolean') {
    errors.push(`${path}.placement.avoid_list_split must be boolean`);
  }
  if (v?.placement?.max_width_in != null) {
    const n = Number(v.placement.max_width_in);
    if (!Number.isFinite(n) || n < 1 || n > 8.5) errors.push(`${path}.placement.max_width_in is invalid`);
  }
  if (v?.placement?.max_height_in != null) {
    const n = Number(v.placement.max_height_in);
    if (!Number.isFinite(n) || n < 1 || n > 11) errors.push(`${path}.placement.max_height_in is invalid`);
  }
  if (v?.placement?.alignment != null && !['center', 'left'].includes(String(v.placement.alignment))) {
    errors.push(`${path}.placement.alignment is invalid`);
  }
  if (!isNonEmpty(v?.title, 300)) errors.push(`${path}.title is invalid`);
  if (!isNonEmpty(v?.description, 4000)) errors.push(`${path}.description is invalid`);
  if (!isNonEmpty(v?.context, 4000)) errors.push(`${path}.context is invalid`);
  if (!isNonEmpty(v?.purpose, 4000)) errors.push(`${path}.purpose is invalid`);
  if (v?.caption_text != null && !isNonEmpty(v?.caption_text, 260)) errors.push(`${path}.caption_text is invalid`);
  if (v?.caption_mode != null && !['auto', 'explicit'].includes(String(v?.caption_mode))) {
    errors.push(`${path}.caption_mode is invalid`);
  }
  if (v?.prompt_template != null && !isNonEmpty(v?.prompt_template, 4000)) errors.push(`${path}.prompt_template is invalid`);
  if (v?.mermaid_code != null && !isNonEmpty(v?.mermaid_code, 4000)) errors.push(`${path}.mermaid_code is invalid`);
  if (v?.mermaid_valid != null && typeof v.mermaid_valid !== 'boolean') errors.push(`${path}.mermaid_valid must be boolean`);
  if (v?.fallback_reason != null && !isNonEmpty(v?.fallback_reason, 1000)) errors.push(`${path}.fallback_reason is invalid`);
  if (v?.data_points != null) {
    if (!Array.isArray(v.data_points)) {
      errors.push(`${path}.data_points must be an array`);
    } else {
      v.data_points.forEach((point: any, idx: number) => {
        const pointPath = `${path}.data_points[${idx}]`;
        if (!isNonEmpty(point?.label, 64)) errors.push(`${pointPath}.label is invalid`);
        const value = Number(point?.value);
        if (!Number.isFinite(value)) errors.push(`${pointPath}.value must be numeric`);
      });
    }
  }
  if (v?.evidence_spans != null) {
    if (!Array.isArray(v.evidence_spans)) {
      errors.push(`${path}.evidence_spans must be an array`);
    } else {
      v.evidence_spans.forEach((span: any, idx: number) => {
        if (!isNonEmpty(span, 600)) errors.push(`${path}.evidence_spans[${idx}] is invalid`);
      });
    }
  }
  if (v?.chart_role != null && !['comparison', 'trend', 'composition', 'spotlight', 'distribution'].includes(String(v.chart_role))) {
    errors.push(`${path}.chart_role is invalid`);
  }
  if (v?.chart_family != null && !['default', 'editorial_spotlight_bar'].includes(String(v.chart_family))) {
    errors.push(`${path}.chart_family is invalid`);
  }
  if (v?.renderer_hint != null && !['echarts', 'd3'].includes(String(v.renderer_hint))) {
    errors.push(`${path}.renderer_hint is invalid`);
  }
}

export function validateDocumentVisualManifest(
  manifest: DocumentVisualManifest,
  opts?: { anchorIds?: string[] }
): ManifestValidationResult {
  const errors: string[] = [];
  const anchorIds = new Set((opts?.anchorIds || []).map((a) => String(a || '').trim()).filter(Boolean));
  if (!isNonEmpty(manifest?.course?.title, 300)) errors.push('course.title is invalid');
  if (!isNonEmpty(manifest?.course?.targetAudience, 200)) errors.push('course.targetAudience is invalid');
  if (!Array.isArray(manifest?.lessons) || !manifest.lessons.length) errors.push('lessons must be non-empty');

  (manifest?.lessons || []).forEach((lesson, i) => {
    const root = `lessons[${i}]`;
    if (!isNonEmpty(lesson?.lessonId, 120)) errors.push(`${root}.lessonId is invalid`);
    if (!isNonEmpty(lesson?.title, 300)) errors.push(`${root}.title is invalid`);
    if (!Array.isArray(lesson?.visualizations) || !lesson.visualizations.length) {
      errors.push(`${root}.visualizations must be non-empty`);
    } else {
      lesson.visualizations.forEach((v, j) =>
        validateVisualization(v, `${root}.visualizations[${j}]`, errors, anchorIds.size ? anchorIds : undefined)
      );
    }
  });

  if (manifest?.metadata?.manifest_version !== 1) errors.push('metadata.manifest_version must equal 1');
  if (!isNonEmpty(manifest?.metadata?.job_id, 120)) errors.push('metadata.job_id is invalid');
  if (!isNonEmpty(manifest?.metadata?.generated_at, 120)) errors.push('metadata.generated_at is invalid');

  return { valid: errors.length === 0, errors };
}
