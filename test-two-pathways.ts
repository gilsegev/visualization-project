import axios from 'axios';

const inputData = {
    "context": {
        "course_title": "Mindfulness & Stress Management",
        "design_philosophy": "Warm, calming wellness book aesthetic. Non-clinical.",
        "palette": ["#5B9A8B", "#F5E6D3", "#E8A598", "#4A5568", "#FAF9F6", "#1A365D"]
    },
    "visualization_spec": {
        "id": "1.1",
        "title": "The Stress Response: Two Pathways",
        "structure": {
            "top_node": { "label": "STRESSOR", "sub_node": "HYPOTHALAMUS" },
            "branches": [
                {
                    "name": "SAM AXIS (Fast)",
                    "sequence": ["SNS activates", "Adrenal Medulla releases Epinephrine"],
                    "effects": ["Heart rate increases", "Blood pressure rises"]
                },
                {
                    "name": "HPA AXIS (Slow)",
                    "sequence": ["Hypothalamus releases CRH", "Pituitary releases ACTH"],
                    "effects": ["Sustained energy", "Immune modulation"]
                }
            ],
            "footer_note": "Acute stress activates both. Chronic stress keeps them running."
        }
    }
};

async function runTest() {
    console.log("Starting E2E Validation: The Two Pathways Run...");
    try {
        const response = await axios.post('http://localhost:3000/generate', {
            content: JSON.stringify(inputData)
        });

        console.log("Response received.");
        const data = response.data;
        const results = data.results || (Array.isArray(data) ? data : [data]);

        // Find the infographic task
        const taskResult = results.find((r: any) => r && (r.type === 'infographic' || r.value?.type === 'infographic'));
        if (!taskResult) {
            console.error("FAILED: No infographic task found in results.");
            console.log("Raw Response Detail:", JSON.stringify(data, null, 2).substring(0, 1000));
            process.exit(1);
        }

        const blueprint = (taskResult.payload?.blueprint || taskResult.value?.payload?.blueprint);
        if (!blueprint) {
            console.error("FAILED: No blueprint found in task result.");
            console.log("Task Result Detail:", JSON.stringify(taskResult, null, 2));
            process.exit(1);
        }

        const qualityScore = blueprint.quality_score;
        const templateId = blueprint.template_id;

        console.log(`Quality Score: ${qualityScore}`);
        console.log(`Template ID: ${templateId}`);

        let passed = true;

        if (!qualityScore || qualityScore < 75) {
            console.error(`FAILED: Quality Score ${qualityScore} is below Fail-Fast threshold (75).`);
            passed = false;
        }

        if (templateId !== 'versus_split') {
            console.error(`FAILED: Template ID is '${templateId}', expected 'versus_split'.`);
            passed = false;
        }

        const blueprintText = JSON.stringify(blueprint).toLowerCase();
        const requiredTerms = ["hypothalamus", "crh", "acth", "stressor"];
        requiredTerms.forEach(term => {
            if (!blueprintText.includes(term.toLowerCase())) {
                console.error(`FAILED: Missing required term '${term}' in blueprint.`);
                passed = false;
            }
        });

        if (passed) {
            console.log("PASSED: E2E Validation Successful!");
        } else {
            console.log("FAILED: E2E Validation failed some checks.");
            process.exit(1);
        }

    } catch (error) {
        console.error("Test failed with error:", error.message);
        if (error.response) {
            console.error("Error Response:", JSON.stringify(error.response.data, null, 2));
        }
        process.exit(1);
    }
}

runTest();
