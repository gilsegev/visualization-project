export interface ParagraphNode {
  xml_path_id: string;
  paragraph_hash: string;
  text: string;
  index: number;
  has_sequence: boolean;
  has_data: boolean;
  has_entity: boolean;
  text_density: number;
  sequence_group_id?: string | null;
}

export interface SectionNode {
  section_id: string;
  heading: string;
  paragraph_start: number;
  paragraph_end: number;
}

export interface AnchorCandidate {
  anchor_id: string;
  xml_path_id: string;
  paragraph_hash: string;
  paragraph_index: number;
  confidence: number;
  reason: string;
}

export interface ContextWindow {
  anchor_id: string;
  before_chars: number;
  after_chars: number;
  content: string;
  paragraph_start_index: number;
  paragraph_end_index: number;
  window_mode: 'bounded' | 'sequence_expanded';
}

export interface DocumentAnalysisResult {
  paragraphs: ParagraphNode[];
  sections: SectionNode[];
  anchors: AnchorCandidate[];
  context_windows?: ContextWindow[];
  used_fallback_anchor_mode: boolean;
}
