
import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { HtmlInfographicStrategy } from '../src/image-gen/strategies/html-infographic.strategy';
import { BrowserService } from '../src/image-gen/browser.service';
import { LocalStorageService } from '../src/image-gen/local-storage.service';
import { ImageTask } from '../src/image-gen/image-task.schema';
import { ConfigService } from '@nestjs/config';

async function runJsonTest() {
    console.log("📋 Starting E2E Test with JSON Input...");

    const jsonPath = path.join(process.cwd(), 'public', 'assets', 'test.json');
    if (!fs.existsSync(jsonPath)) {
        console.error(`❌ File not found: ${jsonPath}`);
        return;
    }

    const fileContent = fs.readFileSync(jsonPath, 'utf-8');
    const inputData = JSON.parse(fileContent);

    console.log(`ℹ️  Course: ${inputData.course_metadata.title}`);
    console.log(`ℹ️  Style Philosophy: ${inputData.course_metadata.global_style_guide.philosophy}`);

    const configService = { get: (key: string) => process.env[key] } as ConfigService;
    const localStorage = new LocalStorageService();
    const browserService = new BrowserService();
    const strategy = new HtmlInfographicStrategy(configService, browserService, localStorage);

    // Map style guide to a supported theme roughly
    // "Warm, approachable, wellness bookshop aesthetic" -> 'nature_fresh' or 'warm_creative'
    const theme = 'nature_fresh';

    const visualizations = inputData.visualizations;
    console.log(`ℹ️  Found ${visualizations.length} visualizations.`);

    for (const viz of visualizations) {
        console.log('\n' + '-'.repeat(50));
        console.log(`🎬 Processing: ${viz.title} (${viz.id})`);
        console.log(`📝 Template: ${viz.suggested_template}`);
        console.log(`📄 Description: ${viz.description}`);

        // Construct prompt
        // We explicitly mention the template and theme to guide the LLM
        const prompt = `Create a ${viz.suggested_template} infographic about "${viz.title}". ${viz.description}. Theme: ${theme}.`;

        const task: ImageTask = {
            id: viz.id,
            unique_id: viz.id, // Adding unique_id to satisfy potential interface requirements, though id should suffice
            task_type: 'html_infographic',
            refined_prompt: prompt,
            original_prompt: viz.description,
            status: 'pending',
            metadata: {
                template_id: viz.suggested_template,
                theme_id: theme
            }
        } as any;

        try {
            console.log(`🚀 Generative Prompt: "${prompt}"`);
            const startTime = Date.now();
            const result = await strategy.performGeneration(task);
            const duration = (Date.now() - startTime) / 1000;

            console.log(`✅ Generated in ${duration.toFixed(2)}s`);
            console.log(`📂 URL: ${result.url}`);

            // Save debug info map
            if (result.payload?.blueprint) {
                console.log(`🎨 Blueprint Template: ${result.payload.blueprint.template_id}`);
                console.log(`🎨 Blueprint Theme: ${result.payload.blueprint.theme_id}`);
            }

        } catch (error) {
            console.error(`❌ Failed to generate ${viz.id}:`, error.message);
        }
    }

    console.log('\n✅ JSON Test Complete.');
}

runJsonTest().catch(err => console.error("Unhandled Error:", err));
