import { HtmlInfographicStrategy } from '../src/image-gen/strategies/html-infographic.strategy';
import { Logger } from '@nestjs/common';
// Mock Logger
Logger.overrideLogger(['log', 'error', 'warn', 'debug', 'verbose']);

async function run() {
    console.log('--- Testing HtmlInfographicStrategy ---');

    // Instantiate directly (mocking dependencies if any needed - BaseImageStrategy doesn't seem to need any specific DI for this part)
    const strategy = new HtmlInfographicStrategy();

    try {
        console.log('1. Testing loadTemplate("hub_radial")...');
        const hubTemplate = strategy.loadTemplate('hub_radial');
        console.log(`PASS: Template loaded. Length: ${hubTemplate.length}`);
        console.log(`Preview: ${hubTemplate.substring(0, 100)}...`);

        console.log('\n2. Testing loadTemplate("step_list")...');
        const stepTemplate = strategy.loadTemplate('step_list');
        console.log(`PASS: Template loaded. Length: ${stepTemplate.length}`);

        console.log('\n3. Testing loadTemplate("non_existent")...');
        try {
            strategy.loadTemplate('non_existent');
            console.error('FAIL: Should have thrown error for non-existent template');
        } catch (e) {
            console.log(`PASS: Correctly threw error: ${e.message}`);
        }

    } catch (e) {
        console.error('FAIL: Unexpected error during test:', e);
    }
}

run();
