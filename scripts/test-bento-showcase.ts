/*
// import { HtmlInfographicStrategy } from '../src/image-gen/strategies/html-infographic.strategy';
import { TemplateStampingStrategy } from '../src/image-gen/strategies/template-stamping.strategy';
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
    // const strategy = new HtmlInfographicStrategy(configService, browserService, localStorageService);
    const strategy = new TemplateStampingStrategy(browserService, configService, localStorageService);

    // 3. Define Prompt for Bento Grid
    // "The 6 core features of a modern Electric Vehicle." -> Should trigger bento_grid with 6 items.
    const prompt = "The 6 core features of a modern Electric Vehicle.";

    console.log(`Running generation for: "${prompt}"`);

    try {
        const context = {
            courseId: 'test-course',
            moduleId: 'test-module',
            targetAudience: 'Car Enthusiasts',
            topic: 'EV Technology'
        };

        const result = await strategy.performGeneration({
            id: 'test-task-bento',
            type: 'infographic',
            refined_prompt: prompt,
            context: context
        } as any);

        console.log('Generation Successful!');
        console.log('Result URL:', result.url);

    } catch (error) {
        console.error('Generation Failed:', error);
    } finally {
        await browserService.onModuleDestroy();
    }
}

run();
*/
