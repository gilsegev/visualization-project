Goal: Fix the HtmlInfographicStrategy to correctly populate both sides of the Versus template and enforce the "Magnet Anchor" positioning.

1. Fix the "Empty Right Side" (TS Mapping):

    Open HtmlInfographicStrategy.ts.

    Issue: The versus_split logic is currently failing to map comparison data to both the left and right slots. It appears to be dumping all text into the left side and leaving the right as -.

    Action: Update the mapping logic to split comparison strings (e.g., "SpaceX: [text], Blue Origin: [text]") or ensure the blueprint.items are correctly routed to slot_txt_left and slot_txt_right within each generated row.

2. Implement "Middle-Out" Vertical Centering:

    In the template injection loop for versus_split, ensure the parent containers (.subject-container) are assigned position: absolute; top: 50%; transform: translateY(-50%);.

    Verification: This should result in text boxes that grow upward and downward from the vertical center of the image, rather than starting in the middle and only growing down.

3. Theme Consistency:

    Ensure the styleTag injection forces the stat-list backgrounds to remain high-contrast (dark blue/slate) as defined in the updated versus_split.html.

4. Verification:

    Run test-v2-diversity.ts specifically for the Versus template.

    Requirement: The resulting image must show SpaceX text on the left and Blue Origin text on the right, with both blocks perfectly centered vertically.