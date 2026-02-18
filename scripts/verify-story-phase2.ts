import axios from 'axios';
import { StoryImageStrategy } from '../src/image-gen/strategies/story-image.strategy';

type AnyObj = Record<string, any>;

const makeTask = (overrides: AnyObj = {}): AnyObj => ({
    id: `story-${Math.random().toString(36).slice(2, 8)}`,
    type: 'story_image',
    refined_prompt: 'story image test',
    payload: {
        title: 'Story',
        imageSpecs: {
            constraints: { paletteLockToCourseStyleGuide: true, noBakedInText: true },
            rendering: {
                generation: {
                    promptParts: {
                        positive: ['minimal wellness illustration', 'calm indoor scene'],
                        negative: ['photorealistic']
                    }
                }
            }
        },
        dimensions: { width: 1400, height: 900 }
    },
    metadata: {
        course_id: 'test-course',
        lesson_id: 'lesson-1',
        dimensions: { width: 1400, height: 900 },
        course_palette_hexes: ['#5B9A8B', '#F5E6D3']
    },
    ...overrides
});

async function main() {
    const originalPost = axios.post;
    const originalGet = axios.get;

    const logs: AnyObj[] = [];
    const saved: AnyObj[] = [];
    const cfg = {
        get: (key: string) => {
            if (key === 'SILICONFLOW_API_KEY') return 'fake-key';
            if (key === 'SILICONFLOW_STORY_MODEL') return 'black-forest-labs/FLUX.1-schnell';
            return undefined;
        }
    };
    const storage = {
        save: async (fileName: string, buffer: Buffer) => {
            saved.push({ fileName, bytes: buffer.length });
            return `/generated-images/${fileName.replace(/\\/g, '/')}`;
        }
    };
    const obs = {
        emitLog: (level: string, message: string, context?: string, taskId?: string) => {
            logs.push({ level, message, context, taskId });
        }
    };

    const strategy = new StoryImageStrategy(cfg as any, storage as any, obs as any);

    const results: AnyObj = {};

    // 1) Resolution support check
    let lastRequestBody: AnyObj | null = null;
    (axios.post as any) = async (_url: string, body: AnyObj) => {
        lastRequestBody = body;
        return { data: { data: [{ url: 'https://fake.local/image.png' }] } };
    };
    (axios.get as any) = async () => ({ data: Buffer.from('png-bytes') });

    const t1 = makeTask({ metadata: { course_id: 'a', lesson_id: 'b', dimensions: { width: 1400, height: 900 }, course_palette_hexes: ['#5B9A8B', '#F5E6D3'] } });
    await strategy.generate(t1 as any);
    results.resolution = {
        requested: lastRequestBody?.image_size,
        pass: lastRequestBody?.image_size === '1400x900'
    };

    // 2) Backoff check (429, 429, success)
    let attempts = 0;
    (axios.post as any) = async () => {
        attempts += 1;
        if (attempts < 3) {
            const err: AnyObj = new Error('rate limit');
            err.response = { status: 429 };
            throw err;
        }
        return { data: { data: [{ url: 'https://fake.local/image.png' }] } };
    };

    const start = Date.now();
    await strategy.generate(makeTask() as any);
    const elapsed = Date.now() - start;
    results.backoff = {
        attempts,
        elapsed_ms: elapsed,
        pass: attempts === 3 && elapsed >= 2900
    };

    // 3) Queue cap check (max 2 concurrent posts)
    let inFlight = 0;
    let maxInFlight = 0;
    (axios.post as any) = async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(resolve => setTimeout(resolve, 220));
        inFlight -= 1;
        return { data: { data: [{ url: 'https://fake.local/image.png' }] } };
    };

    await Promise.all([
        strategy.generate(makeTask({ id: 'q1' }) as any),
        strategy.generate(makeTask({ id: 'q2' }) as any),
        strategy.generate(makeTask({ id: 'q3' }) as any),
    ]);
    results.queue = {
        max_in_flight: maxInFlight,
        pass: maxInFlight <= 2
    };

    const retryLogs = logs.filter(l => String(l.message || '').includes('retry scheduled')).length;
    results.observability = {
        retry_logs: retryLogs,
        pass: retryLogs >= 2
    };

    console.log(JSON.stringify(results, null, 2));

    (axios.post as any) = originalPost;
    (axios.get as any) = originalGet;
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

