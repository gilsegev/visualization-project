export interface Theme {
    primary_accent: string;
    background_main: string;
    text_main: string;
    font_family: string;
    font_name: string;
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
    }
};

export type ThemeId = keyof typeof THEME_LIBRARY;
