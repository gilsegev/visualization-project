
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
    const strategy = new InfographicStrategy();

    // Mock task
    const task: ImageTask = {
        id: 'test-infographic-1',
        type: 'infographic',
        refined_prompt: 'A detailed 10-step journey of a product from raw material to end consumer: 1. Mining, 2. Refining, 3. Transport, 4. Manufacturing, 5. Quality, 6. Packaging, 7. Distribution, 8. Retail, 9. Purchase, 10. Reviews',
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
