import axios from 'axios';

async function testStepJourneyFix() {
    const payload = {
        title: "The Mindfulness Journey",
        type: "vertical_flowchart",
        description: "A 5-step process to achieve daily mindfulness and reduce stress.",
        structure: {
            steps: [
                { title: "Awareness", description: "Notice your breath and the sensations in your body without judgment." },
                { title: "Acceptance", description: "Acknowledge your thoughts and feelings as they are, without trying to change them." },
                { title: "Focus", description: "Gently bring your attention back to the present moment whenever it wanders." },
                { title: "Practice", description: "Dedicate time each day to mindful breathing or meditation." },
                { title: "Integration", description: "Bring mindfulness into your daily activities, like eating or walking." }
            ],
            footerNote: "Start small and be patient with yourself."
        }
    };

    console.log('Forcing Step Journey Generation...');

    try {
        const response = await axios.post('http://localhost:3000/generate', {
            content: `Create a step_journey infographic for: ${JSON.stringify(payload)}`
        });
        console.log('Task started:', response.data);
    } catch (error: any) {
        console.error('Test Failed:', error.response?.data || error.message);
    }
}

testStepJourneyFix();
