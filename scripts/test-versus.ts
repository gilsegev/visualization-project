
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

// Watchdog Timer
setTimeout(() => {
    console.error('🔥 Test Timed Out (60s)');
    process.exit(1);
}, 60000);

async function runVersusTest() {
    console.log('🧪 Starting Versus Split Test Case...');

    const localStorage = new LocalStorageService();
    const browserService = new BrowserService();
    const stampingService = new TemplateStampingService();
    const strategy = new TemplateStampingStrategy(stampingService, browserService, localStorage, configService);

    console.log(`\n🔄 Generating Versus Infographic: Focused Breathing vs Body Scanning...`);
    const start = performance.now();
    console.time(`Versus Generation`);

    const task: ImageTask = {
        id: `versus-test-${Date.now()}`,
        type: 'infographic',
        // Explicitly asking for a comparison to trigger the prompt logic (though we might inject blueprint directly if we wanted to be sure, but let's test the LLM prompt alignment too)
        refined_prompt: `Create a comparison infographic between "Guns N' Roses" and "Metallica". Use the versus_split template.`,
        payload: {},
        metadata: {
            template_id: 'versus_split', // Triggers the dispatch logic
            custom_theme: {
                primary_accent: '#3b82f6',
                background_main: '#0f172a',
                text_main: '#ffffff',
                font_family: 'Inter',
                font_name: 'Inter',
                image_style_suffix: 'high tech interface style',
                glass_color: 'rgba(30, 41, 59, 0.5)'
            }
        }
    };

    try {
        const result = await strategy.performGeneration(task);
        const duration = (performance.now() - start).toFixed(2);
        console.timeEnd(`Versus Generation`);

        console.log(`✅ Generation Complete in ${duration}ms`);
        console.log(`Output URL: ${result.url}`);

        // Validation Logic
        if (result.payload?.html) {
            const html = result.payload.html;
            if (html.includes('vs_') && html.includes('_left.png') && html.includes('_right.png')) {
                console.log('✅ Subject Images Detected in HTML');
            } else {
                console.error('❌ Subject Images MISSING in HTML');
            }

            if (html.includes('Guns') && html.includes('Metallica')) {
                console.log('✅ Subject Titles Detected');
            }

            if (result.payload.blueprint?.verdict) {
                console.log('✅ Verdict Generated:', result.payload.blueprint.verdict.title);
            } else {
                console.warn('⚠️ Verdict missing from Blueprint (LLM might not have generated it)');
            }

            // Check for Icons
            if (html.includes('class="icon-img"')) {
                console.log('✅ Item Icons Generated & Injected');
            } else {
                console.warn('⚠️ No Item Icons found in HTML (fallback to material symbols?)');
            }
        }

        console.log(`\nCheck the output in public/generated-images/.../${task.id}/`);

    } catch (e) {
        console.error(`❌ Test Failed:`, e);
        process.exit(1);
    }
}

runVersusTest();
