/*
import { HtmlInfographicStrategy } from '../src/image-gen/strategies/html-infographic.strategy';
import { ConfigService } from '@nestjs/config';
import { BrowserService } from '../src/image-gen/browser.service';
import { LocalStorageService } from '../src/image-gen/local-storage.service';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

async function run() {
    // 1. Mock/Setup Services
    // Mock ConfigService for secrets
    const configService = {
        get: (key: string) => process.env[key]
    } as any;

    const browserService = new BrowserService();
    // Initialize Browser Service (launches Playwright)
    await browserService.onModuleInit();

    const localStorageService = new LocalStorageService();

    // 2. Instantiate Strategy
    const strategy = new HtmlInfographicStrategy(configService, browserService, localStorageService);

    // 3. Define Prompt (Trigger "Enterprise Blue" archetype via "Junior Developer to CTO")
    const prompt = "The 5 steps from a Junior Developer to a CTO. Visualize this as a career journey.";

    console.log(`Running generation for: "${prompt}"`);

    try {
        const context = {
            courseId: 'test-course',
            moduleId: 'test-module',
            targetAudience: 'Aspiring Tech Leaders',
            topic: 'Career Growth'
        };

        // Note: strategy.performGeneration expects ImageTask which has refined_prompt
        const result = await strategy.performGeneration({
            id: 'test-task-1',
            type: 'infographic',
            refined_prompt: prompt,
            context: context
        } as any);

        console.log('Generation Successful!');
        console.log('Result URL:', result.url);

    } catch (error) {
        console.error('Generation Failed:', error);
    } finally {
        await browserService.onModuleDestroy(); // Close browser
    }
}

run();
*/
