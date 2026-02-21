import OpenAI from 'openai';

export class QueryOptimizer {
    private static readonly GLOBAL_QUALITY = 'high-quality, curated, minimalist, non-corporate, professional photography';

    constructor(private readonly openai: OpenAI | null) {}

    async expandQuery(
        brief: string,
        timeoutMs: number,
        fallback: () => string[],
    ): Promise<{ queries: string[]; mode: 'llm' | 'heuristic'; plan?: { subject?: string; state?: string; setting?: string; required_terms?: string[] } }> {
        if (!this.openai) return { queries: this.injectQuality(fallback()), mode: 'heuristic' };
        try {
            const response = await this.withTimeout(
                this.openai.chat.completions.create({
                    model: 'openai/gpt-4o-mini',
                    temperature: 0.1,
                    max_tokens: 220,
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a photo search optimizer. Convert a brief into concise search queries that preserve core intent. Return strict JSON only: {"subject":"...","state":"...","setting":"...","required_terms":["..."],"queries":["..."]}. Rules: 1) Include required_terms in most queries. 2) Prioritize concrete nouns over style adjectives. 3) Keep each query 3-7 words. 4) Avoid generic-only phrases like "tools on table" unless required by brief. 5) Output exactly 5 queries.'
                        },
                        { role: 'user', content: brief }
                    ]
                }),
                timeoutMs,
                'query expansion timeout'
            );

            const raw = String(response.choices?.[0]?.message?.content || '');
            const jsonText = raw.replace(/```json|```/g, '').trim();
            const parsed = JSON.parse(jsonText || '{}');
            const requiredTerms = Array.isArray(parsed?.required_terms)
                ? parsed.required_terms.map((t: string) => this.normalize(t)).filter(Boolean).slice(0, 5)
                : [];
            const directQueries = Array.isArray(parsed?.queries)
                ? parsed.queries.map((q: string) => this.normalize(q)).filter(Boolean).slice(0, 5)
                : [];
            const seedFromRequired = requiredTerms.join(' ').trim();
            const q = this.unique([
                ...directQueries,
                seedFromRequired,
                `${parsed?.subject || ''} ${parsed?.state || ''}`.trim(),
                `${parsed?.subject || ''} ${parsed?.setting || ''}`.trim(),
            ]).filter(Boolean).slice(0, 5);
            if (!q.length) throw new Error('empty keyword expansion');
            return {
                queries: this.injectQuality(q),
                mode: 'llm',
                plan: {
                    subject: this.normalize(parsed?.subject || ''),
                    state: this.normalize(parsed?.state || ''),
                    setting: this.normalize(parsed?.setting || ''),
                    required_terms: requiredTerms,
                }
            };
        } catch {
            return { queries: this.injectQuality(fallback()), mode: 'heuristic' };
        }
    }

    private buildQueriesFromKeywords(keywords: string[]): string[] {
        if (!keywords.length) return [];
        const k = keywords;
        const out = [
            `${k[0] || ''} ${k[1] || ''} ${k[2] || ''}`.trim(),
            `${k[0] || ''} ${k[3] || ''} ${k[4] || ''}`.trim(),
            `${k[1] || ''} ${k[2] || ''} ${k[5] || ''}`.trim(),
            `${k[0] || ''} ${k[2] || ''}`.trim(),
            `${k[3] || ''} ${k[4] || ''} ${k[5] || ''}`.trim(),
        ].map((v) => this.normalize(v)).filter(Boolean);
        return [...new Set(out)].slice(0, 5);
    }

    private injectQuality(queries: string[]): string[] {
        return [...new Set(queries.map((q) => `${q}, ${QueryOptimizer.GLOBAL_QUALITY}`.trim()))].slice(0, 5);
    }

    private unique(input: string[]): string[] {
        return [...new Set(input.map((v) => this.normalize(v)).filter(Boolean))];
    }

    private normalize(input: string): string {
        return String(input || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
    }

    private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
        let timer: NodeJS.Timeout | null = null;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(label)), ms);
        });
        try {
            return await Promise.race([promise, timeout]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }
}
