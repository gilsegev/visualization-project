Task: Implement Automated Orchestration & Conduct E2E Performance Audit

1. Implement Raw Data Orchestration:

    Update the InfographicOrchestrator to accept the "Raw Lesson JSON" provided above.

    For each entry in the visualizations array, the orchestrator must:

        Call generateBlueprint to automatically select the best template_id based on the raw_content (e.g., viz_001 should become hub_radial).

        Map the items into the structured schema required by that template.

        Proceed through the full image generation and stamping pipeline.

2. Instrumentation for Performance (Throughput):

    Add high-resolution timing to every stage of the TemplateStampingStrategy.

    Output Requirement: For every generated infographic, provide a "Timing Signature":

        Blueprint Gen: [ms]

        Parallel Image Gen (SiliconFlow): [ms]

        HTML Stamping: [ms]

        Browser Capture (Playwright): [ms]

    Identify and log the primary bottleneck for the entire batch.

3. Accuracy & Content Validation:

    Criteria: Confirm that the generated images match the "Design Philosophy" (warm/approachable) and that no text from the original MD is truncated.

4. Success Criteria:

    ✅ Functionality: 3 unique infographics (Hub, Versus, Steps) are generated and saved as PNGs.

    ✅ Integrity: The generated HTML files contain the exact descriptions from the MD file.

    ✅ Performance: A complete report is generated showing total time spent per asset.