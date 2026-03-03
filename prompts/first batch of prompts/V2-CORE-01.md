Goal: Eliminate "NBA" data contamination and fix the mathematical alignment of the Hub spokes.

1. Template Data Purge:

    Open hub_radial.html. Locate and delete any hardcoded references to "NBA", "2026", or "All-Star".

    Ensure the center IDs are exactly: #slot_title_center and #slot_txt_center.

2. Blueprint Schema Enforcement:

    In HtmlInfographicStrategy.ts, update the HtmlInfographicBlueprint to include the center_topic: { title: string; description: string; } object.

    Update the generateBlueprint system prompt to be extremely strict: "The central topic of the visualization MUST be placed in 'center_topic'. Supporting details go in 'items'. Return ONLY JSON."

3. Absolute Coordinate Math (The Alignment Fix):

    In the spoke generation loop, calculate absolute percentages to bypass CSS layout shifting:
    const angle = (index / totalItems) * 2 * Math.PI - (Math.PI / 2);
    const x = 50 + Math.cos(angle) * 38; // 38% radius
    const y = 50 + Math.sin(angle) * 38;

    Inject these as inline styles to the spoke container: element.setAttribute('style', \left: ${x}%; top: ${y}%; transform: translate(-50%, -50%);`);`

4. Quality Reset:

    Update generateImage. For any "wellness" task, use this exact prompt structure:
    "${item_title}", hand-drawn watercolor illustration, soft charcoal edges, isolated on white background --no text, 3d, realistic, shadows.

5. Verification:

    Run the "Autonomic Nervous System" Hub.

    Validation:

        Does the center say "Autonomic Nervous System" (NOT NBA)?

        Are the spokes perfectly circular?

        Does the [FORENSIC] log show the new center_topic mapping?