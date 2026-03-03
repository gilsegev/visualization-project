import * as dotenv from 'dotenv';
dotenv.config();

import { HtmlInfographicStrategy } from '../src/image-gen/strategies/html-infographic.strategy';
import { BrowserService } from '../src/image-gen/browser.service';
import { LocalStorageService } from '../src/image-gen/local-storage.service';
import { ImageTask } from '../src/image-gen/image-task.schema';

async function run() {
    console.log("Starting Test Script...");

    const configService = { get: (key: string) => process.env[key] } as any;
    const localStorage = new LocalStorageService();
    const browserService = new BrowserService();

    console.log("Services Initialized. Creating Strategy...");
    const htmlStrategy = new HtmlInfographicStrategy(configService, browserService, localStorage);
    console.log("Strategy Created.");

    console.log('='.repeat(60));
    console.log('V2-DEBUG-09 Diversity Verification Test');
    console.log('='.repeat(60));

    const args = process.argv.slice(2);
    const targetTemplate = args.includes('--template') ? args[args.indexOf('--template') + 1] : null;

    // Test 1: Step-Stone (The Journey of a Seed)
    if (!targetTemplate || targetTemplate === 'step_stone') {
        console.log('\n🔵 TEST 1: Step-Stone Template (The Journey of a Seed)');
        const taskStep: ImageTask = {
            refined_prompt: 'Create a Step Stone infographic about "The Journey of a Seed": Planting, Germination, Growth, Blooming, Harvest. Use a nature_fresh theme.',
            task_type: 'html_infographic',
            metadata: {
                template_id: 'step_stone',
                theme_id: 'nature_fresh'
            }
        } as any;

        try {
            console.log("Invoking performGeneration for Step-Stone...");
            const resultStep = await htmlStrategy.performGeneration(taskStep, 0);
            console.log(`✅ Step-Stone Generated: ${resultStep.url}`);
        } catch (error) {
            console.error('❌ Step-Stone Failed:', error.message);
            console.error(error.stack);
        }

    }

    // Test 2: Versus Split (Coffee vs Tea)
    if (!targetTemplate || targetTemplate === 'versus_split') {
        console.log('\n🔴 TEST 2: Versus Split Template (Coffee vs Tea)');
        const taskVersus: ImageTask = {
            refined_prompt: 'Create a Versus Split infographic comparing Coffee vs Tea. Wellness, Energy, Taste. Corporate Blue theme.',
            task_type: 'html_infographic',
            metadata: {
                template_id: 'versus_split',
                theme_id: 'corp_blue',
                versus_subjects: {
                    left_name: 'Coffee',
                    right_name: 'Tea',
                    left_image_prompt: 'Artistic coffee cup',
                    right_image_prompt: 'Green tea leaves'
                }
            }
        } as any;

        try {
            console.log("Invoking performGeneration for Versus...");
            const resultVersus = await htmlStrategy.performGeneration(taskVersus, 1);
            console.log(`✅ Versus Generated: ${resultVersus.url}`);
        } catch (error) {
            console.error('❌ Versus Failed:', error.message);
            console.error(error.stack);
        }

    }

    // Test 3: Bento Grid (Product Features)
    if (!targetTemplate || targetTemplate === 'bento_grid') {
        console.log('\n🟡 TEST 3: Bento Grid Template (Smart Home Devices)');
        const taskBento: ImageTask = {
            refined_prompt: 'Create a Bento Grid infographic about Smart Home Devices: Smart Hub, Smart Lock, Smart Camera. Cyber Neon theme.',
            task_type: 'html_infographic',
            metadata: {
                template_id: 'bento_grid',
                theme_id: 'cyber_neon'
            }
        } as any;

        try {
            console.log("Invoking performGeneration for Bento...");
            const resultBento = await htmlStrategy.performGeneration(taskBento, 2);
            console.log(`✅ Bento Generated: ${resultBento.url}`);
        } catch (error) {
            console.error('❌ Bento Failed:', error.message);
            console.error(error.stack);
        }

    }

    // Test 4: Hub Radial (AI Ecosystem) - ADDED FOR REGRESSION CHECK
    if (!targetTemplate || targetTemplate === 'hub_radial') {
        console.log('\n🟢 TEST 4: Hub Radial Template (AI Ecosystem)');
        const taskHub: ImageTask = {
            refined_prompt: 'Create a Hub Radial infographic about "AI Ecosystem": Machine Learning, Neural Networks, NLP, Robotics, Computer Vision. Cyber Neon theme.',
            task_type: 'html_infographic',
            metadata: {
                template_id: 'hub_radial',
                theme_id: 'cyber_neon'
            }
        } as any;

        try {
            console.log("Invoking performGeneration for Hub Radial...");
            const resultHub = await htmlStrategy.performGeneration(taskHub, 3);
        } catch (error) {
            console.error('❌ Hub Radial Failed:', error.message);
            console.error(error.stack);
        }
    }

    console.log("Test Script Complete. Cleaning up...");
    await browserService.onModuleDestroy();
    process.exit(0);
}

run().catch(err => console.error("Unhandled Error in run():", err));
