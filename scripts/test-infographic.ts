
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
        refined_prompt: 'A timeline of the evolution of the internet from 1990 to 2020',
        payload: {}
    };

    logger.log('Generating Infographic Blueprint & Stub...');

    try {
        const result = await strategy.generate(task, 1);
        logger.log(`[SUCCESS] Result: ${JSON.stringify(result)}`);

        if (result.url && result.url.includes('placeholder-infographic')) {
            logger.log('[VERIFIED] Placeholder URL returned correctly.');
        } else {
            logger.error('[FAILURE] Unexpected URL format.');
        }

    } catch (err) {
        logger.error('Infographic generation failed:', err);
    }
}

verifyInfographic();
