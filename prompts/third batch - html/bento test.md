Execute Multi-Modal Bento Stress Test

1. Blueprint Generation (Body Map):

    Generate a bento_grid blueprint for the "Domains of Stress" lesson.

    Hero Slot (Image Only): Assign a [6×12] span to a central cell. Generate a high-fidelity "Gender-neutral human silhouette with glowing stress points" using the SiliconFlow API.

    Detail Slots (Title + Text): Surround the hero with 4 smaller cells [3×6] representing the Physiological, Behavioral, Cognitive, and Emotional domains.

    Visual Signaling: Apply a 4px solid #E8A598 (Soft Coral) border to the Physiological cell to signal "High Alert".

2. Environmental Layering:

    Set the background.color to #F5E6D3 (Warm Sand).

    Generate a soft, abstract "Mindfulness nature background" and apply it at 15% opacity to the whole canvas.

3. Asset Integrity Verification:

    Ensure all 5 images (1 hero + 4 smaller icons if used) are saved to the local assets/ folder and mapped correctly in the JSON.

    Wait Logic: Ensure Playwright waits for the silhouette image to be fully visible before taking the screenshot.

4. Success Criteria:

    ✅ Layout: No text overlaps or grid overflows.

    ✅ Assets: The human silhouette is the clear focal point in the large hero cell.

    ✅ Aesthetic: All cards maintain the 18px glass blur for consistent course branding.