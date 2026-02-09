import { HtmlInfographicStrategy } from '../src/image-gen/strategies/html-infographic.strategy';
import { ConfigService } from '@nestjs/config';
import { BrowserService } from '../src/image-gen/browser.service';
import { LocalStorageService } from '../src/image-gen/local-storage.service';
import * as dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
    console.log('--- Final Validation: NBA All-Star Infographic ---');

    // Manually instantiate services if we don't want boot full app, 
    // BUT we need real BrowserService (which needs module init) and real ConfigService.
    // However, for simplicity in script, we can instantiate them directly if they don't depend on too much.
    // BrowserService needs onModuleInit.

    // Better: Helper mocks or loose instantiation if possible. 
    // Real BrowserService uses Playwright.

    // Mock ConfigService for secrets
    const configService = {
        get: (key: string) => process.env[key]
    } as any;

    // Real BrowserService
    const browserService = new BrowserService();
    await browserService.onModuleInit();

    // Real LocalStorageService
    const localStorageService = new LocalStorageService();

    const strategy = new HtmlInfographicStrategy(configService, browserService, localStorageService);

    const prompt = "The Top 5 NBA All-Stars (Jokic, SGA, Luka, Giannis, Wemby).";

    try {
        console.log(`Generating for: "${prompt}"...`);
        const result = await strategy.performGeneration({ refined_prompt: prompt } as any);

        console.log('--- GENERATION SUCCESS ---');
        console.log('Public URL:', result.url);
        console.log('Preview HTML length:', (result.payload as any).html.length);

        // Verification logic
        if (result.url && result.url.endsWith('.png')) {
            console.log('PASS: PNG URL returned.');
        } else {
            console.error('FAIL: URL is not a PNG.');
        }

    } catch (e) {
        console.error('--- GENERATION FAILED ---', e);
    } finally {
        await browserService.onModuleDestroy();
    }
}

bootstrap();
