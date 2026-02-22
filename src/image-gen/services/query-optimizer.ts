import OpenAI from 'openai';

export class QueryOptimizer {
    private static readonly GLOBAL_QUALITY = 'high-quality, curated, minimalist, non-corporate, professional photography';

    constructor(private readonly openai: OpenAI | null) {}

    async expandQuery(
        brief: string,
        timeoutMs: number,
        fallback: () => string[],
        options?: { withQuality?: boolean; lessonTitle?: string },
    ): Promise<{ queries: string[]; mode: 'llm' | 'heuristic'; plan?: { subject?: string; state?: string; setting?: string; required_terms?: string[]; core_noun?: string; aesthetic_tag?: string } }> {
        const withQuality = options?.withQuality !== false;
        if (!this.openai) return { queries: this.applyQuality(fallback(), withQuality), mode: 'heuristic' };
        try {
            const response = await this.withTimeout(
                this.openai.chat.completions.create({
                    model: 'openai/gpt-4o-mini',
                    temperature: 0.1,
                    max_tokens: 220,
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a visual keyword extractor. Identify the single most visually dominant object for the concept and one high-value aesthetic tag (example: sunlight, minimal, macro). Return strict JSON only: {"core_noun":"...","aesthetic_tag":"...","queries":["..."]}. Rules: 1) Output exactly 5 short queries. 2) Each query is 2 or 3 words only. 3) Most queries must include core_noun. 4) Avoid generic phrases.'
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
            const coreNoun = this.normalize(parsed?.core_noun || '').split(' ').slice(0, 2).join(' ').trim();
            const aestheticTag = this.normalize(parsed?.aesthetic_tag || '').split(' ').slice(0, 1).join(' ').trim();
            const fallbackSubject = this.mostFrequentNoun(options?.lessonTitle || '');
            const resolvedSubject = this.normalize(parsed?.subject || coreNoun || fallbackSubject || 'subject').split(' ').slice(0, 2).join(' ').trim();
            const requiredTerms = Array.isArray(parsed?.required_terms)
                ? parsed.required_terms.map((t: string) => this.normalize(t)).filter(Boolean).slice(0, 5)
                : [];
            const directQueries = Array.isArray(parsed?.queries)
                ? parsed.queries.map((q: string) => this.normalize(q)).filter(Boolean).map((q: string) => q.split(' ').slice(0, 3).join(' ')).slice(0, 5)
                : [];
            const seedFromRequired = requiredTerms.join(' ').trim();
            const q = this.unique([
                ...directQueries,
                seedFromRequired,
                `${coreNoun} ${aestheticTag}`.trim(),
                `${coreNoun}`.trim(),
            ]).filter(Boolean).slice(0, 5);
            if (!q.length) throw new Error('empty keyword expansion');
            return {
                queries: this.applyQuality(q, withQuality),
                mode: 'llm',
                plan: {
                    subject: resolvedSubject || 'subject',
                    state: this.normalize(parsed?.state || ''),
                    setting: this.normalize(parsed?.setting || ''),
                    required_terms: requiredTerms,
                    core_noun: coreNoun,
                    aesthetic_tag: aestheticTag,
                }
            };
        } catch {
            return { queries: this.applyQuality(fallback(), withQuality), mode: 'heuristic' };
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

    private applyQuality(queries: string[], withQuality: boolean): string[] {
        return withQuality ? this.injectQuality(queries) : this.unique(queries).slice(0, 5);
    }

    private unique(input: string[]): string[] {
        return [...new Set(input.map((v) => this.normalize(v)).filter(Boolean))];
    }

    private mostFrequentNoun(input: string): string {
        const stop = new Set([
            'the', 'and', 'for', 'with', 'from', 'into', 'over', 'under', 'your', 'this', 'that', 'these', 'those',
            'lesson', 'visual', 'guide', 'introduction', 'advanced', 'basics', 'fundamentals'
        ]);
        const words = this.normalize(input)
            .split(' ')
            .filter((w) => w.length > 2 && !stop.has(w));
        const freq = new Map<string, number>();
        for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
        let best = '';
        let count = 0;
        for (const [word, c] of freq.entries()) {
            if (c > count) {
                best = word;
                count = c;
            }
        }
        return best;
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
