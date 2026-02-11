Goal: Fix the overlapping elements and misaligned spokes by enforcing a rigid pixel-perfect frame and Z-index hierarchy.

1. Rigid Template Lockdown (HTML/CSS):

    Open hub_radial.html.

    Wrapper: Set #main-wrapper to a fixed width: 1200px; height: 1200px; position: relative; overflow: hidden;.

    Center: Set #hub-center to z-index: 100; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);.

    Spokes: Ensure the .spoke-container has zero padding or margin.

2. The "Transform Origin" Fix (Strategy):

    In HtmlInfographicStrategy.ts, update the spoke injection loop.

    Inline Styles: When setting the left and top percentages, you must also include transform: translate(-50%, -50%); in the inline style string.

    Math Check: Reduce the radius to 34% (down from 38%) to provide more breathing room between the cards and the center.

3. Wellness High-Contrast Pass:

    In the JSDOM injection block, if the theme is wellness_mindful:

        Set .glass-card background to rgba(255, 255, 255, 0.95) (almost solid).

        Disable all backdrop-filter: blur to stop the "muddy" color bleed.

4. Playwright Viewport Match:

    Update BrowserService.ts or the strategy's screenshot call. Force the viewport to exactly 1200x1200 to match our rigid CSS frame.

5. Verification:

    Re-run the "Autonomic Nervous System" Hub.

    Validation:

        Are the spokes clearly separated from the center?

        Is the text legible without "frosty" blur interference?

        Does the debug_last_run.html show every spoke with a translate(-50%, -50%) style?