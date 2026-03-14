import { THEME_LIBRARY, Theme } from './themes.config';
import { ChartRole, ChartStyleTokens, DocumentChartStyleDecision } from './chart-style.types';

export interface StyleProfile {
  id: string;
  label: string;
  match_keywords: string[];
  assets: {
    infographics: { theme_id: string };
    charts: { chart_theme_id: string };
    generated_images: { image_style_suffix: string };
    sourced_images: { image_style_suffix: string };
  };
}

export interface StyleSelection {
  profile: StyleProfile;
  infographicThemeId: string;
  chartThemeId: string;
  generatedImageStyleSuffix: string;
  sourcedImageStyleSuffix: string;
  styleDecision: DocumentChartStyleDecision;
  documentChartStyleDecision: DocumentChartStyleDecision;
  chartStyleTokens: ChartStyleTokens;
}

export const STYLE_REGISTRY: Record<string, StyleProfile> = {
  harbor_mist_system: {
    id: 'harbor_mist_system',
    label: 'Harbor Mist',
    match_keywords: ['professional', 'trustworthy', 'clean', 'reference', 'compliance', 'checklist'],
    assets: {
      infographics: { theme_id: 'harbor_mist' },
      charts: { chart_theme_id: 'chart_harbor' },
      generated_images: { image_style_suffix: 'clean editorial illustration, balanced whitespace, practical and calm, high readability' },
      sourced_images: { image_style_suffix: 'clean documentary photo style, calm composition, natural light, readable subject focus' },
    },
  },
  field_manual_system: {
    id: 'field_manual_system',
    label: 'Field Manual',
    match_keywords: ['outdoors', 'practical', 'fishing', 'nature', 'guide', 'field'],
    assets: {
      infographics: { theme_id: 'field_manual' },
      charts: { chart_theme_id: 'chart_field' },
      generated_images: { image_style_suffix: 'outdoor field-guide illustration, practical iconography, restrained color, high clarity' },
      sourced_images: { image_style_suffix: 'authentic outdoor documentary photo, practical gear context, non-staged natural light' },
    },
  },
  slate_signal_system: {
    id: 'slate_signal_system',
    label: 'Slate Signal',
    match_keywords: ['technical', 'architecture', 'processor', 'rtl', 'engineering', 'system'],
    assets: {
      infographics: { theme_id: 'slate_signal' },
      charts: { chart_theme_id: 'chart_slate' },
      generated_images: { image_style_suffix: 'high-clarity technical illustration, modern geometric forms, strong hierarchy' },
      sourced_images: { image_style_suffix: 'clear technical documentary photo, uncluttered frame, subject-first composition' },
    },
  },
  tidepool_contrast_system: {
    id: 'tidepool_contrast_system',
    label: 'Tidepool Contrast',
    match_keywords: ['wellness', 'mindfulness', 'stress', 'therapy', 'calm', 'breathing'],
    assets: {
      infographics: { theme_id: 'tidepool_contrast' },
      charts: { chart_theme_id: 'chart_tidepool' },
      generated_images: { image_style_suffix: 'calm wellness illustration, soft contrast, clear figure-ground separation, text-free symbolism' },
      sourced_images: { image_style_suffix: 'gentle lifestyle photo, calm mood, natural tones, respectful human-centered framing' },
    },
  },
  paper_ledger_system: {
    id: 'paper_ledger_system',
    label: 'Paper Ledger',
    match_keywords: ['history', 'timeline', 'story', 'culture', 'overview', 'learning'],
    assets: {
      infographics: { theme_id: 'paper_ledger' },
      charts: { chart_theme_id: 'chart_ledger' },
      generated_images: { image_style_suffix: 'print-inspired educational illustration, tidy composition, conservative contrast' },
      sourced_images: { image_style_suffix: 'editorial documentary photo, clear central subject, minimal distractions' },
    },
  },
  midnight_contrast_system: {
    id: 'midnight_contrast_system',
    label: 'Midnight Contrast',
    match_keywords: ['dark', 'night', 'contrast', 'neon', 'high contrast'],
    assets: {
      infographics: { theme_id: 'midnight_contrast' },
      charts: { chart_theme_id: 'chart_midnight_neon' },
      generated_images: { image_style_suffix: 'dark high-contrast educational illustration, luminous accents, strong figure-ground separation' },
      sourced_images: { image_style_suffix: 'moody documentary photo, dark-toned but readable, clear subject separation, cinematic contrast' },
    },
  },
  noir_signal_system: {
    id: 'noir_signal_system',
    label: 'Noir Signal',
    match_keywords: ['dramatic', 'cinematic', 'noir', 'futuristic', 'signal'],
    assets: {
      infographics: { theme_id: 'noir_signal' },
      charts: { chart_theme_id: 'chart_blueprint_grid' },
      generated_images: { image_style_suffix: 'dramatic dark technical illustration, crisp edges, controlled glow highlights' },
      sourced_images: { image_style_suffix: 'dark editorial photo style, controlled highlights, uncluttered foreground subject' },
    },
  },
  aurora_slate_system: {
    id: 'aurora_slate_system',
    label: 'Aurora Slate',
    match_keywords: ['modern', 'vivid', 'colorful', 'playful', 'dynamic'],
    assets: {
      infographics: { theme_id: 'aurora_slate' },
      charts: { chart_theme_id: 'chart_candy_3d' },
      generated_images: { image_style_suffix: 'dynamic modern illustration, varied accent colors, playful but readable composition' },
      sourced_images: { image_style_suffix: 'vivid but clean documentary photo, clear main subject, balanced scene depth' },
    },
  },
};

export function resolveStyleProfileForManifest(manifest: any): StyleProfile {
  const requestedProfileId = String(
    manifest?.course?.styling?.system?.profile_id
    || manifest?.course?.styling?.profile_id
    || ''
  ).trim();
  if (requestedProfileId && STYLE_REGISTRY[requestedProfileId]) {
    return STYLE_REGISTRY[requestedProfileId];
  }

  const course = manifest?.course || {};
  const guide = course?.globalStyleGuide || {};
  const lessonTitles = Array.isArray(manifest?.lessons)
    ? manifest.lessons.map((l: any) => String(l?.title || '')).join(' ')
    : '';
  const context = [
    String(course?.title || ''),
    String(course?.designPhilosophy || ''),
    String(course?.targetAudience || ''),
    String(guide?.mood || ''),
    String(guide?.illustrationStyle?.design || ''),
    lessonTitles,
  ].join(' ').toLowerCase();

  let best = STYLE_REGISTRY.field_manual_system;
  let bestScore = -1;
  for (const profile of Object.values(STYLE_REGISTRY)) {
    const score = profile.match_keywords.reduce((acc, k) => acc + (context.includes(k) ? 1 : 0), 0);
    if (score > bestScore) {
      best = profile;
      bestScore = score;
    }
  }
  return best;
}

export function resolveStyleSelection(manifest: any, viz: any): StyleSelection {
  const profile = resolveStyleProfileForManifest(manifest);
  const courseStyling = manifest?.course?.styling?.system || manifest?.course?.styling || {};
  const vizStyling = viz?.styling || {};

  const infographicThemeId =
    String(vizStyling?.infographic_theme_id || '').trim()
    || String(viz?.metadata?.theme_id || viz?.theme_id || '').trim()
    || String(courseStyling?.infographic_theme_id || '').trim()
    || profile.assets.infographics.theme_id;

  const chartThemeId =
    String(vizStyling?.chart_theme_id || '').trim()
    || String(viz?.metadata?.chart_theme_id || viz?.chart_theme_id || '').trim()
    || String(courseStyling?.chart_theme_id || '').trim()
    || profile.assets.charts.chart_theme_id;

  const generatedImageStyleSuffix =
    String(vizStyling?.generated_image_style_suffix || '').trim()
    || String(courseStyling?.generated_image_style_suffix || '').trim()
    || profile.assets.generated_images.image_style_suffix;

  const sourcedImageStyleSuffix =
    String(vizStyling?.sourced_image_style_suffix || '').trim()
    || String(courseStyling?.sourced_image_style_suffix || '').trim()
    || profile.assets.sourced_images.image_style_suffix;

  const chartRole = ['comparison', 'trend', 'composition', 'spotlight', 'distribution'].includes(String(viz?.chart_role || ''))
    ? viz.chart_role as ChartRole
    : 'comparison';
  const styleDecision = resolveDocumentChartStyleDecision(manifest, viz, profile, chartThemeId);
  const chartStyleTokens = resolveChartStyleTokens(styleDecision.chart_theme_id, chartRole, styleDecision.chart_family);

  return {
    profile,
    infographicThemeId,
    chartThemeId,
    generatedImageStyleSuffix,
    sourcedImageStyleSuffix,
    styleDecision,
    documentChartStyleDecision: {
      ...styleDecision,
      tokens: chartStyleTokens,
    },
    chartStyleTokens,
  };
}

export function resolveDocumentChartStyleDecision(
  manifest: any,
  viz: any,
  profile = resolveStyleProfileForManifest(manifest),
  chartThemeId = String(viz?.metadata?.chart_theme_id || viz?.chart_theme_id || profile.assets.charts.chart_theme_id).trim(),
): DocumentChartStyleDecision {
  const context = [
    String(manifest?.course?.title || ''),
    String(manifest?.course?.targetAudience || ''),
    String(manifest?.course?.designPhilosophy || ''),
    String(manifest?.course?.globalStyleGuide?.mood || ''),
    String(viz?.title || ''),
    String(viz?.purpose || ''),
  ].join(' ').toLowerCase();
  const surface = /midnight|dark|noir|night|neon/.test(profile.id) ? 'dark' : 'light';
  const tone =
    /technical|engineering|system|architecture/.test(context) ? 'technical'
    : /story|history|culture|narrative/.test(context) ? 'narrative'
    : /guide|learning|education|field|document readers/.test(context) ? 'educational'
    : 'executive';
  const energy = /playful|dynamic|vivid|contrast|neon/.test(context) ? 'vivid' : tone === 'executive' ? 'restrained' : 'balanced';
  const density = /overview|summary|executive/.test(context) ? 'low' : /technical|reference|compliance|detailed/.test(context) ? 'high' : 'medium';
  const chart_family =
    tone === 'technical' ? 'technical_slate'
    : tone === 'educational' ? 'field_guide'
    : tone === 'narrative' ? 'editorial_spotlight'
    : 'executive_clean';
  return {
    profile_id: profile.id,
    tone,
    density,
    energy,
    surface,
    trust_mode: tone === 'executive' ? 'conservative' : tone === 'technical' ? 'modern' : 'expressive',
    chart_family,
    chart_theme_id: chartThemeId || profile.assets.charts.chart_theme_id,
    tokens: resolveChartStyleTokens(chartThemeId || profile.assets.charts.chart_theme_id, 'comparison', chart_family),
  };
}

export function resolveChartStyleTokens(chartThemeId: string, chartRole: ChartRole = 'comparison', chartFamily?: DocumentChartStyleDecision['chart_family']): ChartStyleTokens {
  const theme = THEME_LIBRARY[chartThemeId.replace(/^chart_/, '') as keyof typeof THEME_LIBRARY] || THEME_LIBRARY.corp_blue;
  const dark = /^#0|^#1/i.test(String(theme.background_main || ''));
  const tokens: ChartStyleTokens = {
    surface: { background: theme.background_main, border: theme.primary_accent, radius: 14 },
    type: { titleFamily: theme.font_name, bodyFamily: theme.font_name, titleSize: 30, axisSize: 13, annotationSize: 12 },
    color: {
      textPrimary: theme.text_main,
      textSecondary: theme.text_secondary || theme.text_main,
      grid: theme.text_secondary || theme.text_main,
      emphasis: theme.secondary_accent || theme.primary_accent,
      palette: [theme.primary_accent, theme.secondary_accent || theme.primary_accent, '#4A7EC1', '#D7A34A', '#5A635C'],
    },
    axis: { showDomain: false, tickSize: 0, labelRotation: 0, gridOpacity: dark ? 0.18 : 0.25 },
    mark: { barRadius: 10, lineWidth: 3, pointSize: 8, valueLabels: false, multicolorByDatum: false, pseudo3dBars: false },
    annotation: { enabled: chartFamily === 'editorial_spotlight', benchmarkLine: false, directLabels: chartRole === 'trend' || chartFamily === 'editorial_spotlight' },
  };
  if (chartRole === 'trend') tokens.mark = { ...tokens.mark, lineWidth: 3.5, pointSize: 9 };
  if (chartRole === 'composition') tokens.mark = { ...tokens.mark, multicolorByDatum: true };
  if (chartRole === 'spotlight' || chartFamily === 'editorial_spotlight') {
    tokens.mark = { ...tokens.mark, valueLabels: true };
    tokens.color.palette = [tokens.color.emphasis, '#A7B9D3', '#D8E1EC', '#E7EDF5', '#EEF3F8'];
  }
  if (chartFamily === 'field_guide') tokens.mark = { ...tokens.mark, valueLabels: true };
  return tokens;
}

export function buildCustomThemeForPayload(
  profile: StyleProfile,
  globalStyle: any,
  designPhilosophy: string,
  baseThemeId?: string,
): Theme {
  const themeId = baseThemeId || profile.assets.infographics.theme_id;
  const base = THEME_LIBRARY[themeId] || THEME_LIBRARY.corp_blue;
  const paletteObj = globalStyle?.colorPalette || {};
  const palette = Object.values(paletteObj)
    .map((v) => String(v).trim())
    .filter((v) => /^#[0-9a-f]{3,8}$/i.test(v));
  const colorKeys = Object.fromEntries(
    Object.entries(paletteObj || {}).map(([k, v]) => [String(k).toLowerCase(), String(v).trim()])
  ) as Record<string, string>;
  const typo = globalStyle?.typography || {};
  const primaryFont = typo?.fontFamily?.[0] || base.font_name || 'Inter';

  const pickByKey = (keys: string[]): string | null => {
    for (const [k, v] of Object.entries(colorKeys)) {
      if (!/^#[0-9a-f]{3,8}$/i.test(v)) continue;
      if (keys.some((needle) => k.includes(needle))) return v;
    }
    return null;
  };

  const backgroundCandidate = pickByKey(['background', 'bg', 'midnight', 'ink', 'deep', 'navy', 'black', 'charcoal']);
  const textCandidate = pickByKey(['text', 'softtext', 'paper', 'white', 'light', 'ivory']);
  const primaryCandidate = pickByKey(['primary', 'accent', 'neon', 'signal', 'teal', 'blue', 'cyan']);
  const secondaryCandidate = pickByKey(['secondary', 'warm', 'orange', 'amber', 'gold', 'coral', 'pink']);

  const background = backgroundCandidate || base.background_main;
  let textMain = textCandidate || base.text_main;
  const primaryAccent = primaryCandidate || palette[0] || base.primary_accent;
  const secondaryAccent = secondaryCandidate || palette[1] || base.secondary_accent || base.primary_accent;

  const luminance = (hex: string): number => {
    const normalized = String(hex || '').replace('#', '').trim();
    if (!/^[0-9a-f]{3,8}$/i.test(normalized)) return 0.5;
    const full = normalized.length === 3
      ? normalized.split('').map((c) => c + c).join('')
      : normalized.slice(0, 6);
    const r = parseInt(full.slice(0, 2), 16) / 255;
    const g = parseInt(full.slice(2, 4), 16) / 255;
    const b = parseInt(full.slice(4, 6), 16) / 255;
    const f = (x: number) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  const contrastRatio = (a: string, b: string): number => {
    const la = luminance(a);
    const lb = luminance(b);
    const [L1, L2] = la > lb ? [la, lb] : [lb, la];
    return (L1 + 0.05) / (L2 + 0.05);
  };

  // Ensure readable body text regardless of payload palette choices.
  if (contrastRatio(background, textMain) < 4.5) {
    textMain = luminance(background) < 0.35 ? '#EAF2FF' : '#1A2433';
  }

  return {
    ...base,
    primary_accent: primaryAccent,
    secondary_accent: secondaryAccent,
    background_main: background,
    text_main: textMain,
    text_secondary: base.text_secondary || textMain,
    font_name: primaryFont,
    font_family: /^https?:\/\//i.test(primaryFont)
      ? primaryFont
      : `https://fonts.googleapis.com/css2?family=${String(primaryFont).trim().replace(/\s+/g, '+')}:wght@400;700;800&display=swap`,
    font_size_heading: base.font_size_heading || '2rem',
    font_size_body: base.font_size_body || '1rem',
    image_style_suffix: `${profile.assets.generated_images.image_style_suffix}. ${designPhilosophy || ''}`.trim(),
    glass_color: base.glass_color || 'rgba(255, 255, 255, 0.72)',
  };
}
