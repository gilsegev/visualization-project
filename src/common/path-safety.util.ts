import * as path from 'path';

const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

export function generatedImagesRoot(): string {
    return path.resolve(process.cwd(), 'public', 'generated-images');
}

export function sanitizeRelativePath(input: string, label = 'path'): string {
    const raw = String(input || '').trim().replace(/\\/g, '/');
    if (!raw) throw new Error(`Invalid ${label}: empty`);
    if (raw.includes('\0')) throw new Error(`Invalid ${label}: null byte`);
    if (/^[a-zA-Z]:\//.test(raw) || raw.startsWith('/')) throw new Error(`Invalid ${label}: absolute path not allowed`);
    const segments = raw.split('/').filter(Boolean);
    if (!segments.length) throw new Error(`Invalid ${label}: empty`);
    for (const seg of segments) {
        if (seg === '.' || seg === '..') throw new Error(`Invalid ${label}: traversal segment not allowed`);
        if (!SEGMENT_RE.test(seg)) throw new Error(`Invalid ${label}: illegal segment "${seg}"`);
    }
    return segments.join('/');
}

export function resolveWithinGeneratedImages(relativePath: string): string {
    const safeRelative = sanitizeRelativePath(relativePath, 'relative path');
    const root = generatedImagesRoot();
    const full = path.resolve(root, safeRelative);
    if (full !== root && !full.startsWith(`${root}${path.sep}`)) {
        throw new Error('Path escapes generated-images root');
    }
    return full;
}

export function normalizeDbResultPath(resultUrl?: string | null): string | null {
    const raw = String(resultUrl || '').trim().replace(/\\/g, '/');
    if (!raw) return null;
    if (/^[a-z]+:\/\//i.test(raw) || /^[a-zA-Z]:\//.test(raw)) return null;
    const trimmed = raw.replace(/^\/+/, '');
    if (!trimmed) return null;
    const withPrefix = trimmed.startsWith('generated-images/') ? trimmed : `generated-images/${trimmed}`;
    return sanitizeRelativePath(withPrefix, 'result_url');
}

