import * as dotenv from 'dotenv';
dotenv.config();

import { CourseOrchestratorService } from '../src/courses/course-orchestrator.service';
import { HtmlInfographicStrategy } from '../src/image-gen/strategies/html-infographic.strategy';
import { BrowserService } from '../src/image-gen/browser.service';
import { LocalStorageService } from '../src/image-gen/local-storage.service';
import { ConfigService } from '@nestjs/config';
import { CourseJob } from '../src/courses/course.dto';

async function run() {
    // Setup Services
    const configService = { get: (key: string) => process.env[key] } as any;
    const localStorage = new LocalStorageService();
    const browserService = new BrowserService();
    const htmlStrategy = new HtmlInfographicStrategy(configService, browserService, localStorage);
    const orchestrator = new CourseOrchestratorService(configService, htmlStrategy);

    // Mindfulness & Stress Management Course Spec
    const courseJob: CourseJob = {
        metadata: {
            title: 'Mindfulness & Stress Management',
            audience: 'Young professionals experiencing workplace stress',
            global_style_guide: 'Calming, nature-inspired aesthetics with soft gradients'
        },
        visualizations: [
            {
                prompt: 'Lesson 1.1: Core pillars of mindfulness practice',
                center_topic: {
                    title: 'Mindfulness',
                    description: 'Present moment awareness without judgment'
                }
            },
            {
                prompt: 'Lesson 1.2: Essential stress management techniques for daily use'
            }
        ]
    };

    console.log('='.repeat(60));
    console.log('V2-ORCH-01 Batch Verification Test');
    console.log('='.repeat(60));

    try {
        const result = await orchestrator.processCourse(courseJob);

        console.log('\n' + '='.repeat(60));
        console.log('✅ Test Completed Successfully!');
        console.log('='.repeat(60));
        console.log(`Course ID: ${result.courseId}`);
        console.log(`Images Generated: ${result.images.length}`);
        console.log('\nImage Paths:');
        result.images.forEach((img, idx) => {
            console.log(`  ${idx + 1}. ${img}`);
        });
        console.log('='.repeat(60));
    } catch (error) {
        console.error('\n❌ Test Failed:', error.message);
        console.error(error.stack);
    }
}

run();
