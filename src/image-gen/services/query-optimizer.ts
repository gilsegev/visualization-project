import OpenAI from 'openai';

export class QueryOptimizer {
    private static readonly GLOBAL_QUALITY = 'high-quality, curated, minimalist, non-corporate, professional photography';

    constructor(private readonly openai: OpenAI | null) {}

    async expandQuery(
        brief: string,
        timeoutMs: number,
        fallback: () => string[],
    ): Promise<{ queries: string[]; mode: 'llm' | 'heuristic' }> {
        if (!this.openai) return { queries: this.injectQuality(fallback()), mode: 'heuristic' };
        try {
            const response = await this.withTimeout(
                this.openai.chat.completions.create({
                    model: 'openai/gpt-4o-mini',
                    temperature: 0.2,
                    max_tokens: 90,
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a professional photo researcher for a high-end wellness book. Given a concept, describe a minimalist, professional photograph that represents it. Focus on lighting, composition, and specific objects. Output only 4-6 descriptive keywords separated by commas.'
                        },
                        { role: 'user', content: brief }
                    ]
                }),
                timeoutMs,
                'query expansion timeout'
            );

            const raw = String(response.choices?.[0]?.message?.content || '');
            const keywords = raw
                .replace(/```/g, '')
                .split(',')
                .map((k) => this.normalize(k))
                .filter(Boolean)
                .slice(0, 6);
            const q = this.buildQueriesFromKeywords(keywords);
            if (!q.length) throw new Error('empty keyword expansion');
            return { queries: this.injectQuality(q), mode: 'llm' };
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

