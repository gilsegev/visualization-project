import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

async function testUpload() {
    try {
        const filePath = path.join(process.cwd(), 'public', 'assets', 'test.json');
        if (!fs.existsSync(filePath)) {
            console.error('Test file not found:', filePath);
            return;
        }

        const manifest = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        console.log('Read manifest with', manifest.visualizations?.length, 'visualizations.');

        console.log('Sending POST request to http://localhost:3005/generate/manifest...');
        const response = await axios.post('http://localhost:3005/generate/manifest', manifest);

        console.log('Response Status:', response.status);
        console.log('Response Data:', response.data);
    } catch (error) {
        console.error('Upload Failed:', error.message);
        if (error.response) {
            console.error('Response Status:', error.response.status);
            console.error('Response Data:', error.response.data);
        }
    }
}

testUpload();
