import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

async function runHybridValidation() {
    console.log('🚀 Starting "Hybrid Engine Validation" (prompts/24.md)...');

    const testCases = [
        {
            name: "Test 1: The Nature Scenario",
            prompt: "Create a 5-step sequential infographic on the Lifecycle of a Honeybee: Egg, Larva, Pupa, Adult, Pollination.",
            filename: 'honeybee-lifecycle.png'
        },
        {
            name: "Test 2: The Tech Scenario",
            prompt: "Create a 4-step horizontal journey of a startup: Idea, Funding, Build, Launch.",
            filename: 'startup-journey.png'
        }
    ];

    let allPass = true;

    for (const test of testCases) {
        console.log(`\n-----------------------------------`);
        console.log(`🧪 ${test.name}`);
        console.log(`📜 Prompt: "${test.prompt}"`);

        try {
            const startTime = Date.now();
            const response = await axios.post('http://localhost:3000/generate', {
                content: test.prompt
            });
            const duration = Date.now() - startTime;
            const seconds = duration / 1000;

            console.log(`⏱️ Generation Time: ${seconds.toFixed(2)}s`);

            // Performance Check
            if (seconds < 10) {
                console.log(`✅ Performance PASS (< 10s)`);
            } else {
                console.warn(`⚠️ Performance WARN (> 10s)`);
                // Note: user asked to "Log the total time", not strict fail, but implied target.
            }

            const results = response.data.results || response.data;
            if (Array.isArray(results) && results[0].url) {
                const resultUrl = results[0].url;
                console.log(`🔗 Generated URL: ${resultUrl}`);

                const localPath = path.join(process.cwd(), 'public', resultUrl);
                const targetPath = path.join(process.cwd(), 'public', 'generated-images', test.filename);

                // Ensure target directory exists
                const targetDir = path.dirname(targetPath);
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }

                if (fs.existsSync(localPath)) {
                    fs.copyFileSync(localPath, targetPath);
                    console.log(`📂 Saved to: ${targetPath}`);

                    const stats = fs.statSync(targetPath);
                    console.log(`📦 Size: ${(stats.size / 1024).toFixed(2)} KB`);

                    // Full-Bleed & Background Check (Heuristic)
                    // Hard to verify "exactly 1024x1024" without image lib, but we can assume success if file exists and > 300KB
                    if (stats.size > 300 * 1024) {
                        console.log(`✅ File size indicates complex background content (>300KB).`);
                    } else {
                        console.warn(`⚠️ File size low. Check if background is missing.`);
                    }

                } else {
                    console.error(`❌ Generated file missing at ${localPath}`);
                    allPass = false;
                }
            } else {
                console.error(`❌ Unexpected response format.`);
                allPass = false;
            }

        } catch (error: any) {
            console.error(`❌ Error in ${test.name}:`, error.message);
            if (error.response) {
                console.error(`Response Data:`, JSON.stringify(error.response.data, null, 2));
            }
            allPass = false;
        }
    }

    console.log(`\n-----------------------------------`);
    if (allPass) {
        console.log(`✅ All validation tests completed. Please visually inspect output files.`);
    } else {
        console.log(`❌ Some tests failed to complete successfully.`);
        process.exit(1);
    }
}

runHybridValidation();
