import { PlannedVisualization } from '../planning/visual-manifest.types';

export type DocxWrapMode = 'inline' | 'square';

export type DocxDisplayPolicy = {
  max_width_in: number;
  max_height_in: number;
  preferred_width_in: number;
  wrap_mode: DocxWrapMode;
};

const DEFAULT_POLICY: DocxDisplayPolicy = {
  max_width_in: 4.5,
  max_height_in: 4.5,
  preferred_width_in: 4.2,
  wrap_mode: 'square',
};

const TYPE_POLICY: Partial<Record<PlannedVisualization['type'], DocxDisplayPolicy>> = {
  infographic: { max_width_in: 4.8, max_height_in: 4.8, preferred_width_in: 4.5, wrap_mode: 'square' },
  data_viz: { max_width_in: 5.2, max_height_in: 4.2, preferred_width_in: 4.8, wrap_mode: 'square' },
  flowchart: { max_width_in: 5.5, max_height_in: 4.8, preferred_width_in: 5.0, wrap_mode: 'square' },
  sourced_image: { max_width_in: 4.8, max_height_in: 4.8, preferred_width_in: 4.4, wrap_mode: 'square' },
  aesthetic_anchor: { max_width_in: 4.2, max_height_in: 4.2, preferred_width_in: 3.8, wrap_mode: 'square' },
};

export function getDocxDisplayPolicy(visualType: PlannedVisualization['type']): DocxDisplayPolicy {
  return TYPE_POLICY[visualType] || DEFAULT_POLICY;
}

