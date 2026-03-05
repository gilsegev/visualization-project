export interface ParagraphNode {
  xml_path_id: string;
  paragraph_hash: string;
  text: string;
  index: number;
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
}

export interface DocumentAnalysisResult {
  paragraphs: ParagraphNode[];
  sections: SectionNode[];
  anchors: AnchorCandidate[];
  used_fallback_anchor_mode: boolean;
}
