Goal: Apply the "Hub Success" principles (Real Box Anchors, No Negative Hacks) to the remaining templates to ensure total alignment across the course.

1. Step-Stone (Zig-Zag) Realignment:

    Action: Rebuild step_stone.html using a fixed-width flex container.

    The Anchor: Each "Step" must be a container with a real height (e.g., 300px).

    The Math: Instead of absolute positioning, use flex-row and flex-row-reverse to create the zig-zag automatically.

2. Versus Split "Axis" Fix:

    Action: Update versus_split.html to use a Centered Spine.

    The Anchor: Position the Left Subject at left: 300px and the Right Subject at left: 900px (the midpoints of the two halves).

    The Math: Use transform: translate(-50%, -50%) on the subject containers to lock them to those midpoints.

3. Bento Grid "Static Lockdown":

    Action: Replace the dynamic Tailwind grid in bento_grid.html with Absolute Positioning for the cards.

    The Logic: If we have 3 items, place them at (200, 600), (600, 600), and (1000, 600).

4. Global Injection Update (Strategy TS):

    Ensure HtmlInfographicStrategy.ts uses the same Direct Pixel/Percentage Injection we perfected for the Hub for all other templates.

5. Execution:

    Run scripts/test-v2-diversity.ts.

    Requirement: Provide screenshots of Step-Stone and Versus to confirm the "Spine" is aligned.