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

    const task: ImageTask = {
        refined_prompt: 'Explain the Autonomic Nervous System and its core components: Sympathetic (fight/flight), Parasympathetic (rest/digest), Enteric (gut brain), Heart Rate Variability, and Stress Response',
        task_type: 'html_infographic',
        metadata: {
            center_topic: {
                title: 'Autonomic Nervous System',
                description: 'The body\'s automatic control center'
            }
        }
    } as any;

    console.log('='.repeat(60));
    console.log('V2-CORE-01 Verification Test: Hub Template');
    console.log('='.repeat(60));

    try {
        const result = await htmlStrategy.performGeneration(task, 0);

        console.log('\n' + '='.repeat(60));
        console.log('✅ Test Completed Successfully!');
        console.log('='.repeat(60));
        console.log(`Image URL: ${result.url}`);
        console.log('\nVerification Checklist:');
        console.log('1. Check terminal logs for [FORENSIC] Center Topic Detected: Autonomic Nervous System');
        console.log('2. Open generated image to verify spokes are in perfect circle');
        console.log('3. Verify center shows "Autonomic Nervous System" (NOT "NBA 2026")');
        console.log('4. Check if watercolor style was applied to images');
        console.log('='.repeat(60));
    } catch (error) {
        console.error('\n❌ Test Failed:', error.message);
        console.error(error.stack);
    }
}

run();
