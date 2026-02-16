import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

async function testManifestFix() {
    const manifestPath = path.join(__dirname, 'public', 'assets', 'test.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    console.log('Starting Manifest Test Case: Stress Response Pathways...');

    try {
        const response = await axios.post('http://localhost:3000/generate/manifest', manifest);
        console.log('Batch started:', response.data);
        console.log('Waiting for generation output (check logs)...');
    } catch (error: any) {
        console.error('Test Failed:', error.response?.data || error.message);
    }
}

testManifestFix();
