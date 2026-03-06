import { DocumentVisualManifest, ManifestValidationResult, PlannedVisualization } from './visual-manifest.types';

function isNonEmpty(v: any, max = 4000): boolean {
  const s = String(v || '').trim();
  return s.length > 0 && s.length <= max;
}

function validateVisualization(v: PlannedVisualization, path: string, errors: string[]): void {
  if (!['infographic', 'sourced_image', 'data_viz', 'flowchart', 'aesthetic_anchor'].includes(String(v?.type || ''))) {
    errors.push(`${path}.type is invalid`);
  }
  if (!isNonEmpty(v?.title, 300)) errors.push(`${path}.title is invalid`);
  if (!isNonEmpty(v?.description, 4000)) errors.push(`${path}.description is invalid`);
  if (!isNonEmpty(v?.context, 4000)) errors.push(`${path}.context is invalid`);
  if (!isNonEmpty(v?.purpose, 4000)) errors.push(`${path}.purpose is invalid`);
  if (v?.prompt_template != null && !isNonEmpty(v?.prompt_template, 4000)) errors.push(`${path}.prompt_template is invalid`);
  if (v?.mermaid_code != null && !isNonEmpty(v?.mermaid_code, 4000)) errors.push(`${path}.mermaid_code is invalid`);
  if (v?.mermaid_valid != null && typeof v.mermaid_valid !== 'boolean') errors.push(`${path}.mermaid_valid must be boolean`);
  if (v?.fallback_reason != null && !isNonEmpty(v?.fallback_reason, 1000)) errors.push(`${path}.fallback_reason is invalid`);
}

export function validateDocumentVisualManifest(manifest: DocumentVisualManifest): ManifestValidationResult {
  const errors: string[] = [];
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
      lesson.visualizations.forEach((v, j) => validateVisualization(v, `${root}.visualizations[${j}]`, errors));
    }
  });

  if (manifest?.metadata?.manifest_version !== 1) errors.push('metadata.manifest_version must equal 1');
  if (!isNonEmpty(manifest?.metadata?.job_id, 120)) errors.push('metadata.job_id is invalid');
  if (!isNonEmpty(manifest?.metadata?.generated_at, 120)) errors.push('metadata.generated_at is invalid');

  return { valid: errors.length === 0, errors };
}
