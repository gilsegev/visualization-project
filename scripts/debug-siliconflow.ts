
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function debugSiliconFlow() {
    const rawKey = process.env.SILICONFLOW_API_KEY;
    console.log(`[DEBUG] Raw Key Length: ${rawKey ? rawKey.length : 'N/A'}`);

    if (!rawKey) {
        console.error('Key missing!');
        return;
    }

    const trimmedKey = rawKey.trim();
    console.log(`[DEBUG] Trimmed Key Length: ${trimmedKey.length}`);

    console.log('--- Testing https://api.siliconflow.com/v1/models ---');
    try {
        const response = await axios.get('https://api.siliconflow.com/v1/models', {
            headers: {
                Authorization: `Bearer ${trimmedKey}`
            }
        });
        console.log(`[SUCCESS] /v1/models status: ${response.status}`);
        console.log(`[SUCCESS] Models found: ${response.data.data?.length}`);
    } catch (error) {
        console.error(`[FAILURE] /v1/models failed: ${error.message} - ${JSON.stringify(error.response?.data)}`);
    }
}

debugSiliconFlow();
