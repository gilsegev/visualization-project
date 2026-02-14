import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

async function runVersusSplitTest() {
    console.log('⚔️ Starting "Versus Split" Test...');
    // Specific prompt to trigger 'versus_split' logic
    const prompt = "Create a versus comparison between SpaceX and Blue Origin. SpaceX: rapid innovation, reusable rockets. Blue Origin: slow and steady, New Glenn development. Theme: cyber_neon.";

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
                console.log(`\n🎨 Template: ${blueprint.template_id}`);
                console.log(`🎨 Theme: ${blueprint.theme_id}`);
                console.log(`📊 Versus Subjects: ${blueprint.versus_subjects?.left_name} vs ${blueprint.versus_subjects?.right_name}`);
            }

            // Save as versus-split-debug.png
            const localPath = path.join(process.cwd(), 'public', resultUrl);
            const targetName = 'versus-split-debug.png';
            const targetPath = path.join(process.cwd(), 'public', 'generated-images', targetName);

            if (fs.existsSync(localPath)) {
                fs.copyFileSync(localPath, targetPath);
                console.log(`\n✅ Saved Final Result: ${targetPath}`);
                const stats = fs.statSync(targetPath);
                console.log(`📦 Final File Size: ${(stats.size / 1024).toFixed(2)} KB`);
            } else {
                console.warn(`⚠️ Original file not found at: ${localPath}`);
            }

            // NEW: Save HTML for debugging
            const html = results[0].payload?.html;
            if (html) {
                const debugHtmlPath = path.join(process.cwd(), 'public', 'generated-images', 'debug_last_run.html');
                fs.writeFileSync(debugHtmlPath, html, 'utf-8');
                console.log(`✅ Saved Debug HTML: ${debugHtmlPath}`);
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

runVersusSplitTest();
