export type ChartRole = 'comparison' | 'trend' | 'composition' | 'spotlight' | 'distribution';

export type DocumentTone = 'executive' | 'educational' | 'technical' | 'narrative';

export type ChartStyleTokens = {
  surface: { background: string; border: string; radius: number };
  type: { titleFamily: string; bodyFamily: string; titleSize: number; axisSize: number; annotationSize: number };
  color: { textPrimary: string; textSecondary: string; grid: string; emphasis: string; palette: string[] };
  axis: { showDomain: boolean; tickSize: number; labelRotation: number; gridOpacity: number };
  mark: { barRadius: number; lineWidth: number; pointSize: number; valueLabels: boolean; multicolorByDatum: boolean; pseudo3dBars: boolean };
  annotation: { enabled: boolean; benchmarkLine: boolean; directLabels: boolean };
};

export type DocumentChartStyleDecision = {
  profile_id: string;
  tone: DocumentTone;
  density: 'low' | 'medium' | 'high';
  energy: 'restrained' | 'balanced' | 'vivid';
  surface: 'light' | 'dark';
  trust_mode: 'conservative' | 'modern' | 'expressive';
  chart_family: 'executive_clean' | 'field_guide' | 'technical_slate' | 'editorial_spotlight';
  chart_theme_id: string;
  tokens: ChartStyleTokens;
};
