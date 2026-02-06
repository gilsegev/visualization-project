import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

async function runBuyingFundingTest() {
    console.log('🚀 Starting "Buying & Funding Businesses" Test...');

    const prompts = [
        {
            text: "A step-by-step guide on how to buy a business: from searching listings to due diligence and closing the deal.",
            filename: 'buying-business-guide.png'
        },
        {
            text: "Funding options for buying a business: detailed comparison of seller financing, SBA loans, and private equity.",
            filename: 'funding-business-options.png'
        }
    ];

    for (const item of prompts) {
        fs.appendFileSync('test-debug.log', `\nTesting Prompt: "${item.text}"\n`);
        console.log(`\n-----------------------------------`);
        console.log(`Testing Prompt: "${item.text}"`);

        try {
            console.log(`📤 Sending Request...`);
            const startTime = Date.now();
            const response = await axios.post('http://localhost:3000/generate', {
                content: item.text
            });
            const duration = Date.now() - startTime;
            const seconds = duration / 1000;
            console.log(`⏱️ Generation Time: ${seconds.toFixed(2)}s`);
            fs.appendFileSync('test-debug.log', `Generation Time: ${seconds.toFixed(2)}s\n`);

            const results = response.data.results || response.data;
            fs.appendFileSync('test-debug.log', `Response: ${JSON.stringify(results, null, 2)}\n`);

            if (Array.isArray(results) && results[0].url) {
                const resultUrl = results[0].url;
                console.log(`✅ Received URL: ${resultUrl}`);

                // Log style details if available
                const blueprint = results[0].payload?.blueprint;
                if (blueprint) {
                    console.log(`🎨 Style: "${blueprint.global_style_prompt}" | 🖌️ Theme: ${blueprint.theme_color}`);
                }

                // Construct paths
                const localPath = path.join(process.cwd(), 'public', resultUrl);
                const targetPath = path.join(process.cwd(), 'public', 'generated-images', item.filename);

                console.log(`🔍 Looking for file at: ${localPath}`);
                fs.appendFileSync('test-debug.log', `Looking for file at: ${localPath}\n`);

                // Ensure target directory exists
                const targetDir = path.dirname(targetPath);
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }

                if (fs.existsSync(localPath)) {
                    fs.copyFileSync(localPath, targetPath);
                    console.log(`✅ Saved Result to: ${targetPath}`);
                    fs.appendFileSync('test-debug.log', `Saved to: ${targetPath}\n`);

                    const stats = fs.statSync(targetPath);
                    const sizeKB = (stats.size / 1024).toFixed(2);
                    console.log(`📦 File Size: ${sizeKB} KB`);

                    if (stats.size > 100 * 1024) {
                        console.log(`👍 File size looks healthy (>100KB).`);
                    } else {
                        console.warn(`⚠️ File size seems small.`);
                    }

                } else {
                    console.warn(`⚠️ Generated file not found locally at: ${localPath}`);
                    fs.appendFileSync('test-debug.log', `File NOT found at: ${localPath}\n`);

                    // List directory contents of parent to see what IS there
                    const parentDir = path.dirname(localPath);
                    if (fs.existsSync(parentDir)) {
                        const files = fs.readdirSync(parentDir);
                        console.log(`📂 Files in ${parentDir}:`, files.slice(0, 10)); // list first 10
                        fs.appendFileSync('test-debug.log', `Files in ${parentDir}: ${JSON.stringify(files)}\n`);
                    } else {
                        console.log(`📂 Parent dir does not exist: ${parentDir}`);
                        fs.appendFileSync('test-debug.log', `Parent dir does not exist: ${parentDir}\n`);
                    }
                }

            } else {
                console.warn('⚠️ Unexpected response structure or no URL returned.');
                console.log(JSON.stringify(results, null, 2));
                fs.appendFileSync('test-debug.log', `Unexpected structure: ${JSON.stringify(results)}\n`);
            }

        } catch (error: any) {
            const errorDetails = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
            console.error('❌ Error generating infographic:', errorDetails);
            fs.appendFileSync('test-debug.log', `Error Object: ${errorDetails}\n`);

            if (error.response) {
                console.error('Response Status:', error.response.status);
                fs.appendFileSync('test-debug.log', `Response Status: ${error.response.status}\n`);
                fs.appendFileSync('test-debug.log', `Response Data: ${JSON.stringify(error.response.data)}\n`);
            }
        }
    }

    console.log('\n✅ Test Batch Completed.');
}

runBuyingFundingTest();
