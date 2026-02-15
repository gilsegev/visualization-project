import { TemplateStampingStrategy } from '../src/image-gen/strategies/template-stamping.strategy';
import { TemplateStampingService } from '../src/image-gen/services/template-stamping.service';
import { BrowserService } from '../src/image-gen/browser.service';
import { LocalStorageService } from '../src/image-gen/local-storage.service';
import { ConfigService } from '@nestjs/config';
import { ImageTask } from '../src/image-gen/image-task.schema';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

// Mock Services
const mockBrowserService = {
    screenshotHtml: async () => Buffer.from('mock-screenshot'),
    close: async () => { },
};

// Mock LocalStorage to just write files
const mockLocalStorage = {
    save: async (filepath: string, buffer: Buffer) => {
        const fullPath = path.join(process.cwd(), 'public', 'generated-images', filepath);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, buffer);
        console.log(`[LocalStorageService] Saved file: ${fullPath}`);
        return `http://localhost:3000/generated-images/${filepath.replace(/\\/g, '/')}`;
    },
};

// Real Template Service to test actual HTML injection
const realTemplateService = new TemplateStampingService();

async function runTest() {
    console.log('\n🧪 Starting Steps Template Test Case...');

    const configService = new ConfigService();
    // Manually inject env vars if ConfigService relies on them
    const strategy = new TemplateStampingStrategy(
        realTemplateService,
        mockBrowserService as any,
        mockLocalStorage as any,
        { get: (key: string) => process.env[key] } as any
    );

    const task: ImageTask = {
        id: `steps-test-${Date.now()}`,
        type: 'infographic',
        refined_prompt: 'Create a 4-Step Morning Routine: Hydrate, Meditate, Exercise, Planner. Use the steps template.',
        payload: {},
        metadata: {
            template_id: 'steps',
            force_template_id: 'steps' // Ensure we test the steps path
        }
    };

    try {
        const result = await strategy.performGeneration(task);
        console.log('\n✅ Generation Result:', result.url);

        // Validation
        const blueprint = result.payload.blueprint;
        const html = result.payload.html;

        if (blueprint.template_id !== 'steps' && blueprint.template_id !== 'step_list') {
            console.error('❌ Expected template_id to be "steps", got:', blueprint.template_id);
        } else {
            console.log('✅ Template ID Check Passed');
        }

        if (blueprint.background_url) {
            console.log('✅ Background URL Generated:', blueprint.background_url);
        } else {
            console.warn('⚠️ No Background URL found in Blueprint');
        }

        if (blueprint.items && blueprint.items.length >= 4) {
            console.log(`✅ Generated ${blueprint.items.length} steps`);
        } else {
            console.warn(`⚠️ Expected at least 4 items, got ${blueprint.items?.length}`);
        }

        if (html.includes('./assets/step_')) {
            console.log('✅ Step Images Injected into HTML');
        } else {
            console.warn('⚠️ No Step Images found in HTML');
        }

        if (html.includes("background.png")) {
            console.log('✅ Background Image Injected into HTML (CSS)');
        } else {
            console.warn('⚠️ No Background Image found in HTML');
        }

        console.log(`\nCheck the output in public/generated-images/.../${task.id}/`);
    } catch (e) {
        console.error('❌ Test Failed:', e);
    }
}

runTest();
