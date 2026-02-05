
import * as dotenv from 'dotenv';
dotenv.config();

import { InfographicStrategy } from '../src/image-gen/strategies/infographic.strategy';
import { ImageTask } from '../src/image-gen/image-task.schema';
import { Logger } from '@nestjs/common';

async function verifyInfographic() {
    const logger = new Logger('InfographicTest');
    logger.log('Initializing Infographic Strategy...');

    // Just testing the strategy, no browser or storage needed for this foundational step (except BaseImageStrategy might log)
    // InfographicStrategy extends BaseImageStrategy but constructor is self-contained (LLM setup)
    // Wait, BaseImageStrategy doesn't inject anything.
    // InfographicStrategy constructor uses process.env.GEMINI_API_KEY
    // Mock services
    const mockBrowser = {
        getNewPage: async () => ({
            page: {
                setContent: async () => { },
                addStyleTag: async () => { },
                waitForTimeout: async () => { },
                screenshot: async () => Buffer.from(''),
                close: async () => { },
                video: () => ({ path: () => '/mock/video.mp4' })
            },
            context: { close: async () => { } }
        })
    } as any;

    const mockStorage = {
        upload: async (buf, name) => `https://mock-storage.com/${name}`
    } as any;

    const mockConfigService = {
        get: (key: string) => process.env[key] || 'mock-key'
    } as any;
    const strategy = new InfographicStrategy(mockBrowser, mockStorage, mockConfigService);

    // Mock task
    const task: ImageTask = {
        id: 'test-infographic-1',
        type: 'infographic',
        refined_prompt: 'A playful 4-step process for making coffee: 1. Grind, 2. Brew, 3. Pour, 4. Enjoy. Emphasize "Enjoy" with highlight.',
        payload: {}
    };

    logger.log('Generating Infographic Blueprint & Stub...');

    try {
        const result = await strategy.generate(task, 1);
        logger.log(`[SUCCESS] Result: ${JSON.stringify(result)}`);

        if (result.url && (result.url.includes('placeholder-infographic') || result.url.includes('infographic-'))) {
            logger.log('[VERIFIED] Valid URL returned.');
        } else {
            logger.error('[FAILURE] Unexpected URL format.');
        }

        // Logic verification happens via internal Strategy logs (Truncation warning), 
        // to verify externally we'd need to inspect the result content if we returned it.
        // For now, we rely on the prompt "Verify the console log shows the new nested JSON structure".

    } catch (err) {
        logger.error('Infographic generation failed:', err);
    }
}

verifyInfographic();
