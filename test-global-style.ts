
import { NestFactory } from '@nestjs/core';
import { ImageGenModule } from './src/image-gen/image-gen.module';
import { ImageOrchestratorService } from './src/image-gen/image-orchestrator.service';
import * as dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(ImageGenModule);
    const orchestrator = app.get(ImageOrchestratorService);

    const manifest = {
        course: {
            title: "Style Guide Verification",
            designPhilosophy: "Calm, grounded, professional. Minimalist flat design.",
            globalStyleGuide: {
                colorPalette: {
                    mutedTeal: "#5B9A8B",
                    warmSand: "#F5E6D3",
                    softCoral: "#E8A598",
                    slateGrey: "#4A5568",
                    creamWhite: "#FAF9F6",
                    deepNavy: "#1A365D"
                },
                typography: {
                    fontFamily: ["Inter"],
                    headingSize: "1.8rem",
                    bodySize: "1rem"
                }
            },
            lessons: [
                {
                    lessonId: "manifest-style-test",
                    title: "Advanced Styling Verification",
                    visualizations: [
                        {
                            type: "hub_radial",
                            description: "The Science of Deep Focus and Productivity",
                            context: "Focus on the relationship between environment, neurochemistry, and habits.",
                            dimensions: { width: 1200, height: 1200 }
                        },
                        {
                            type: "versus_split",
                            description: "Deep Work vs Shallow Work",
                            context: "Compare the quality of output, cognitive load, and long-term value.",
                            dimensions: { width: 1200, height: 1200 }
                        }
                    ]
                }
            ]
        }
    };

    console.log('--- STARTING GLOBAL STYLE VERIFICATION ---');
    try {
        const results: any = await orchestrator.generateFromManifest(manifest);
        console.log('Generation completed successfully.');
        results.results.forEach((res: any, i: number) => {
            if (res.error) {
                console.error(`Task ${i} failed:`, res.error);
            } else {
                console.log(`Result ${i} (${res.type}): ${res.url}`);
            }
        });
    } catch (error) {
        console.error('Fatal error during generation:', error);
    } finally {
        await app.close();
    }
}

bootstrap();
