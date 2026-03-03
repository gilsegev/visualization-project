import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

async function runStepListTest() {
    console.log('📋 Starting "Step List" Test...');
    // Prompt designed specifically for the vertical step_list roadmap with 5 steps
    const prompt = "Create a vertical 5-step roadmap for a Sustainable Living Guide. Step 1: Audit | Assess energy use. Step 2: Reduce | Cut waste consumption. Step 3: Reuse | Repurpose household items. Step 4: Recycle | Sort materials properly. Step 5: Educate | Share knowledge with community. Theme: nature_green.";

    try {
        console.log(`\n📤 Sending Request: "${prompt}"`);
        const startTime = Date.now();
        const response = await axios.post('http://localhost:3000/generate', {
            content: prompt
        });
        const duration = Date.now() - startTime;

        const results = response.data.results || response.data;
        console.log(`\n⏱️ Total Generation Time: ${(duration / 1000).toFixed(2)}s`);

        if (Array.isArray(results) && results[0].url) {
            let resultUrl = results[0].url;
            if (resultUrl.startsWith('/')) {
                resultUrl = `http://localhost:3000${resultUrl}`;
            }
            console.log(`✅ Result URL: ${resultUrl}`);

            // Log details from payload if available
            if (results[0].payload) {
                const { blueprint, metrics } = results[0].payload;
                console.log(`\n🎨 Template: ${blueprint.template_id}`);
                console.log(`🎨 Theme: ${blueprint.theme_id}`);
                console.log(`📋 Main Topic: ${blueprint.center_topic?.title}`);

                if (metrics) {
                    console.log(`\n🚀 Performance Metrics:`);
                    console.log(`   - Blueprint: ${metrics.blueprint_ms}ms`);
                    console.log(`   - Images:    ${metrics.images_ms}ms`);
                    console.log(`   - DOM:       ${metrics.dom_ms}ms`);
                    console.log(`   - Browser:   ${metrics.browser_ms}ms`);
                    console.log(`   - Total:     ${metrics.total_ms}ms`);
                }
            }

            // Save a copy of the debug HTML if present
            if (results[0].payload?.html) {
                const debugPath = path.join(process.cwd(), 'public', 'generated-images', 'debug_last_run.html');
                fs.writeFileSync(debugPath, results[0].payload.html);
                console.log(`✅ Saved Debug HTML: ${debugPath}`);
            }

            // download and save the final image as step-list-debug.png
            const imageResponse = await axios.get(resultUrl, { responseType: 'arraybuffer' });
            const localPath = path.join(process.cwd(), 'public', 'generated-images', 'step-list-debug.png');
            fs.writeFileSync(localPath, imageResponse.data);
            console.log(`✅ Saved Final Result: ${localPath}`);

        } else {
            console.warn('\n⚠️ Unexpected response structure.');
            console.log(JSON.stringify(results, null, 2));
        }

    } catch (error) {
        console.error('\n❌ Test Failed:');
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message);
        }
    }
}

runStepListTest();
