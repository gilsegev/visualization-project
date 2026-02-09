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

    // 3. Define Prompt for Zig-Zag Flow
    // "The evolution of the iPhone from the original to the iPhone 17."
    // This should trigger 'step_stone' template.
    const prompt = "The evolution of the iPhone from the original to the iPhone 17.";

    console.log(`Running generation for: "${prompt}"`);

    try {
        const context = {
            courseId: 'test-course',
            moduleId: 'test-module',
            targetAudience: 'Tech History Buffs',
            topic: 'Smartphone Evolution'
        };

        const result = await strategy.performGeneration({
            id: 'test-task-zigzag',
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
