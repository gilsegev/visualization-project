Goal: Abandon CSS-based radial math and enforce absolute pixel positioning to eliminate skewing and alignment drift.

    1. Template Simplification (HTML):

        Open hub_radial.html.

        Action: Remove the entire transform block and the --angle variable from the .spoke-container CSS.

        Action: Ensure .spoke-container only has position: absolute; width: 280px; transform: translate(-50%, -50%);.

    2. TypeScript Math Engine (Strategy TS):

        In HtmlInfographicStrategy.ts, update the hub_radial loop:
        TypeScript

        const radius = 456; // 38% of 1200px
        const centerX = 600;
        const centerY = 600;
        const total = blueprint.items.length;

    const angle = (index / total) * 2 * Math.PI - (Math.PI / 2); // Start at 12 o'clock
    const posX = centerX + radius * Math.cos(angle);
    const posY = centerY + radius * Math.sin(angle);

    // Inject absolute pixels, bypassing CSS calc()
    clone.style.left = `${posX}px`;
    clone.style.top = `${posY}px`;
    clone.style.position = 'absolute';
    clone.style.transform = 'translate(-50%, -50%)'; 
    ```

    3. Forensic Validation:

        Log the final coordinates for every spoke: [FORENSIC] Spoke ${index} locked at ${posX}px, ${posY}px.

    4. Verification:

        Run test-wellness-hub.ts.

        Success Criteria: The spokes must form a perfect circle regardless of the number of items (3-7), with the "Red Dot" (if still present) perfectly centered between them.