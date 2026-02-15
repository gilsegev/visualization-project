import { NestFactory } from '@nestjs/core';
import { ImageGenModule } from '../src/image-gen/image-gen.module';
import { ImageOrchestratorService } from '../src/image-gen/image-orchestrator.service';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import * as dotenv from 'dotenv';
import { BrowserService } from '../src/image-gen/browser.service';

dotenv.config();

async function bootstrap() {
    const logger = new Logger('E2E Audit');
    const app = await NestFactory.createApplicationContext(ImageGenModule);

    // Ensure BrowserService is initialized
    const browserService = app.get(BrowserService);
    await browserService.onModuleInit();

    try {
        const orchestrator = app.get(ImageOrchestratorService);

        // Load Manifest
        const manifestPath = path.join(process.cwd(), 'public', 'assets', 'test.json');
        if (!fs.existsSync(manifestPath)) {
            logger.error(`Manifest not found at ${manifestPath}`);
            return;
        }
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

        logger.log('🚀 Starting E2E Performance Audit...');

        // Execute
        const report = await orchestrator.generateFromManifest(manifest);

        logger.log('\n📊 === E2E AUDIT REPORT ===');
        logger.log(`Total Duration: ${report.metadata.durationSeconds}s`);
        logger.log(`Tasks: ${report.metadata.total}`);

        report.results.forEach((res: any) => {
            if (res.error) {
                logger.error(`❌ [${res.taskId}] Failed: ${res.error}`);
            } else {
                logger.log(`✅ [${res.taskId}] Success: ${res.url}`);
            }
        });

    } catch (error) {
        logger.error('E2E Execution Failed', error);
    } finally {
        await browserService.onModuleDestroy();
        await app.close();
    }
}

bootstrap();
