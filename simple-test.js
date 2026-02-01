require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY;
const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

console.log(`Testing API Key: ${apiKey ? apiKey.substring(0, 5) + '...' : 'NONE'}`);
console.log(`Target URL: ${url.replace(apiKey, 'HIDDEN_KEY')}`);

async function listModels() {
    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`HTTP Error: ${response.status} ${response.statusText}`);
            console.error(`Response Body: ${errorText}`);
        } else {
            const data = await response.json();
            console.log("Success! Available Models:");
            if (data.models) {
                data.models.forEach(m => {
                    console.log(`- ${m.name} (${m.displayName}): ${m.supportedGenerationMethods.join(', ')}`);
                });
            } else {
                console.log("No models returned in the list.");
                console.log(JSON.stringify(data, null, 2));
            }
        }
    } catch (err) {
        console.error("Network or execution error:", err);
    }
}

listModels();
