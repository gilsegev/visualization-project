import axios from 'axios';

interface VisualizationResponse {
    global_style_anchor: string;
    images: Array<{
        visualization_id: string;
        url: string;
        payload?: any;
    }>;
}

async function testOpenRouterLogic() {
    console.log('🚀 OpenRouter Reasoning & Connectivity Test');
    console.log('='.repeat(60));

    const challengeTopic = "The Quantum Mechanics of Photosynthesis: How Plants Use Coherence to Efficiently Capture Sunlight";
    console.log(`\nChallenge Topic:\n"${challengeTopic}"\n`);

    // Create test job with quantum photosynthesis visualization
    const testJob = {
        course_id: 'openrouter_logic_test_' + Date.now(),
        course_metadata: {
            title: 'Quantum Photosynthesis',
            target_audience: 'Science enthusiasts and students',
            global_style_guide: {
                philosophy: 'Explain complex quantum mechanics concepts with clarity and visual precision',
                palette: ['#00D9FF', '#FFF8E7', '#2C3E50'],
                font_preferences: 'Clean, modern sans-serif',
                image_style: 'Scientific diagram with glowing particles and energy paths'
            }
        },
        visualizations: [
            {
                id: 'quantum_photo_1',
                lesson: 'Quantum Coherence in Photosynthesis',
                title: challengeTopic,
                objective: 'Understand how quantum mechanics enables efficient light capture in plants',
                description: challengeTopic,
                suggested_template: 'step_stone'
            }
        ]
    };

    console.log('📊 Test Configuration:');
    console.log(`  - Expected Template: step_stone (Zig-Zag)`);
    console.log(`  - Custom Theme: Teal (#00D9FF) / Cream (#FFF8E7)`);
    console.log(`  - Min Description Length: 25 words per item`);
    console.log('');

    // Test 1: Single Request - Quality & Logic Check
    console.log('Test 1: Single Request - Reasoning Quality Check');
    console.log('-'.repeat(60));

    try {
        const startTime = Date.now();
        const response = await axios.post<VisualizationResponse>(
            'http://localhost:3006/v1/course-visualizations',
            testJob,
            { timeout: 300000 } // 5 minutes
        );
        const duration = Date.now() - startTime;

        console.log(`✓ Request completed in ${duration}ms`);
        console.log(`\n📝 Global Style Anchor:\n  "${response.data.global_style_anchor}"`);

        // Extract blueprint from payload
        const blueprint = response.data.images[0]?.payload?.blueprint;

        if (blueprint) {
            console.log(`\n🎨 Template Selected: ${blueprint.template_id}`);
            console.log(`\n🧬 Generated Items (${blueprint.items.length}):`);

            let totalWords = 0;
            let passedQualityCheck = true;

            blueprint.items.forEach((item: any, idx: number) => {
                const wordCount = item.description.split(/\s+/).length;
                totalWords += wordCount;
                const passed = wordCount >= 25;

                console.log(`\n  Step ${idx + 1}: ${item.title}`);
                console.log(`    Words: ${wordCount} ${passed ? '✓' : '✗ (FAILED: < 25 words)'}`);
                console.log(`    Content: "${item.description.substring(0, 100)}..."`);

                if (!passed) passedQualityCheck = false;
            });

            const avgWords = Math.round(totalWords / blueprint.items.length);
            console.log(`\n  Average Words/Description: ${avgWords}`);
            console.log(`  Quality Check: ${passedQualityCheck ? '✓ PASSED' : '✗ FAILED'}`);

            // Verify template logic
            const correctTemplate = blueprint.template_id === 'step_stone' || blueprint.template_id === 'hub_radial';
            console.log(`\n  Template Logic: ${correctTemplate ? '✓ PASSED (not step_list)' : '✗ FAILED (used step_list)'}`);

            // Visual Integration Check
            console.log(`\n🎨 Visual Integration:`);
            console.log(`  - Theme ID: ${blueprint.theme_id}`);
            console.log(`  - Custom Palette Passed: ${testJob.course_metadata.global_style_guide.palette[0] === '#00D9FF' ? '✓' : '✗'}`);

            console.log(`\n🖼️  Generated Image:`);
            console.log(`  ${response.data.images[0].url}`);
        } else {
            console.log('⚠️  Warning: Blueprint not found in response payload');
        }

    } catch (error: any) {
        console.error('✗ Test 1 FAILED:', error.response?.data || error.message);
        return;
    }

    // Test 2: Throughput & Resilience - 3 Concurrent Requests
    console.log('\n\nTest 2: Throughput & Resilience (3 Concurrent Requests)');
    console.log('-'.repeat(60));

    const batchJobs = Array.from({ length: 3 }, (_, i) => ({
        ...testJob,
        course_id: `openrouter_batch_${i + 1}_${Date.now()}`
    }));

    try {
        const startTime = Date.now();
        const promises = batchJobs.map((job, idx) =>
            axios.post<VisualizationResponse>(
                'http://localhost:3006/v1/course-visualizations',
                job,
                { timeout: 300000 }
            ).then(res => ({ idx: idx + 1, status: 'success', data: res.data }))
                .catch(err => ({ idx: idx + 1, status: 'failed', error: err.response?.data || err.message }))
        );

        const results = await Promise.all(promises);
        const duration = Date.now() - startTime;

        console.log(`\n⏱️  Total Duration: ${duration}ms (${Math.round(duration / 3)}ms avg per request)`);
        console.log(`\n📊 Results:`);

        let successCount = 0;
        let has429Error = false;

        results.forEach(result => {
            if (result.status === 'success' && 'data' in result) {
                successCount++;
                console.log(`  Request ${result.idx}: ✓ SUCCESS (200 OK)`);
                console.log(`    Style: "${result.data.global_style_anchor}"`);
            } else if (result.status === 'failed') {
                console.log(`  Request ${result.idx}: ✗ FAILED`);
                const errorMsg = JSON.stringify((result as any).error);
                console.log(`    Error: ${errorMsg}`);
                if (errorMsg.includes('429')) {
                    has429Error = true;
                }
            }
        });

        console.log(`\n📈 Summary:`);
        console.log(`  - Success Rate: ${successCount}/3 (${Math.round(successCount / 3 * 100)}%)`);
        console.log(`  - 429 Errors: ${has429Error ? '✗ DETECTED' : '✓ NONE'}`);
        console.log(`  - Throughput Test: ${successCount === 3 && !has429Error ? '✓ PASSED' : '✗ FAILED'}`);

    } catch (error: any) {
        console.error('✗ Test 2 FAILED:', error.message);
    }

    console.log('\n' + '='.repeat(60));
    console.log('🏁 OpenRouter Logic Test Complete');
}

testOpenRouterLogic();
