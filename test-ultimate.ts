import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { ImageStrategyFactory } from './src/image-gen/image-strategy.factory';
import { ImageTask } from './src/image-gen/image-task.schema';
import { Logger } from '@nestjs/common';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * THE ULTIMATE STRESS TEST (Prompt 16)
 * 30 Concurrent Tasks:
 * - 10 DataViz (Video + Static)
 * - 10 VisualConcept (Flux)
 * - 10 Infographics (5 Complex, 5 Simple)
 */
async function runUltimateTest() {
    const logger = new Logger('UltimateTest');
    const app = await NestFactory.createApplicationContext(AppModule);
    const strategyFactory = app.get(ImageStrategyFactory);

    logger.log('🚀 Starting ULTIMATE STRESS TEST: 30 Concurrent Requests');

    // Mocks for LocalStorage & Browser (handled nicely by services)

    // 1. DataViz Tasks (10)
    const dataVizTasks: ImageTask[] = Array.from({ length: 10 }).map((_, i) => ({
        id: `ult-dv-${i}`,
        type: 'data_viz',
        refined_prompt: `Chart ${i}: A generic dataset showing trend ${i}`,
        payload: {
            chartType: i % 2 === 0 ? 'line' : 'bar',
            data: { labels: ['A', 'B', 'C'], values: [10 + i, 20 + i, 30 + i] },
            format: i % 2 === 0 ? 'animated' : 'static'
        }
    }));

    // 2. VisualConcept Tasks (10) - (Mocking fast flux for test speed if possible, but we run real)
    const visualTasks: ImageTask[] = Array.from({ length: 10 }).map((_, i) => ({
        id: `ult-vc-${i}`,
        type: 'visual_concept',
        refined_prompt: `A beautiful abstract concept representing future technology ${i}`,
        payload: {}
    }));

    // 3. Infographic Tasks (10)
    // 5 Complex (Deep Sea Logic)
    const complexInfographics: ImageTask[] = Array.from({ length: 5 }).map((_, i) => ({
        id: `ult-info-complex-${i}`,
        type: 'infographic',
        refined_prompt: `A complex 5-step Deep Sea Logistics journey for Container ${i}: 1. Load, 2. Transit, 3. Customs, 4. Unload, 5. Delivery. Mood: Professional.`,
        payload: { format: 'animated' }
    }));

    // 5 Simple
    const simpleInfographics: ImageTask[] = Array.from({ length: 5 }).map((_, i) => ({
        id: `ult-info-simple-${i}`,
        type: 'infographic',
        refined_prompt: `A simple 3-item list of key benefits: Speed, Cost, Quality. Mood: Playful.`,
        payload: { format: 'static' }
    }));

    const allTasks = [...dataVizTasks, ...visualTasks, ...complexInfographics, ...simpleInfographics];

    const start = performance.now();
    const results = await Promise.allSettled(allTasks.map(async (task) => {
        const strategy = strategyFactory.getStrategy(task.type);
        try {
            const res = await strategy.generate(task);
            logger.log(`[SUCCESS] ${task.id}: ${res.url} ${res.posterUrl ? '+ Poster' : ''}`);
            return res;
        } catch (e) {
            logger.error(`[FAIL] ${task.id}: ${e.message}`);
            throw e;
        }
    }));
    const end = performance.now();

    const duration = ((end - start) / 1000).toFixed(2);
    const successCount = results.filter(r => r.status === 'fulfilled').length;

    logger.log('------------------------------------------------');
    logger.log(`🏁 ULTIMATE TEST COMPLETE`);
    logger.log(`Total Time: ${duration}s`);
    logger.log(`Success Rate: ${successCount}/30`);
    logger.log('------------------------------------------------');

    await app.close();
}

runUltimateTest();
