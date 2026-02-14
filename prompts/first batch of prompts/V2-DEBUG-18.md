To beat this, we are going to force the browser to define its coordinate system by Relative Percentages rather than pixels, making it impossible for "squishing" to shift the spokes.

    Goal: Replace absolute pixel positioning with relative percentage positioning to ensure the Spokes and the Hub Center share the exact same responsive coordinate root.

    1. The "Anti-Squish" Math (Strategy TS):

        In HtmlInfographicStrategy.ts, convert your absolute pixel coordinates back into percentages of the 1200px canvas.

        Action: Update the injection loop:
        TypeScript

        const radiusPct = 38; // Use 38% instead of 456px
        const total = blueprint.items.length;
        const angle = (index / total) * 2 * Math.PI - (Math.PI / 2);

    // Calculate as percentages of the parent container
    const posX_pct = 50 + (radiusPct * Math.cos(angle));
    const posY_pct = 50 + (radiusPct * Math.sin(angle));

    // Inject as % to force the browser to scale them relatively
    clone.style.left = `${posX_pct}%`;
    clone.style.top = `${posY_pct}%`;
    clone.style.position = 'absolute';
    clone.style.transform = 'translate(-50%, -50%)';
    ```

    2. The "Viewport Anchor" (Strategy CSS):

        Ensure the #main-wrapper is the only thing defining the 100% width/height:
        CSS

        #main-wrapper {
            width: 1200px !important;
            height: 1200px !important;
            position: relative !important;
            display: block !important;
        }

    3. The Forensic Verification:

        Action: Re-inject the Red Dot but do it using the same percentage math: left: 50%; top: 50%;.

        Forensic Log: [FORENSIC] Percentage Math Active: Spoke 0 at ${posX_pct}%.

    4. Execution:

        Run test-wellness-hub.ts.

        Success Criteria: If the Spokes and Center are now perfectly aligned (even if the whole thing is still "shifted" on the PNG), we have successfully synchronized the coordinate systems.