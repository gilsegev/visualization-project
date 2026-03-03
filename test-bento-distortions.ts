
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { ImageOrchestratorService } from './src/image-gen/image-orchestrator.service';
import * as dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule);
    const orchestrator = app.get(ImageOrchestratorService);

    const manifest = {
        course: { title: "Cognitive Behavioral Therapy" },
        lessons: [
            {
                lesson_id: "bento-distortions-01",
                lesson_title: "Common Cognitive Distortions",
                visualizations: [
                    {
                        id: "viz_bento_distortions",
                        type: "bento_grid",
                        description: "A summary of cognitive distortions including Fortune Telling, All-or-Nothing Thinking, Mind Reading, Overgeneralization, Mental Filter, Disqualifying the Positive, and Catastrophizing. Use a large 8x6 hero cell for the 'Summary of CBT' and smaller 4x3 cells for each distortion.",
                        context: "Professional medical summary for patient education.",
                        globalStyleGuide: {
                            primary_accent: "#5B9A8B", // Muted Teal
                            secondary_accent: "#E8A598", // Soft Coral
                            text_main: "#4A5568", // Slate Grey
                            background_main: "#FAF9F6", // Cream White
                            font_name: "Inter",
                            font_size_heading: "1.8rem",
                            font_size_body: "1rem"
                        },
                        dimensions: { width: 1200, height: 1200 }
                    }
                ]
            }
        ]
    };

    console.log('--- STARTING BENTO VERIFICATION ---');
    try {
        const result: any = await orchestrator.generateFromManifest(manifest);
        console.log('Verification Result:', JSON.stringify(result, null, 2));
    } catch (err) {
        console.error('Bento Verification Failed:', err);
    }

    await app.close();
}

bootstrap();
