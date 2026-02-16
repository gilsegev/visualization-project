
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { ImageOrchestratorService } from './src/image-gen/image-orchestrator.service';
import * as dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule);
    const orchestrator = app.get(ImageOrchestratorService);

    const manifest = {
        course: { title: "Stress Management Foundation" },
        lessons: [
            {
                lesson_id: "bento-stress-test",
                lesson_title: "Domains of Stress",
                visualizations: [
                    {
                        id: "viz_bento_stress_domains",
                        type: "bento_grid",
                        description: `
Generate a bento_grid blueprint for the "Domains of Stress" lesson.

1. Hero Slot (Image Only): Assign a [6x12] span to a central cell. Generate a high-fidelity "Gender-neutral human silhouette with glowing stress points" (Body Map) using the SiliconFlow API.
2. Detail Slots (Title + Text): Surround the hero with 4 smaller cells [3x6] representing the Physiological, Behavioral, Cognitive, and Emotional domains.
3. Visual Signaling: Apply a 4px solid #E8A598 (Soft Coral) border to the Physiological cell to signal "High Alert".
4. Environmental Layering: Set the background.color to #F5E6D3 (Warm Sand). Generate a soft, abstract "Mindfulness nature background" and apply it at 15% opacity to the whole canvas.
                        `,
                        context: "Advanced clinical visualization for stress recognition.",
                        globalStyleGuide: {
                            primary_accent: "#5B9A8B", // Muted Teal
                            secondary_accent: "#E8A598", // Soft Coral
                            text_main: "#4A5568", // Slate Grey
                            background_main: "#F5E6D3", // Warm Sand
                            font_name: "Inter"
                        },
                        dimensions: { width: 1200, height: 1200 }
                    }
                ]
            }
        ]
    };

    console.log('--- STARTING BENTO STRESS TEST ---');
    try {
        const result: any = await orchestrator.generateFromManifest(manifest);
        console.log('Stress Test completed successfuly.');

        if (result.results && result.results.length > 0) {
            const res = result.results[0];
            if (res.error) {
                console.error('Task failed:', res.error);
            } else {
                console.log('Gallery URL:', res.url);
                console.log('Poster Location:', res.posterUrl);
            }
        }
    } catch (err) {
        console.error('Bento Stress Test Failed:', err);
    }

    await app.close();
}

bootstrap();
