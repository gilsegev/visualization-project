import { HtmlInfographicStrategy } from '../src/image-gen/strategies/html-infographic.strategy';
import { ConfigService } from '@nestjs/config';
import { BrowserService } from '../src/image-gen/browser.service';
import { LocalStorageService } from '../src/image-gen/local-storage.service';
import * as dotenv from 'dotenv';

dotenv.config();

async function run() {
    const configService = { get: (key: string) => process.env[key] } as any;
    const browserService = new BrowserService();
    await browserService.onModuleInit();
    const localStorageService = new LocalStorageService();

    const strategy = new HtmlInfographicStrategy(configService, browserService, localStorageService);

    // Force Long Text via Prompt Engineering
    const prompt = "The 5 most complex laws of physics explained for a 5-year-old. Write VERY LONG detailed descriptions (50+ words) for each point to stress test the layout.";

    console.log(`Running Stress Test: "${prompt}"`);

    try {
        const result = await strategy.performGeneration({
            id: 'test-collision-fix',
            type: 'infographic',
            refined_prompt: prompt,
            context: { courseId: 'test', moduleId: 'test', targetAudience: 'Kids', topic: 'Physics' }
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
