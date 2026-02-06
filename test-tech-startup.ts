import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

async function runStartupTest() {
    console.log('🚀 Starting "Tech Startup Journey" Test...');
    const prompt = "A 5-step horizontal journey of a startup: Idea, Funding, Build, Launch, Scale.";

    try {
        console.log(`\n📤 Sending Request: "${prompt}"`);
        const startTime = Date.now();
        const response = await axios.post('http://localhost:3000/generate', {
            content: prompt
        });
        const duration = Date.now() - startTime;

        const results = response.data.results || response.data;
        const seconds = duration / 1000;
        console.log(`\n⏱️ Total Generation Time: ${seconds.toFixed(2)}s`);

        if (seconds > 10) {
            console.warn(`⚠️ Warning: Execution time (${seconds}s) exceeds 10s threshold.`);
        } else {
            console.log(`✅ Performance within limits (<10s).`);
        }

        if (Array.isArray(results) && results[0].url) {
            const resultUrl = results[0].url;
            console.log(`✅ Result URL: ${resultUrl}`);

            // Log details
            const blueprint = results[0].payload?.blueprint;
            if (blueprint) {
                console.log(`🎨 Global Style: "${blueprint.global_style_prompt}"`);
                console.log(`🖌️ Theme Color: ${blueprint.theme_color}`);
                console.log(`🔤 Text Color: ${blueprint.text_color}`);
            }

            // Save as startup-journey-v2.png
            const localPath = path.join(process.cwd(), 'public', resultUrl);
            const targetName = 'startup-journey-v2.png';
            const targetPath = path.join(process.cwd(), 'public', 'generated-images', targetName);

            if (fs.existsSync(localPath)) {
                fs.copyFileSync(localPath, targetPath);
                console.log(`\n✅ Saved Final Result: ${targetPath}`);
                const stats = fs.statSync(targetPath);
                console.log(`📦 Final File Size: ${(stats.size / 1024).toFixed(2)} KB`);

                // Heuristic check for background presence via size
                if (stats.size > 300 * 1024) {
                    console.log(`✅ File size indicates complex background content.`);
                } else {
                    console.warn(`⚠️ File size low (${(stats.size / 1024).toFixed(0)}KB). Verification of background execution recommended.`);
                }
            } else {
                console.warn(`⚠️ Original file not found at: ${localPath}`);
            }

        } else {
            console.log('\n⚠️ Unexpected response structure.');
            console.log(JSON.stringify(results, null, 2));
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.response) {
            console.log('Data:', error.response.data);
        }
    }
}

runStartupTest();
