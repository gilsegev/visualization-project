import * as dotenv from 'dotenv';
dotenv.config();

import { DataVizStrategy } from '../src/image-gen/strategies/data-viz.strategy';
import { LocalStorageService } from '../src/image-gen/local-storage.service';
import { BrowserService } from '../src/image-gen/browser.service';
import { ImageTask } from '../src/image-gen/image-task.schema';
import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

async function verifyVideoExport() {
    const logger = new Logger('VideoExportTest');
    logger.log('Initializing Services...');

    const localStorage = new LocalStorageService();
    const browserService = new BrowserService();

    await browserService.onModuleInit();

    const strategy = new DataVizStrategy(localStorage, browserService);

    const task: ImageTask = {
        id: 'test-video-1',
        type: 'data_viz',
        refined_prompt: 'Animated Sales Growth',
        payload: {
            chartType: 'bar',
            data: [
                { label: 'Q1', value: 10 },
                { label: 'Q2', value: 40 },
                { label: 'Q3', value: 25 },
                { label: 'Q4', value: 60 }
            ]
        },
        exportType: 'animated'
    };

    logger.log('Starting Video Generation...');

    try {
        const { url } = await strategy.generate(task, 999);
        logger.log(`[SUCCESS] Video generated at: ${url}`);

        // Verify file exists
        const relativePath = url.startsWith('/') ? url.substring(1) : url;
        const publicPath = path.resolve(process.cwd(), 'public', relativePath); // Assuming local storage saves to public
        // Actually LocalStorageService saves to 'public/generated-images' and returns '/generated-images/...'
        // Let's check where it actually is.
        // LocalStorageService: upload(buffer, filename) -> returns `/generated-images/${filename}`
        // So path is `public/generated-images/${filename}`

        // But we need to handle the path correctly.
        const filePath = path.join(process.cwd(), 'public', url);

        if (fs.existsSync(filePath)) {
            logger.log(`[VERIFIED] File exists on disk: ${filePath}`);
            const stats = fs.statSync(filePath);
            logger.log(`[VERIFIED] File size: ${stats.size} bytes`);
        } else {
            logger.error(`[FAILURE] File NOT found at: ${filePath}`);
        }

    } catch (err) {
        logger.error('Video generation failed:', err);
    } finally {
        await browserService.onModuleDestroy();
    }
}

verifyVideoExport();
