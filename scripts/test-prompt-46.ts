import axios from 'axios';

/**
 * Prompt 46 Validation: Hub with center_topic

 */
async function validatePrompt46() {
    console.log('🎨 Prompt 46 Validation - Hub with center_topic\n');

    const payload = {
        course_id: `prompt46_${Date.now()}`,
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
            id: 'ans_hub',
            lesson: 'ANS Overview',
            title: 'The Autonomic Nervous System',
            objective: 'Understand ANS branches',
            description: 'The autonomic nervous system regulates involuntary functions through sympathetic, parasympathetic, and enteric divisions.',
            suggested_template: 'hub_radial'
        }]
    };

    try {
        console.log('📤 Sending request...');
        const start = Date.now();

        const response = await axios.post(
            'http://localhost:3006/v1/course-visualizations',
            payload,
            { timeout: 300000 }
        );

        console.log(`✓ Generated in ${Math.round((Date.now() - start) / 1000)}s\n`);
        console.log('📊 Results:');
        console.log(`   Template: ${response.data.images[0]?.payload?.blueprint?.template_id}`);
        console.log(`   Image URL: ${response.data.images[0]?.url}\n`);
        console.log('✅ Check image for: center_topic mapping, mathematical spoke positioning, solid white backgrounds');

    } catch (error: any) {
        console.error(`\n✗ FAILED: ${error.response?.data?.message || error.message}`);
    }
}

validatePrompt46();
