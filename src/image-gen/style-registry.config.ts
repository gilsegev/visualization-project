import { THEME_LIBRARY, Theme } from './themes.config';

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
  const typo = globalStyle?.typography || {};
  const primaryFont = typo?.fontFamily?.[0] || base.font_name || 'Inter';

  return {
    ...base,
    primary_accent: palette[0] || base.primary_accent,
    secondary_accent: palette[1] || base.secondary_accent || base.primary_accent,
    background_main: palette[4] || base.background_main,
    text_main: palette[5] || base.text_main,
    text_secondary: base.text_secondary || base.text_main,
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
