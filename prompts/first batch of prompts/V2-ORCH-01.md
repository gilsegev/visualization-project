Goal: Re-introduce the CourseController and CourseOrchestratorService to process full course JSON specifications while enforcing a strict data contract for the Hub template.

1. Course DTO & Orchestrator Implementation:

    Create src/courses/course.dto.ts with the following refined interfaces:

        CourseMetadata: Includes title, audience, and a global_style_guide.

        VisualizationItem: Important: Add a center_topic property { title: string; description: string; } specifically for Hub templates.

        CourseJob: The main container for metadata and an array of visualizations.

    Re-implement CourseOrchestratorService.ts:

        Architect Pre-Pass: A single OpenRouter call to define the global_style_anchor (e.g., "Minimalist watercolor, soft textures") based on the course metadata.

        Parallel Execution: Use p-limit with a concurrency of 3 to iterate through the visualizations and call htmlStrategy.generate().

        Path Logic: Pass a folder property in the payload so images are saved to public/generated-images/courses/{course_id}/.

2. The "Hub Schema" Refactor (Strategy):

    In HtmlInfographicStrategy.ts, update the HtmlInfographicBlueprint interface:

        Add: center_topic?: { title: string; description: string; };

    Update the generateBlueprint prompt:

        Explicitly instruct the LLM: "If using the 'hub_radial' template, provide the main subject in the center_topic object and supporting details in the items array. Do NOT repeat the center topic in the items array."

3. Forensic Data Mapping:

    In performGeneration, add a new forensic log:

        [FORENSIC] Mapping Data for Template: {template_id}

        If hub_radial, log: [FORENSIC] Center Topic Detected: {title}.

    Logic Fix: Ensure the code explicitly targets #slot_title_center and #slot_txt_center using the new center_topic data.

4. Batch Verification Test:

    Create scripts/test-v2-batch.ts using the Mindfulness & Stress Management course spec (Lesson 1.1 and 1.2).

    Validation: 1. Verify the CourseOrchestrator triggers the pre-pass.
    2. Verify the terminal logs the [FORENSIC] mapping for both the Hub and the secondary template.
    3. Verify that two distinct images (and their corresponding debug_*.html files) are saved in the course sub-folder.

Validation Requirement: Provide the console output showing the Orchestrator starting the job, the Architect's style anchor, and the forensic mapping of the center_topic for the first visualization.