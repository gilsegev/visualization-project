import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { ImageOrchestratorService } from './src/image-gen/image-orchestrator.service';
import { Logger } from '@nestjs/common';
import * as dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
    const logger = new Logger('StylingVerification');
    const app = await NestFactory.createApplicationContext(AppModule);
    const orchestrator = app.get(ImageOrchestratorService);

    const manifestation = {
        course: { title: "Styling Verify Final" },
        lessons: [
            {
                title: "Cross Template Showcase",
                items: [
                    {
                        type: "infographic",
                        description: "Modern AI Hub with 4 nodes.",
                        metadata: {
                            theme_id: "cyber_neon",
                            dimensions: { width: 1024, height: 1024 }
                        }
                    },
                    {
                        type: "infographic",
                        description: "Step journey of 'Organic Coffee Production'.",
                        metadata: {
                            theme_id: "nature_fresh",
                            dimensions: { width: 1200, height: 800 }
                        }
                    },
                    {
                        type: "infographic",
                        description: "Comparison of 'Public Cloud' vs 'Private Cloud'.",
                        metadata: {
                            theme_id: "corp_blue",
                            dimensions: { width: 1200, height: 1200 }
                        }
                    }
                ]
            }
        ]
    };

    logger.log('Starting Cross-Template Styling Verification...');
    try {
        const response = await orchestrator.generateFromManifest(manifestation);
        logger.log(`Batch started: ${response.message}. Task count: ${response.taskCount}`);

        // Wait for generation to finish (approx 90s for 3 images)
        logger.log('Waiting for generation to complete (90s)...');
        await new Promise(r => setTimeout(r, 90000));
        logger.log('Wait complete.');

    } catch (error) {
        logger.error('Styling variations generation failed', error);
    } finally {
        await app.close();
    }
}

bootstrap();
