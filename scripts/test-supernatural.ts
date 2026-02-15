
import * as dotenv from 'dotenv';
dotenv.config();

import { TemplateStampingStrategy } from '../src/image-gen/strategies/template-stamping.strategy';
import { TemplateStampingService } from '../src/image-gen/services/template-stamping.service';
import { BrowserService } from '../src/image-gen/browser.service';
import { LocalStorageService } from '../src/image-gen/local-storage.service';
import { ConfigService } from '@nestjs/config';
import { ImageTask } from '../src/image-gen/image-task.schema';
import * as fs from 'fs';
import * as path from 'path';

// Global Error Handlers
process.on('uncaughtException', (err) => {
    console.error('🔥 CRITICAL: Uncaught Exception:', err);
    process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('🔥 CRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Mock ConfigService
const configService = {
    get: (key: string) => process.env[key]
} as ConfigService;

async function runSupernaturalTest() {
    console.log('🧪 Starting Supernatural Test Case...');

    const localStorage = new LocalStorageService();
    const browserService = new BrowserService();
    const stampingService = new TemplateStampingService();
    const strategy = new TemplateStampingStrategy(stampingService, browserService, localStorage, configService);

    const count = 6;
    console.log(`\n🔄 Generating 6-spoke Supernatural Infographic...`);
    const start = performance.now();
    console.time(`Supernatural Generation`);

    const task: ImageTask = {
        id: `supernatural-test`,
        type: 'infographic',
        refined_prompt: `Create a 6 spoke infographic on the show supernatural. Include key characters like Sam, Dean, Castiel, and concepts like "Saving People, Hunting Things".`,
        payload: {},
        metadata: {
            template_id: 'hub_radial',
            custom_theme: {
                primary_accent: '#8B0000', // Dark Red/Blood
                background_main: '#1a1a1a', // Dark
                text_main: '#ffffff',
                font_family: 'Inter',
                font_name: 'Inter',
                image_style_suffix: 'dark horror theme',
                glass_color: 'rgba(0,0,0,0.8)'
            }
        }
    };

    try {
        const result = await strategy.performGeneration(task);
        const duration = (performance.now() - start).toFixed(2);
        console.timeEnd(`Supernatural Generation`);

        console.log(`✅ Generation Complete in ${duration}ms`);
        console.log(`Output URL: ${result.url}`);
        console.log(`\nCheck the output in public/generated-images/.../supernatural-test/`);

    } catch (e) {
        console.error(`❌ Test Failed:`, e);
        process.exit(1);
    }
}

runSupernaturalTest();
