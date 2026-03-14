export type PlacementScope = 'after_anchor' | 'after_list_block' | 'section_intro_body' | 'section_end';
export type PlacementAlignment = 'center' | 'left';
export type ChartRole = 'comparison' | 'trend' | 'composition' | 'spotlight' | 'distribution';

export interface PlannedVisualizationPlacement {
  scope: PlacementScope;
  priority: number;
  avoid_headings: boolean;
  avoid_list_split: boolean;
  max_width_in?: number;
  max_height_in?: number;
  alignment?: PlacementAlignment;
}

export interface PlannedVisualization {
  type: 'infographic' | 'sourced_image' | 'data_viz' | 'flowchart' | 'aesthetic_anchor';
  anchor_id: string;
  placement: PlannedVisualizationPlacement;
  title: string;
  description: string;
  context: string;
  purpose: string;
  caption_text?: string;
  caption_mode?: 'auto' | 'explicit';
  prompt_template?: string;
  mermaid_code?: string;
  mermaid_valid?: boolean;
  fallback_reason?: string;
  data_points?: Array<{ label: string; value: number }>;
  evidence_spans?: string[];
  chart_role?: ChartRole;
  chart_family?: 'default' | 'editorial_spotlight_bar';
  renderer_hint?: 'echarts' | 'd3';
}

export interface PlannedLesson {
  lessonId: string;
  title: string;
  visualizations: PlannedVisualization[];
}

export interface DocumentVisualManifest {
  course: {
    title: string;
    targetAudience: string;
  };
  lessons: PlannedLesson[];
  metadata: {
    manifest_version: 1;
    job_id: string;
    generated_at: string;
  };
}

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
}
