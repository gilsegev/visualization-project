import axios from 'axios';

/**
 * Prompt 44 Validation: Autonomic Nervous System Hub
 * Tests: Center alignment, atomic wellness prompting, high-res capture
 */
async function validatePrompt44() {
    console.log('🎨 Prompt 44 Validation - Autonomic Nervous System Hub\n');

    const payload = {
        course_id: `wellness_prompt44_${Date.now()}`,
        course_metadata: {
            title: 'Understanding the Autonomic Nervous System',
            target_audience: 'Wellness practitioners and mindfulness students',
            global_style_guide: {
                philosophy: 'Present nervous system concepts with elegant watercolor aesthetic',
                palette: ['#5DA9A4', '#F5E6D3', '#2C4A52'],
                font_preferences: 'Elegant serif for headings',
                image_style: 'Sophisticated wellness book illustration, soft watercolor bleeds, muted teal and sand tones, elegant charcoal line-art'
            }
        },
        visualizations: [{
            id: 'ans_hub',
            lesson: 'Nervous System Overview',
            title: 'The Autonomic Nervous System',
            objective: 'Understand the central role and branches of the ANS',
            description: 'The autonomic nervous system regulates involuntary body functions through sympathetic, parasympathetic, and enteric divisions.',
            suggested_template: 'hub_radial'
        }]
    };

    try {
        console.log('📤 Sending request to /v1/course-visualizations...');
        const startTime = Date.now();

        const response = await axios.post(
            'http://localhost:3006/v1/course-visualizations',
            payload,
            { timeout: 300000 }
        );

        const duration = Math.round((Date.now() - startTime) / 1000);
        console.log(`✓ Generated in ${duration}s\n`);

        console.log('📊 Results:');
        console.log(`   Style Anchor: "${response.data.global_style_anchor}"`);
        console.log(`   Template: ${response.data.images[0]?.payload?.blueprint?.template_id || 'N/A'}`);
        console.log(`   Image URL: ${response.data.images[0]?.url}\n`);

        // Validation checks
        const hasWellness = response.data.global_style_anchor?.toLowerCase().includes('watercolor') ||
            response.data.global_style_anchor?.toLowerCase().includes('wellness');
        const isHubRadial = response.data.images[0]?.payload?.blueprint?.template_id === 'hub_radial';

        console.log('✅ Validation Checks:');
        console.log(`   Wellness Aesthetic: ${hasWellness ? '✓ PASS' : '✗ FAIL'}`);
        console.log(`   Hub Radial Template: ${isHubRadial ? '✓ PASS' : '✗ FAIL'}`);
        console.log(`   Center Alignment: Manual visual check required`);
        console.log(`   High-Res Capture: Check image dimensions (should be 1200x1200+)`);

    } catch (error: any) {
        console.error(`\n✗ Test FAILED: ${error.response?.data?.message || error.message}`);
        if (error.response?.data) {
            console.error('Response data:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

validatePrompt44();
