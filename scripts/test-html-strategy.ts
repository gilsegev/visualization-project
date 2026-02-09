import { HtmlInfographicStrategy, HtmlInfographicBlueprint } from '../src/image-gen/strategies/html-infographic.strategy';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env
dotenv.config({ path: path.join(__dirname, '../.env') });

// Mock Logger
Logger.overrideLogger(['log', 'error', 'warn', 'debug', 'verbose']);

// Mock ConfigService
const mockConfigService = {
    get: (key: string) => {
        if (key === 'GEMINI_API_KEY') return process.env.GEMINI_API_KEY;
        return null;
    }
} as unknown as ConfigService;

async function run() {
    console.log('--- Testing HtmlInfographicStrategy ---');

    // Instantiate with mock dependency
    const strategy = new HtmlInfographicStrategy({
        get: (key: string) => process.env[key]
    } as any, {
        screenshotHtml: async () => Buffer.from('mock_png_buffer'),
        getNewPage: async () => ({ context: { close: async () => { } }, page: { setViewportSize: async () => { }, setContent: async () => { }, waitForLoadState: async () => { }, $: async () => null, screenshot: async () => Buffer.from('mock_png_buffer') } })
    } as any, {
        save: async () => 'mock_public_url'
    } as any);

    try {
        console.log('1. Testing loadTemplate("hub_radial")...');
        const hubTemplate = strategy.loadTemplate('hub_radial');
        console.log(`PASS: Template loaded. Length: ${hubTemplate.length}`);

        console.log('\n2. Testing loadTemplate("step_list")...');
        const stepTemplate = strategy.loadTemplate('step_list');
        console.log(`PASS: Template loaded. Length: ${stepTemplate.length}`);

        console.log('\n3. Testing generateBlueprint (Mock Call)...');
        // We are just checking if the method exists and throws the expected error (invalid key/network) or proceeds
        if (process.env.GEMINI_API_KEY) {
            console.log('   GEMINI_API_KEY found, attempting real call...');
            try {
                console.log('   Testing blueprint for: "The lifecycle of a star"');
                const blueprint = await strategy.generateBlueprint("The lifecycle of a star");
                console.log('   PASS: Blueprint generated:', JSON.stringify(blueprint, null, 2));

                // Basic validation checks
                const isStepList = blueprint.template_id === 'step_list';
                const hasItems = blueprint.items && blueprint.items.length > 0;

                // Check HTML Preview for injected content
                // The strategy returns { payload: { html: "..." } }
                const result = await strategy.performGeneration({ refined_prompt: "The lifecycle of a star" } as any);
                const generatedHtml = (result.payload as any).html;

                const hasBase64 = generatedHtml.includes('data:image/png;base64');
                const hasTitle = generatedHtml.includes(blueprint.items[0].title);

                console.log('   generatedHtml length:', generatedHtml.length);
                console.log('   generatedHtml preview (body start):', generatedHtml.substring(generatedHtml.indexOf('<body'), generatedHtml.indexOf('<body') + 300) + '...');

                if (isStepList && hasItems && hasBase64 && hasTitle) {
                    console.log('   VALIDATION SUCCESS: Blueprint generated AND HTML populated with images/content.');
                } else {
                    console.warn('   VALIDATION WARNING: Generated structure might not match expectations entirely.');
                    console.log(`   Expected step_list: ${isStepList}`);
                    console.log(`   Has items: ${hasItems}`);
                    console.log(`   Has Base64 images: ${hasBase64}`);
                    console.log(`   Has Title (${blueprint.items[0].title}): ${hasTitle}`);
                }
            } catch (e) {
                console.log(`   FAIL: Blueprint generation error (expected if network/key issues): ${e.message}`);
            }
        } else {
            console.log('   Skipping actual LLM call (checked code structure).');
            // We can manually check if the method is defined
            if (typeof strategy.generateBlueprint === 'function') {
                console.log('   PASS: generateBlueprint method exists.');
            }
        }

    } catch (e) {
        console.error('FAIL: Unexpected error during test:', e);
    }
}

run();
