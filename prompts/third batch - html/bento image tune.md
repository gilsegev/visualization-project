Task: Implement "Smart-Fit" Orchestration (Aspect-Aware Assets)

1. Aspect-Ratio Orchestration (Backend):

    Update the InfographicOrchestrator to calculate target pixel dimensions for each cell before calling the SiliconFlow API.

    Formula: Width=(col_span×100)−40px; Height=(row_span×100)−40px.

    Prompt Injection: Append the specific dimensions and orientation to each image prompt (e.g., "Portrait orientation, 1:2 aspect ratio") to ensure the generated asset fills the slot perfectly.

2. Validation (The "Body Map" Test):

    Execute an E2E run for the "The Stress Response: Body Map" visualization using the updated bento.html.

    Success Criteria:

        ✅ Integrity: The [6×12] hero image (silhouette) fills its vertical slot without white bars or stretching.

        ✅ Typography: Long titles like "Physiological" wrap onto two lines and scale down correctly without breaking the glass card.

        ✅ Performance: The browser capture service waits for the specific silhouette asset to be visible before taking the snapshot.