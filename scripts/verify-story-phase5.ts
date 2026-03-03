import axios from 'axios';
import { StoryImageStrategy } from '../src/image-gen/strategies/story-image.strategy';

type LogEntry = { level: string; message: string; context?: string; taskId?: string };

const makeTask = (id: string) => ({
    id,
    type: 'story_image',
    refined_prompt: `story ${id}`,
    payload: {
        imageSpecs: {
            constraints: { paletteLockToCourseStyleGuide: true, noBakedInText: true },
            rendering: {
                generation: {
                    promptParts: {
                        positive: ['minimal wellness illustration', 'calm scene'],
                        negative: ['photorealistic']
                    }
                }
            }
        },
        dimensions: { width: 1400, height: 900 }
    },
    metadata: {
        course_id: 'phase5-course',
        lesson_id: 'phase5-lesson',
        dimensions: { width: 1400, height: 900 },
        course_palette_hexes: ['#5B9A8B', '#F5E6D3']
    }
});

async function main() {
    const originalPost = axios.post;
    const originalGet = axios.get;
    const logs: LogEntry[] = [];

    const cfg = {
        get: (key: string) => {
            if (key === 'SILICONFLOW_API_KEY') return 'fake-key';
            if (key === 'SILICONFLOW_STORY_MODEL') return 'black-forest-labs/FLUX.1-schnell';
            return undefined;
        }
    };
    const storage = {
        save: async (fileName: string, _buffer: Buffer) => `/generated-images/${fileName.replace(/\\/g, '/')}`
    };
    const obs = {
        emitLog: (level: string, message: string, context?: string, taskId?: string) => {
            logs.push({ level, message, context, taskId });
        }
    };
    const stamping = {
        stamp: (_templateId: string, payload: any) => `<!doctype html><html><body><img src="${payload.image_url || ''}"></body></html>`
    };
    const browser = {
        screenshotHtml: async () => Buffer.from('poster')
    };

    const strategy = new StoryImageStrategy(cfg as any, storage as any, obs as any, stamping as any, browser as any);

    // 1) Concurrency stress: 5 simultaneous story tasks, verify max active SiliconFlow calls == 2.
    let inFlight = 0;
    let maxInFlight = 0;
    (axios.post as any) = async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(resolve => setTimeout(resolve, 250));
        inFlight -= 1;
        return { data: { data: [{ url: 'https://fake.local/story.png' }] } };
    };
    (axios.get as any) = async () => ({ data: Buffer.from('story-png') });

    await Promise.all([
        strategy.generate(makeTask('s1') as any),
        strategy.generate(makeTask('s2') as any),
        strategy.generate(makeTask('s3') as any),
        strategy.generate(makeTask('s4') as any),
        strategy.generate(makeTask('s5') as any),
    ]);

    const concurrencyResult = {
        max_in_flight_siliconflow_calls: maxInFlight,
        pass: maxInFlight === 2
    };

    // 2) Backoff simulation: force 429 x3, succeed on 4th, verify 1s -> 2s -> 4s.
    logs.length = 0;
    let attempts = 0;
    (axios.post as any) = async () => {
        attempts += 1;
        if (attempts <= 3) {
            const err: any = new Error(`mock 429 #${attempts}`);
            err.response = { status: 429 };
            throw err;
        }
        return { data: { data: [{ url: 'https://fake.local/story.png' }] } };
    };

    const start = Date.now();
    await strategy.generate(makeTask('backoff-429') as any);
    const elapsedMs = Date.now() - start;

    const backoffLogDelays = logs
        .map(l => l.message)
        .filter(m => m.includes('Story image retry scheduled'))
        .map(m => {
            const match = m.match(/backoff=(\d+)ms/);
            return match ? Number(match[1]) : null;
        })
        .filter((n): n is number => Number.isFinite(n));

    const backoffResult = {
        attempts,
        observed_backoff_ms: backoffLogDelays,
        elapsed_ms: elapsedMs,
        pass: attempts === 4
            && backoffLogDelays.join(',') === '1000,2000,4000'
            && elapsedMs >= 6900
    };

    const result = {
        concurrency_stress_test: concurrencyResult,
        backoff_simulation: backoffResult
    };

    console.log(JSON.stringify(result, null, 2));

    (axios.post as any) = originalPost;
    (axios.get as any) = originalGet;
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

