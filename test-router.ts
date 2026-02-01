import { ImageRouterService } from './src/image-gen/image-router.service';
import * as dotenv from 'dotenv';
import { randomUUID } from 'crypto';

// Polyfill crypto.randomUUID if needed (for older node versions, though v20 should support it)
if (!global.crypto) {
    // @ts-ignore
    global.crypto = { randomUUID };
}

dotenv.config();

async function runTest() {
    const service = new ImageRouterService();
    const testInput = "Show me a bar chart of 2024 sales and a photo of a happy teacher.";

    console.log(`Testing input: "${testInput}"`);

    try {
        const tasks = await service.classify(testInput);
        console.log('Successfully classified tasks:');
        console.log(JSON.stringify(tasks, null, 2));

        // Basic validation logic matching expected result
        const hasDataViz = tasks.some(t => t.type === 'data_viz');
        const hasVisualConcept = tasks.some(t => t.type === 'visual_concept');

        if (hasDataViz && hasVisualConcept && tasks.length === 2) {
            console.log('✅ TEST PASSED: Found both data_viz and visual_concept.');
        } else {
            console.error('❌ TEST FAILED: Did not match expected output structure.');
        }

    } catch (error) {
        console.error('Test Failed with Error:', error);
    }
}

runTest();
