export interface Theme {
    primary_accent: string;
    secondary_accent?: string;
    background_main: string;
    text_main: string;
    text_secondary?: string;
    font_family: string;
    font_name: string;
    font_size_heading?: string;
    font_size_body?: string;
    image_style_suffix: string;
    glass_color: string;
}

export const THEME_LIBRARY: Record<string, Theme> = {
    cyber_neon: {
        primary_accent: '#00f3ff',
        background_main: '#09090b', // zinc-950
        text_main: '#e4e4e7',       // zinc-200
        font_family: 'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&display=swap',
        font_name: 'Orbitron',
        image_style_suffix: 'cyberpunk aesthetic, neon lighting, dark background, futuristic, glowing accents, volumetric fog',
        glass_color: 'rgba(0, 0, 0, 0.6)'
    },
    corp_blue: {
        primary_accent: '#2563eb',  // blue-600
        background_main: '#ffffff',
        text_main: '#1e293b',       // slate-800
        font_family: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap',
        font_name: 'Inter',
        image_style_suffix: 'corporate memphis style, clean vector art, flat design, professional, white background, minimalist',
        glass_color: 'rgba(255, 255, 255, 0.8)'
    },
    nature_fresh: {
        primary_accent: '#16a34a',  // green-600
        background_main: '#fcfbf9', // warm cream
        text_main: '#292524',       // stone-800
        font_family: 'https://fonts.googleapis.com/css2?family=Quicksand:wght@400;700&display=swap',
        font_name: 'Quicksand',
        image_style_suffix: 'minimalist vector icon, ample whitespace around subject, organic style, soft lighting, botanical details',
        glass_color: 'rgba(255, 255, 255, 0.7)'
    },
    warm_creative: {
        primary_accent: '#f59e0b',  // amber-500
        background_main: '#fffbeb', // amber-50
        text_main: '#451a03',       // amber-950
        font_family: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&display=swap',
        font_name: 'Playfair Display',
        image_style_suffix: 'playful 3D style, warm lighting, round shapes, vibrant colors, claymorphism, cheerful',
        glass_color: 'rgba(255, 255, 255, 0.6)'
    },
    harbor_mist: {
        primary_accent: '#2F6F7E',
        secondary_accent: '#E39B6D',
        background_main: '#F2F6F7',
        text_main: '#123646',
        text_secondary: '#3B5560',
        font_family: 'https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&display=swap',
        font_name: 'Source Sans 3',
        font_size_heading: '2rem',
        font_size_body: '1rem',
        image_style_suffix: 'clean editorial vector style, soft contrast, readable hierarchy, balanced whitespace',
        glass_color: 'rgba(255, 255, 255, 0.75)'
    },
    field_manual: {
        primary_accent: '#3B7A57',
        secondary_accent: '#D7A34A',
        background_main: '#FAF7EF',
        text_main: '#2A342D',
        text_secondary: '#5A635C',
        font_family: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&display=swap',
        font_name: 'IBM Plex Sans',
        font_size_heading: '1.95rem',
        font_size_body: '1rem',
        image_style_suffix: 'educational field-guide style, crisp labels, practical iconography, natural tones',
        glass_color: 'rgba(255, 255, 255, 0.72)'
    },
    slate_signal: {
        primary_accent: '#2E5FA7',
        secondary_accent: '#E0703C',
        background_main: '#F4F7FB',
        text_main: '#1C2A3A',
        text_secondary: '#4E6075',
        font_family: 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&display=swap',
        font_name: 'Manrope',
        font_size_heading: '2.05rem',
        font_size_body: '1rem',
        image_style_suffix: 'high-clarity infographic style, modern flat forms, strong typographic rhythm',
        glass_color: 'rgba(255, 255, 255, 0.78)'
    },
    tidepool_contrast: {
        primary_accent: '#0F6D75',
        secondary_accent: '#D17C4C',
        background_main: '#EEF4F2',
        text_main: '#0F2B36',
        text_secondary: '#3C5963',
        font_family: 'https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700;800&display=swap',
        font_name: 'Nunito Sans',
        font_size_heading: '2rem',
        font_size_body: '1rem',
        image_style_suffix: 'friendly professional infographic look, high readability, clean geometry, restrained detail',
        glass_color: 'rgba(255, 255, 255, 0.76)'
    },
    paper_ledger: {
        primary_accent: '#2F5C87',
        secondary_accent: '#8B6B4A',
        background_main: '#F8F5EE',
        text_main: '#1E2A33',
        text_secondary: '#4F5C66',
        font_family: 'https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700;800&display=swap',
        font_name: 'Public Sans',
        font_size_heading: '2rem',
        font_size_body: '1rem',
        image_style_suffix: 'print-inspired information design, clear sections, subtle warmth, high legibility',
        glass_color: 'rgba(255, 255, 255, 0.74)'
    },
    midnight_contrast: {
        primary_accent: '#3DD9D6',
        secondary_accent: '#FF8A5B',
        background_main: '#0B1220',
        text_main: '#E6F1FF',
        text_secondary: '#9BB3CC',
        font_family: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&display=swap',
        font_name: 'IBM Plex Sans',
        font_size_heading: '2rem',
        font_size_body: '1rem',
        image_style_suffix: 'high-contrast dark infographic, luminous accents, clear sectioning, strong hierarchy',
        glass_color: 'rgba(18, 31, 49, 0.78)'
    },
    noir_signal: {
        primary_accent: '#6AA4FF',
        secondary_accent: '#FFD166',
        background_main: '#111318',
        text_main: '#F2F4F8',
        text_secondary: '#B5BECC',
        font_family: 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&display=swap',
        font_name: 'Manrope',
        font_size_heading: '2.05rem',
        font_size_body: '1rem',
        image_style_suffix: 'dark editorial data-rich style, precise lines, subtle glow accents, excellent readability',
        glass_color: 'rgba(26, 31, 40, 0.8)'
    },
    aurora_slate: {
        primary_accent: '#7C9BFF',
        secondary_accent: '#5BE7C4',
        background_main: '#141A2A',
        text_main: '#ECF3FF',
        text_secondary: '#B9C8E4',
        font_family: 'https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&display=swap',
        font_name: 'Source Sans 3',
        font_size_heading: '2rem',
        font_size_body: '1rem',
        image_style_suffix: 'night-sky modern infographic, cool gradient accents, crisp typography, clean geometry',
        glass_color: 'rgba(23, 30, 48, 0.78)'
    }
};

export type ThemeId = keyof typeof THEME_LIBRARY;
