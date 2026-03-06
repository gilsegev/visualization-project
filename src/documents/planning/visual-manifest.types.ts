export interface PlannedVisualization {
  type: 'infographic' | 'sourced_image' | 'data_viz' | 'flowchart' | 'aesthetic_anchor';
  title: string;
  description: string;
  context: string;
  purpose: string;
  prompt_template?: string;
  mermaid_code?: string;
  mermaid_valid?: boolean;
  fallback_reason?: string;
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
