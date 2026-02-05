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
            console.log('👉 PLEASE CHECK SERVER CONSOLE LOGS in the terminal to verify the Blueprint JSON structure!');
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
