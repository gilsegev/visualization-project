import axios from 'axios';
import { StoryImageStrategy } from '../src/image-gen/strategies/story-image.strategy';

type AnyObj = Record<string, any>;

async function main() {
    const originalPost = axios.post;
    const originalGet = axios.get;

    const captures: AnyObj = {
        stampedTemplate: null,
        stampedPayload: null,
        screenshotBaseUrl: null,
        screenshotSize: null,
        savedFiles: [] as string[],
    };

    const config = {
        get: (key: string) => {
            if (key === 'SILICONFLOW_API_KEY') return 'fake-key';
            if (key === 'SILICONFLOW_STORY_MODEL') return 'black-forest-labs/FLUX.1-schnell';
            return undefined;
        }
    };
    const storage = {
        save: async (fileName: string, _buffer: Buffer) => {
            const normalized = fileName.replace(/\\/g, '/');
            captures.savedFiles.push(normalized);
            return `/generated-images/${normalized}`;
        }
    };
    const observability = { emitLog: () => undefined };
    const stamping = {
        stamp: (templateId: string, payload: AnyObj) => {
            captures.stampedTemplate = templateId;
            captures.stampedPayload = payload;
            return '<!doctype html><html><body><div id="canvas"></div></body></html>';
        }
    };
    const browser = {
        screenshotHtml: async (_html: string, baseUrl: string, options: AnyObj) => {
            captures.screenshotBaseUrl = baseUrl.replace(/\\/g, '/');
            captures.screenshotSize = { width: options.width, height: options.height };
            return Buffer.from('poster');
        }
    };

    (axios.post as any) = async () => ({ data: { data: [{ url: 'https://fake.local/hero.png' }] } });
    (axios.get as any) = async () => ({ data: Buffer.from('raw') });

    const strategy = new StoryImageStrategy(
        config as any,
        storage as any,
        observability as any,
        stamping as any,
        browser as any
    );

    const task = {
        id: 'hero-task',
        type: 'story_image',
        refined_prompt: 'hero narrative image',
        payload: {
            imageSpecs: {
                constraints: { paletteLockToCourseStyleGuide: true },
                rendering: { generation: { promptParts: { positive: ['wellness scene'], negative: ['text'] } } }
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

    await strategy.generate(task as any);

    const payload = captures.stampedPayload || {};
    const cells = Array.isArray(payload.cells) ? payload.cells : [];
    const firstCell = cells[0] || {};
    const checks = {
        path_integrity_hero_dir: String(captures.screenshotBaseUrl || '').includes('/hero/hero-task'),
        template_is_bento: captures.stampedTemplate === 'bento',
        single_12x12_image_only_cell: cells.length === 1
            && firstCell.col_span === 12
            && firstCell.row_span === 12
            && firstCell.content?.type === 'image_only',
        story_mode_enabled: payload.story_mode === true,
        aspect_target_preserved: captures.screenshotSize?.width === 1400 && captures.screenshotSize?.height === 900,
        assets_persisted_in_hero_path: captures.savedFiles.some((f: string) => f.endsWith('/hero/hero-task/assets/story_image.png'))
    };

    console.log(JSON.stringify({ checks, captures }, null, 2));

    (axios.post as any) = originalPost;
    (axios.get as any) = originalGet;
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

