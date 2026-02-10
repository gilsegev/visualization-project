import axios from 'axios';

/**
 * Prompt 47 Autopsy Test: ANS Hub with Full Debug Logging
 */
async function autopsyTest() {
    console.log('🔍 Prompt 47 Autopsy Test - Autonomic Nervous System Hub\n');

    const payload = {
        course_id: `ans_autopsy_${Date.now()}`,
        course_metadata: {
            title: 'Autonomic Nervous System',
            target_audience: 'Wellness students',
            global_style_guide: {
                philosophy: 'Clean watercolor wellness aesthetic',
                palette: ['#5DA9A4', '#F5E6D3', '#2C4A52'],
                font_preferences: 'Elegant serif',
                image_style: 'Watercolor wellness book, charcoal line-art'
            }
        },
        visualizations: [{
            id: 'ans_hub_autopsy',
            lesson: 'ANS Overview',
            title: 'The Autonomic Nervous System',
            objective: 'Understand ANS branches',
            description: 'The autonomic nervous system regulates involuntary functions through sympathetic, parasympathetic, and enteric divisions.',
            suggested_template: 'hub_radial'
        }]
    };

    try {
        console.log('📤 Sending request...\n');
        const start = Date.now();

        const response = await axios.post(
            'http://localhost:3006/v1/course-visualizations',
            payload,
            { timeout: 300000 }
        );

        const duration = Math.round((Date.now() - start) / 1000);
        console.log(`✓ Generated in ${duration}s\n`);
        console.log('📊 Results:');
        console.log(`   Image URL: ${response.data.images[0]?.url}`);
        console.log(`   Debug HTML: Look for debug_*.html in public/generated-images/courses/\n`);
        console.log('✅ Check server logs for:');
        console.log('   [MATH: HUB] - Spoke coordinates');
        console.log('   [DEBUG: THEME_FINAL] - Theme object');
        console.log('   [DEBUG: HTML_EXPORT] - Raw HTML path');
        console.log('   [DEBUG: RENDER] - Playwright settings\n');

    } catch (error: any) {
        console.error(`\n✗ FAILED: ${error.response?.data?.message || error.message}`);
    }
}

autopsyTest();
