import { HtmlInfographicStrategy } from '../src/image-gen/strategies/html-infographic.strategy';
import { ConfigService } from '@nestjs/config';
import { BrowserService } from '../src/image-gen/browser.service';
import { LocalStorageService } from '../src/image-gen/local-storage.service';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

async function run() {
    // 1. Mock/Setup Services
    const configService = {
        get: (key: string) => process.env[key]
    } as any;

    const browserService = new BrowserService();
    await browserService.onModuleInit();

    const localStorageService = new LocalStorageService();

    // 2. Instantiate Strategy
    const strategy = new HtmlInfographicStrategy(configService, browserService, localStorageService);

    // 3. Define Prompt for Themed Generation
    // "The Future of Quantum Computing" -> Should trigger 'cyber_neon' theme
    const prompt = "The Future of Quantum Computing.";

    console.log(`Running generation for: "${prompt}"`);

    try {
        const context = {
            courseId: 'test-course',
            moduleId: 'test-module',
            targetAudience: 'Tech Enthusiasts',
            topic: 'Future Tech'
        };

        const result = await strategy.performGeneration({
            id: 'test-task-themed',
            type: 'infographic',
            refined_prompt: prompt,
            context: context
        } as any);

        console.log('Generation Successful!');
        console.log('Result URL:', result.url);
        // We can inspect the blueprint in the console to verify theme_id
        console.log('Generated Blueprint Theme:', (result.payload as any).blueprint.theme_id);

    } catch (error) {
        console.error('Generation Failed:', error);
    } finally {
        await browserService.onModuleDestroy();
    }
}

run();
