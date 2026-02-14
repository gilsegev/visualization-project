import * as dotenv from 'dotenv';
dotenv.config();

import { HtmlInfographicStrategy } from '../src/image-gen/strategies/html-infographic.strategy';
import { BrowserService } from '../src/image-gen/browser.service';
import { LocalStorageService } from '../src/image-gen/local-storage.service';
import { ImageTask } from '../src/image-gen/image-task.schema';

async function run() {
    const configService = { get: (key: string) => process.env[key] } as any;
    const localStorage = new LocalStorageService();
    const browserService = new BrowserService();
    const htmlStrategy = new HtmlInfographicStrategy(configService, browserService, localStorage);

    const testCases = [
        {
            name: '5 Spokes (Dark Theme - Cyber Neon)',
            prompt: 'Create a Cyberpunk style infographic about Future Tech with 5 core components: AI, Crypto, VR, Quantum, Biotech. Use a dark neon aesthetic.',
            expectedItems: 5
        },
        {
            name: '3 Spokes (Light Theme - Nature Fresh)',
            prompt: 'Create a Wellness infographic about Morning Routines with 3 steps: Hydrate, Meditate, Stretch. Use a fresh natural aesthetic.',
            expectedItems: 3
        }
    ];

    console.log('='.repeat(60));
    console.log('V2-CORE-01 Verification Test: Hub Template (Multiple Scenarios)');
    console.log('='.repeat(60));

    try {
        for (const [index, testCase] of testCases.entries()) {
            console.log(`\nRunning Test Case ${index + 1}: ${testCase.name}`);

            const task: ImageTask = {
                refined_prompt: testCase.prompt,
                task_type: 'html_infographic',
                metadata: {
                    center_topic: {
                        title: 'Autonomic Nervous System',
                        description: 'The body\'s automatic control center'
                    }
                }
            } as any;

            const result = await htmlStrategy.performGeneration(task, index);

            console.log(`✅ ${testCase.name} Completed!`);
            console.log(`Image URL: ${result.url}`);
        }

        console.log('\n' + '='.repeat(60));
        console.log('All Tests Completed Successfully!');
        console.log('='.repeat(60));
        console.log('\nVerification Checklist:');
        console.log('1. Check terminal logs for [FORENSIC] output.');
        console.log('2. Open generated images to verify alignment.');
        console.log('3. Verify spoke counts (3 and 5) and strict alignment on Y axis.');
        console.log('='.repeat(60));

    } catch (error) {
        console.error('\n❌ Test Failed:', error.message);
        console.error(error.stack);
    } finally {
        // Cleanup: Close the browser to allow the script to exit
        await browserService.onModuleDestroy();
    }
}

run();
