import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

async function testFullCourseRun() {
    console.log('--- Course Orchestrator Batch Test ---');

    // 1. Load the lesson data
    const dataPath = path.join(process.cwd(), 'public', 'assets', 'lesson_visualization.json');
    const lessonData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

    // Add a unique course_id for this run
    const job = {
        course_id: 'course_stress_mgt_' + Date.now(),
        ...lessonData
    };

    console.log(`Triggering batch job for course: ${job.course_id}`);
    console.log(`Sending ${job.visualizations.length} visualizations...`);

    try {
        const response = await axios.post('http://localhost:3006/v1/course-visualizations', job, {
            timeout: 600000 // 10 minutes for full batch
        });

        console.log('Batch job completed successfully!');
        console.log('Style Anchor:', response.data.global_style_anchor);
        console.log('Generated Images:');
        response.data.images.forEach((img: any) => {
            console.log(` - [${img.visualization_id}]: ${img.url}`);
        });

    } catch (error: any) {
        console.error('Batch Job Failed:', error.response?.data || error.message);
    }
}

testFullCourseRun();
