import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

async function runUltimatetest() {
    console.log('🐝 Starting "Ultimate Harmony" Honeybee Test...');
    const prompt = "Create a sequential infographic showing the life cycle of a honeybee: 1. Egg, 2. Larva, 3. Pupa, 4. Adult Bee, 5. Pollinating a Flower.";

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
            const resultUrl = results[0].url;
            console.log(`✅ Result URL: ${resultUrl}`);

            // Log details from payload if available
            const blueprint = results[0].payload?.blueprint;
            if (blueprint) {
                console.log(`\n🎨 Global Style Prompt: "${blueprint.global_style_prompt}"`);
                console.log(`📊 Items Generated: ${blueprint.items.length}`);
            }

            // Save as honeybee-lifecycle.png
            const localPath = path.join(process.cwd(), 'public', resultUrl);
            const targetName = 'honeybee-lifecycle.png';
            const targetPath = path.join(process.cwd(), 'public', 'generated-images', targetName);

            if (fs.existsSync(localPath)) {
                fs.copyFileSync(localPath, targetPath);
                console.log(`\n✅ Saved Final Result: ${targetPath}`);
                const stats = fs.statSync(targetPath);
                console.log(`📦 Final File Size: ${(stats.size / 1024).toFixed(2)} KB`);
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

runUltimatetest();
