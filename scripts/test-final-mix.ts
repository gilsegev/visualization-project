import * as dotenv from 'dotenv';
dotenv.config();

import { DataVizStrategy } from '../src/image-gen/strategies/data-viz.strategy';
import { VisualConceptStrategy } from '../src/image-gen/strategies/visual-concept.strategy';
import { MathFormulaStrategy } from '../src/image-gen/strategies/math-formula.strategy';
import { BeautifySlideStrategy } from '../src/image-gen/strategies/beautify-slide.strategy';
import { LocalStorageService } from '../src/image-gen/local-storage.service';
import { BrowserService } from '../src/image-gen/browser.service';
import { ImageTask } from '../src/image-gen/image-task.schema';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Mock ConfigService
class MockConfigService {
    get(key: string) {
        if (key === 'SILICONFLOW_API_KEY') {
            return process.env.SILICONFLOW_API_KEY;
        }
        return null;
    }
}

async function verifyFinalMix() {
    const logger = new Logger('FinalMixTest');
    logger.log('Initializing Services...');

    const localStorage = new LocalStorageService();
    // @ts-ignore
    const configService = new MockConfigService() as ConfigService;
    const browserService = new BrowserService();

    await browserService.onModuleInit();

    // Instantiate Strategies
    const vizStrategy = new DataVizStrategy(localStorage, browserService);
    const photoStrategy = new VisualConceptStrategy(configService, localStorage);
    const mathStrategy = new MathFormulaStrategy(localStorage, browserService);
    const slideStrategy = new BeautifySlideStrategy(localStorage, browserService);

    const tasks: ImageTask[] = [
        {
            id: 'task-1-photo',
            type: 'visual_concept',
            refined_prompt: 'A minimalistic zen garden',
            payload: {}
        },
        {
            id: 'task-2-chart',
            type: 'data_viz',
            refined_prompt: 'Project Progress',
            payload: {
                chartType: 'pie',
                data: [
                    { label: 'Done', value: 70 },
                    { label: 'Pending', value: 30 }
                ]
            }
        },
        {
            id: 'task-3-math',
            type: 'math_formula',
            refined_prompt: 'Quadratic Formula', // fallback prompt
            payload: {
                latex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'
            }
        },
        {
            id: 'task-4-slide',
            type: 'beautify_slide',
            refined_prompt: 'Lesson 1: Introduction to AI. History of AI. Machine Learning Basics. Deep Learning Revolution.',
            payload: {}
        }
    ];

    logger.log('Starting Final Mix Generation...');

    try {
        const results = await Promise.all(tasks.map(async (task, index) => {
            logger.log(`Starting task ${task.id} (${task.type})...`);
            try {
                let url = '';
                if (task.type === 'data_viz') {
                    url = (await vizStrategy.generate(task, index + 1)).url;
                } else if (task.type === 'visual_concept') {
                    url = (await photoStrategy.generate(task, index + 1)).url;
                } else if (task.type === 'math_formula') {
                    url = (await mathStrategy.generate(task, index + 1)).url;
                } else if (task.type === 'beautify_slide') {
                    url = (await slideStrategy.generate(task, index + 1)).url;
                }

                logger.log(`[SUCCESS] Task ${task.id} generated: ${url}`);
                return { id: task.id, status: 'success', url };
            } catch (error) {
                logger.error(`[FAILURE] Task ${task.id} failed: ${error.message}`);
                return { id: task.id, status: 'error', error: error.message };
            }
        }));

        logger.log('Summary:');
        console.table(results);

    } catch (err) {
        logger.error('Unexpected error:', err);
    } finally {
        await browserService.onModuleDestroy();
    }
}

verifyFinalMix();
