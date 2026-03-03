export function parseAllowedOrigins(raw: string | undefined): string[] {
    const fallback = ['http://localhost:3000', 'http://127.0.0.1:3000'];
    const list = String(raw || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    return list.length ? list : fallback;
}

export function isAllowedOrigin(origin: string | undefined, allowedOrigins: string[]): boolean {
    if (!origin) return true; // Non-browser/server-to-server requests
    return allowedOrigins.includes(origin);
}
