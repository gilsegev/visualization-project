import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Validation Test for Prompt 43.2: Wellness Aesthetic Restoration
 * Tests: Autonomic Nervous System (hub_radial) & 6 Stages of Stress (step_stone)
 */
async function runWellnessValidation() {
    console.log('🌿 Wellness Aesthetic Validation (Prompt 43.2)');
    console.log('='.repeat(60));

    const tests = [
        {
            name: 'Autonomic Nervous System (Hub Radial)',
            courseId: 'wellness_hub_test_' + Date.now(),
            payload: {
                course_id: 'wellness_hub_' + Date.now(),
                course_metadata: {
                    title: 'Managing Stress with Mindfulness',
                    target_audience: 'Wellness practitioners and students',
                    global_style_guide: {
                        philosophy: 'Present complex wellness concepts with elegance and serenity',
                        palette: ['#5DA9A4', '#F5E6D3', '#2C4A52'],
                        font_preferences: 'Elegant serif for headings',
                        image_style: 'Sophisticated wellness book illustration'
                    }
                },
                visualizations: [{
                    id: 'ans_system',
                    lesson: 'Nervous System Overview',
                    title: 'Autonomic Nervous System Components',
                    objective: 'Understand the sympathetic and parasympathetic systems',
                    description: 'The autonomic nervous system regulates involuntary body functions',
                    suggested_template: 'hub_radial'
                }]
            }
        },
        {
            name: '6 Stages of Stress (Step Stone)',
            courseId: 'wellness_zigzag_test_' + Date.now(),
            payload: {
                course_id: 'wellness_zigzag_' + Date.now(),
                course_metadata: {
                    title: 'Understanding Stress Response',
                    target_audience: 'Wellness practitioners',
                    global_style_guide: {
                        philosophy: 'Guide understanding through stress stages with calm visual flow',
                        palette: ['#5DA9A4', '#F5E6D3', '#2C4A52'],
                        font_preferences: 'Clean sans-serif',
                        image_style: 'Watercolor wellness illustration'
                    }
                },
                visualizations: [{
                    id: 'stress_stages',
                    lesson: 'Stress Journey',
                    title: '6 Stages of Stress Response',
                    objective: 'Understand progression from alarm to recovery',
                    description: 'Stress progresses through distinct stages from initial alarm to recovery',
                    suggested_template: 'step_stone'
                }]
            }
        }
    ];

    for (const test of tests) {
        console.log(`\n📋 Test: ${test.name}`);
        console.log('-'.repeat(60));

        try {
            const startTime = Date.now();
            const response = await axios.post(
                'http://localhost:3006/v1/course-visualizations',
                test.payload,
                { timeout: 300000 }
            );
            const duration = Date.now() - startTime;

            console.log(`✓ Completed in ${Math.round(duration / 1000)}s`);
            console.log(`  Style Anchor: "${response.data.global_style_anchor}"`);
            console.log(`  Image URL: ${response.data.images[0]?.url}`);

            // Check for wellness keywords
            const styleAnchor = response.data.global_style_anchor.toLowerCase();
            const hasWellness = styleAnchor.includes('watercolor') ||
                styleAnchor.includes('wellness') ||
                styleAnchor.includes('sophisticated') ||
                styleAnchor.includes('organic');

            console.log(`  Wellness Style: ${hasWellness ? '✓ PASSED' : '✗ FAILED'}`);

        } catch (error: any) {
            console.error(`✗ Test FAILED: ${error.response?.data?.message || error.message}`);
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('🏁 Validation Complete');
    console.log('\n💡 Visual Check: Open generated images and verify:');
    console.log('   1. Hub center is pixel-perfect centered between spokes');
    console.log('   2. Images have watercolor/organic texture (not flat)');
    console.log('   3. Cards align perfectly with icons');
    console.log('   4. Overall feel is "warm and expensive"');
}

runWellnessValidation();
