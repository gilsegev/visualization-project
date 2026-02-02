export interface InfographicPalette {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
    stroke: string;
}

export const INFOGRAPHIC_PALETTES: Record<string, InfographicPalette> = {
    professional: {
        primary: '#2c3e50',   // Dark Blue
        secondary: '#ecf0f1', // Light Gray
        accent: '#3498db',    // Bright Blue
        background: '#ffffff',
        text: '#34495e',
        stroke: '#2c3e50'
    },
    playful: {
        primary: '#e67e22',   // Orange
        secondary: '#f1c40f', // Yellow
        accent: '#e74c3c',    // Red
        background: '#fdfbf7', // Off-white
        text: '#2c3e50',
        stroke: '#d35400'
    },
    urgent: {
        primary: '#c0392b',   // Dark Red
        secondary: '#e74c3c', // Red
        accent: '#f39c12',    // Orange
        background: '#fff5f5',
        text: '#2c3e50',
        stroke: '#c0392b'
    },
    calm: {
        primary: '#16a085',   // Teal
        secondary: '#a3e4d7', // Light Teal
        accent: '#2ecc71',    // Green
        background: '#f0fdf4',
        text: '#2c3e50',
        stroke: '#16a085'
    },
    default: {
        primary: '#333333',
        secondary: '#eeeeee',
        accent: '#007bff',
        background: '#ffffff',
        text: '#222222',
        stroke: '#333333'
    }
};

export function getPalette(mood: string): InfographicPalette {
    return INFOGRAPHIC_PALETTES[mood] || INFOGRAPHIC_PALETTES['default'];
}
