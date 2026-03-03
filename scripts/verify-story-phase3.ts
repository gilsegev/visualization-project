import axios from 'axios';
import { StoryImageStrategy } from '../src/image-gen/strategies/story-image.strategy';

type AnyObj = Record<string, any>;

async function main() {
    const originalPost = axios.post;
    const originalGet = axios.get;

    const savedFiles: string[] = [];
    const calls: AnyObj = {
        stampedTemplate: null,
        screenshotRequested: null as null | { width: number; height: number; baseUrl: string },
    };

    const config = {
        get: (key: string) => {
            if (key === 'SILICONFLOW_API_KEY') return 'fake-key';
            return undefined;
        }
    };
    const storage = {
        save: async (fileName: string, buffer: Buffer) => {
            savedFiles.push(fileName.replace(/\\/g, '/'));
            return `/generated-images/${fileName.replace(/\\/g, '/')}`;
        }
    };
    const obs = { emitLog: () => undefined };
    const stamping = {
        stamp: (templateId: string, payload: AnyObj) => {
            calls.stampedTemplate = templateId;
            return `<!doctype html><html><body><img id="story-image" src="${payload.image_url}"></body></html>`;
        }
    };
    const browser = {
        screenshotHtml: async (_html: string, baseUrl: string, options: AnyObj) => {
            calls.screenshotRequested = { width: options.width, height: options.height, baseUrl };
            return Buffer.from('poster-png');
        }
    };

    (axios.post as any) = async () => ({ data: { data: [{ url: 'https://fake.local/story.png' }] } });
    (axios.get as any) = async () => ({ data: Buffer.from('raw-png') });

    const strategy = new StoryImageStrategy(
        config as any,
        storage as any,
        obs as any,
        stamping as any,
        browser as any
    );

    const task = {
        id: 'phase3-story',
        type: 'story_image',
        refined_prompt: 'story test',
        payload: {
            imageSpecs: {
                constraints: { paletteLockToCourseStyleGuide: true },
                rendering: { generation: { promptParts: { positive: ['calm scene'], negative: ['text'] } } }
            },
            dimensions: { width: 1400, height: 900 }
        },
        metadata: {
            course_id: 'mindfulness',
            lesson_id: 'lesson-1',
            dimensions: { width: 1400, height: 900 },
            course_palette_hexes: ['#5B9A8B', '#F5E6D3']
        }
    };

    const result = await strategy.generate(task as any);

    const checks = {
        stamped_template_story_frame: calls.stampedTemplate === 'story_frame',
        screenshot_dimensions_correct: calls.screenshotRequested?.width === 1400 && calls.screenshotRequested?.height === 900,
        assets_saved: savedFiles.some(f => f.endsWith('/assets/story_image.png')),
        index_saved: savedFiles.some(f => f.endsWith('/index.html')),
        poster_saved: savedFiles.some(f => f.endsWith('/poster.png')),
        blueprint_saved: savedFiles.some(f => f.endsWith('/blueprint.json')),
        returned_url_is_poster: typeof result.url === 'string' && result.url.includes('/poster.png')
    };

    console.log(JSON.stringify({ checks, savedFiles }, null, 2));

    (axios.post as any) = originalPost;
    (axios.get as any) = originalGet;
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

