const axios = require('axios');

async function runBlueprintTest() {
    console.log('🚀 Starting Infographic Blueprint Test...');

    // Test Case: "The 5 stages of a rocket launch."
    const prompt = "The 5 stages of a rocket launch.";

    try {
        console.log(`\n📤 Sending Request: "${prompt}"`);
        const response = await axios.post('http://localhost:3000/generate', {
            content: prompt
        });

        // We expect the server to log the blueprint details.
        // The client-side response might be the placeholder URL.
        const results = response.data.results || response.data;

        console.log('\n📥 Response Received:');
        console.log(JSON.stringify(results, null, 2));

        if (Array.isArray(results) && results[0].url === 'https://placeholder.com/blueprint-verified.png') {
            console.log('\n✅ Client received expected placeholder.');

            const blueprint = results[0].payload?.blueprint;
            if (blueprint && blueprint.items) {
                console.log(`\n🔍 Verifying Image Data for ${blueprint.items.length} items:`);
                let validImages = 0;
                blueprint.items.forEach((item, i) => {
                    // Log first 50 chars as requested
                    const imgData = item.image_data || '';
                    const status = imgData.startsWith('data:image/png;base64,') ? '✅ Valid Base64' : '❌ Invalid/Missing';
                    console.log(`   Item ${i + 1}: ${status} (Length: ${imgData.length})`);
                    if (imgData.length > 50) {
                        console.log(`   Sample: ${imgData.substring(0, 50)}...`);
                    }

                    if (imgData.startsWith('data:image/png;base64,')) validImages++;
                });

                if (validImages === blueprint.items.length) {
                    console.log('\n✅ All items have valid image data.');
                } else {
                    console.log('\n⚠️ Some items are missing image data.');
                }
            } else {
                console.log('\n⚠️ Blueprint payload missing in response.');
            }

        } else {
            console.log('\n⚠️ Unexpected response. Check if the server code was updated correctly.');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.response) {
            console.error('   Data:', error.response.data);
        }
    }
}

runBlueprintTest();
