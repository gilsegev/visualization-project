import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { ImageStrategyFactory } from './src/image-gen/image-strategy.factory';
import { ImageTask } from './src/image-gen/image-task.schema';
import { Logger } from '@nestjs/common';
import * as dotenv from 'dotenv';
dotenv.config();

async function runAudit() {
    const logger = new Logger('InfographicAudit');
    const app = await NestFactory.createApplicationContext(AppModule);
    const strategyFactory = app.get(ImageStrategyFactory);

    logger.log('🕵️ Starting Infographic Storage Audit...');

    const task: ImageTask = {
        id: 'audit-task-1',
        type: 'infographic',
        refined_prompt: 'A 3-step audit process: 1. Log, 2. Check, 3. Verify. Mood: Urgent.',
        payload: { format: 'static' }
    };

    const strategy = strategyFactory.getStrategy('infographic');

    try {
        const result = await strategy.generate(task);
        logger.log(`[SUCCESS] Result: ${JSON.stringify(result)}`);
    } catch (e) {
        logger.error(`[FAIL] ${e.message}`);
    }

    await app.close();
}

runAudit();
