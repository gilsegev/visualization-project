
import * as dotenv from 'dotenv';
dotenv.config();

import { TemplateStampingStrategy } from '../src/image-gen/strategies/template-stamping.strategy';
import { TemplateStampingService } from '../src/image-gen/services/template-stamping.service';
import { BrowserService } from '../src/image-gen/browser.service';
import { LocalStorageService } from '../src/image-gen/local-storage.service';
import { ConfigService } from '@nestjs/config';
import { ImageTask } from '../src/image-gen/image-task.schema';
import * as path from 'path';
import * as fs from 'fs';

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

async function runTest() {
    console.log('🧪 Starting Template Stamping Verification...');

    // 1. Setup Dependencies
    const localStorage = new LocalStorageService();
    const browserService = new BrowserService();
    const stampingService = new TemplateStampingService();

    const strategy = new TemplateStampingStrategy(
        stampingService,
        browserService,
        localStorage,
        configService
    );

    // 2. Create Test Task
    const task: ImageTask = {
        id: 'test-stamping-1',
        type: 'infographic',
        refined_prompt: 'Create a hub radial infographic about "AI Agents". Center: AI Agents. Spokes: Planning, Execution, Memory, Tools, Perception.',
        payload: {},
        metadata: {
            template_id: 'hub_radial',
            custom_theme: {
                primary_accent: '#6366f1',
                background_main: '#ffffff',
                text_main: '#1f2937',
                font_family: 'Inter',
                font_name: 'Inter',
                image_style_suffix: 'vector icon',
                glass_color: 'rgba(255,255,255,0.8)'
            }
        }
    };

    // 3. Execute
    console.log('🚀 Executing Strategy...');
    try {
        const result = await strategy.performGeneration(task);
        console.log('✅ Generation Complete!');
        console.log(`📂 Output URL (HTML only): ${result.url || 'None'}`);

        // Check local storage for HTML file
        // Since result.url is empty, we can check the payload or look for the file
        // But for this test, let's just inspect the payload HTML content as before

        if (result.payload && result.payload.html) {
            if (result.payload.html.includes('AI Agents')) {
                console.log('✅ Verified: Content "AI Agents" found in generated HTML.');
            } else {
                console.error('❌ Failed: Content "AI Agents" NOT found in generated HTML.');
            }

            if (result.payload.html.includes('/* INSERT_JSON_HERE */ null')) {
                console.error('❌ Failed: Placeholder NOT replaced.');
            } else {
                console.log('✅ Verified: Placeholder successfully replaced.');
            }

            if (result.payload.html.includes('function render(data)')) {
                console.log('✅ Verified: "render(data)" function preserved.');
            } else {
                console.error('❌ Failed: "render(data)" function MISSING. Template potentially truncated.');
            }

            if (result.payload.html.length > 1000) {
                console.log(`✅ Verified: File size looks healthy (${result.payload.html.length} chars).`);
            } else {
                console.warn(`⚠️ Warning: File size seems small (${result.payload.html.length} chars).`);
            }

            // Phase 2 Verification
            if (result.payload.blueprint && result.payload.blueprint.items) {
                const items = result.payload.blueprint.items;
                let assetsFound = 0;
                let pathsCorrect = 0;

                // Check if assets exist on disk
                const assetsDir = path.join(process.cwd(), 'public', 'generated-images', 'assets');
                if (fs.existsSync(assetsDir)) {
                    const files = fs.readdirSync(assetsDir);
                    console.log(`📂 Assets directory contains ${files.length} files.`);
                    // We can check if recent files matching the pattern exist, but simple count check is a good start
                } else {
                    console.error(`❌ Failed: Assets directory not found at ${assetsDir}`);
                }

                if (items.length > 0) {
                    // console.log('🔍 First Item Debug:', JSON.stringify(items[0], null, 2));
                } else {
                    console.error(`❌ Failed: Assets directory not found at ${assetsDir}`);
                }

                items.forEach((item: any, idx: number) => {
                    if (item.image_url && item.image_url.startsWith('./assets/')) {
                        pathsCorrect++;
                    }
                    // Check HTML for this path
                    if (result.payload.html.includes(item.image_url)) {
                        assetsFound++;
                    }
                });

                if (pathsCorrect === items.length) {
                    console.log(`✅ Verified: All ${items.length} items have local relative paths.`);
                } else {
                    console.warn(`⚠️ Warning: Only ${pathsCorrect}/${items.length} items have correct local paths.`);
                }

                if (assetsFound === items.length) {
                    console.log(`✅ Verified: All ${items.length} item paths found in HTML.`);
                } else {
                    console.warn(`⚠️ Warning: Only ${assetsFound}/${items.length} item paths found in generated HTML.`);
                }
            }

        }

    } catch (error) {
        console.error('❌ Test Failed:', error);
    }
}

runTest();
