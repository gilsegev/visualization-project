// BROKEN SCRIPT - BLOCKING BUILD
// import { NestFactory } from '@nestjs/core';
// import { AppModule } from 'src/app.module';
// import { ImageGenService } from 'src/image-gen/image-gen.service';
// import { Logger } from '@nestjs/common';

// async function bootstrap() {
//     const app = await NestFactory.createApplicationContext(AppModule);
//     const imageGenService = app.get(ImageGenService);
//     const logger = new Logger('ThemedGenerationTest');

//     // TEST CASE: "The Future of Quantum Computing"
//     // Expectation: Theme = 'cyber_neon' (Dark Background)
//     const prompt = "The Future of Quantum Computing. Focus on qubits, superposition, and entanglement.";

//     logger.log(`Running Themed Generation Test for: "${prompt}"`);

//     try {
//         const result = await imageGenService.generateImage({
//             prompt: prompt,
//             aspectRatio: '1:1',
//             enhancePrompt: true
//         });

//         logger.log(`Generation Complete! URL: ${result.url}`);
//         logger.log(`Check debug_last_run.html to verify background color is NOT #FAF9F6`);

//     } catch (error) {
//         logger.error('Test Failed', error);
//     } finally {
//         await app.close();
//         process.exit(0);
//     }
// }

// bootstrap();
