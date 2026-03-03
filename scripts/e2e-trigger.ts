
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

async function run() {
    try {
        const filePath = path.join(process.cwd(), 'public', 'assets', 'test.json');
        console.log(`Reading manifest from: ${filePath}`);

        if (!fs.existsSync(filePath)) {
            console.error('File not found!');
            return;
        }

        const manifest = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        console.log('Sending request to http://localhost:3000/generate/manifest...');

        const response = await axios.post('http://localhost:3000/generate/manifest', manifest);

        console.log('Response Status:', response.status);
        console.log('Response Data:', response.data);

    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.error('Axios Error:', error.message);
            console.error('Response:', error.response?.data);
        } else {
            console.error('Error:', error);
        }
    }
}

run();
