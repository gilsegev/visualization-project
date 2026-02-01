import * as dotenv from 'dotenv';
dotenv.config();

import { DataVizStrategy } from '../src/image-gen/strategies/data-viz.strategy';
import { VisualConceptStrategy } from '../src/image-gen/strategies/visual-concept.strategy';
import { LocalStorageService } from '../src/image-gen/local-storage.service';
import { ImageTask } from '../src/image-gen/image-task.schema';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Mock ConfigService
class MockConfigService {
    get(key: string) {
        if (key === 'SILICONFLOW_API_KEY') {
            const envKey = process.env.SILICONFLOW_API_KEY;
            console.log(`[DEBUG] SILICONFLOW_API_KEY from env: ${envKey ? 'Present' : 'Missing'}, Length: ${envKey ? envKey.length : 0}`);
            if (envKey) return envKey;

            console.log('[DEBUG] Using fallback key (which is likely invalid if env key is missing)');
            return 'sk-bhuxqgqacwuytqfjeenjppcypfynlbykzlrvtqjfdxwdkwoy';
        }
        return null;
    }
}

async function verifyMixedGeneration() {
    const logger = new Logger('MixedGenerationTest');
    logger.log('Initializing Services...');

    const localStorage = new LocalStorageService();
    // @ts-ignore
    const configService = new MockConfigService() as ConfigService;

    // Instantiate Strategies
    const vizStrategy = new DataVizStrategy(localStorage);
    const photoStrategy = new VisualConceptStrategy(configService, localStorage);

    const tasks: ImageTask[] = [
        {
            id: 'task-1-visual_concept',
            type: 'visual_concept',
            refined_prompt: 'A high-quality photo of a futuristic laboratory',
            payload: {}
        },
        {
            id: 'task-2-data_viz',
            type: 'data_viz',
            refined_prompt: 'Growth of laboratory equipment sales',
            payload: {
                chartType: 'bar',
                data: [
                    { label: '2020', value: 1.2 },
                    { label: '2021', value: 1.8 },
                    { label: '2022', value: 2.5 },
                    { label: '2023', value: 3.9 }
                ]
            }
        }
    ];

    logger.log('Starting Mixed Generation...');

    try {
        // Run in parallel to test concurrency if possible, or sequential
        const results = await Promise.all(tasks.map(async (task, index) => {
            logger.log(`Starting task ${task.id} (${task.type})...`);
            try {
                let url = '';
                if (task.type === 'data_viz') {
                    url = await vizStrategy.generate(task, index + 1);
                } else if (task.type === 'visual_concept') {
                    url = await photoStrategy.generate(task, index + 1);
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
        await vizStrategy.onModuleDestroy();
    }
}

verifyMixedGeneration();
