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

    console.log('='.repeat(60));
    console.log('V2-TEST-01: Template Diversity Audit');
    console.log('='.repeat(60));

    const tasks: Array<{ name: string; task: ImageTask }> = [
        {
            name: 'Task A: Step-Stone (Linear)',
            task: {
                refined_prompt: 'The 5 Stages of Burnout: Initial enthusiasm, stagnation, frustration, apathy, complete burnout',
                task_type: 'html_infographic',
                metadata: { theme: 'wellness_mindful' }
            } as any
        },
        {
            name: 'Task B: Bento Grid (Categories)',
            task: {
                refined_prompt: '4 Pillars of Mindfulness: Present moment awareness, non-judgmental observation, focused breathing, body scan meditation',
                task_type: 'html_infographic',
                metadata: { theme: 'wellness_mindful' }
            } as any
        },
        {
            name: 'Task C: Versus Split (Comparison)',
            task: {
                refined_prompt: 'Sympathetic vs Parasympathetic Nervous System: Fight-or-flight response versus rest-and-digest mode',
                task_type: 'html_infographic',
                metadata: { theme: 'wellness_mindful' }
            } as any
        }
    ];

    for (let i = 0; i < tasks.length; i++) {
        const { name, task } = tasks[i];
        console.log(`\n${'-'.repeat(60)}`);
        console.log(`${name}`);
        console.log('-'.repeat(60));

        try {
            const result = await htmlStrategy.performGeneration(task, i);
            console.log(`✅ Generated: ${result.url}`);
        } catch (error) {
            console.error(`❌ Failed: ${error.message}`);
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('Diversity Audit Complete!');
    console.log('='.repeat(60));
    console.log('\nVerification Checklist:');
    console.log('[ ] Step-Stone: Zig-zag lines connect icons to cards');
    console.log('[ ] Bento Grid: No overlapping or gaps');
    console.log('[ ] Versus Split: Left/Right images balanced');
    console.log('[ ] All templates: Solid cream (#FAF9F6) backgrounds');
    console.log('[ ] All templates: Dark text (#2D3748)');
    console.log('[ ] Check debug_last_run.html for each generation');
    console.log('='.repeat(60));
}

run();
